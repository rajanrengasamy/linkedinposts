/**
 * Fallback Router
 *
 * Central router implementing multi-tier fallback authentication system:
 * - Tier 1: OpenCode CLI (subscription auth via plugins, highest priority)
 * - Tier 2: Native CLI tools (claude, gemini, codex)
 * - Tier 3: Direct API (fallback, per-token billing)
 *
 * Priority: OpenCode first -> CLI -> API
 *
 * Environment variables:
 * - USE_OPENCODE: Enable OpenCode tier (default: false)
 * - USE_CLAUDE_CLI: Enable Claude CLI (default: true)
 * - USE_GEMINI_CLI: Enable Gemini CLI (default: true)
 * - USE_CODEX_CLI: Enable Codex CLI (default: true)
 */

import type { CLITool } from './types.js';
import {
  CLIError,
  CLINotFoundError,
  CLIAuthError,
  CLITimeoutError,
} from './types.js';
import { detectCLI } from './cli-detector.js';
import { isOpenCodeAvailable } from './opencode-wrapper.js';
import { logInfo, logWarning, logVerbose } from '../utils/logger.js';

// ============================================
// Types
// ============================================

/**
 * Supported LLM providers for routing
 */
export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

/**
 * Authentication tier used for request
 */
export type AuthTier = 'opencode' | 'cli' | 'api';

/**
 * Router configuration options
 */
export interface FallbackRouterOptions {
  /** LLM provider to use */
  provider: LLMProvider;
  /** Enable OpenCode CLI tier (default: from USE_OPENCODE env) */
  enableOpenCode?: boolean;
  /** Enable native CLI tier (default: from USE_*_CLI env) */
  enableCLI?: boolean;
  /** Enable direct API tier (default: true) */
  enableAPI?: boolean;
  /** Model for OpenCode tier */
  opencodeModel?: string;
  /** Model for native CLI tier */
  cliModel?: string;
  /** CLI command timeout in milliseconds */
  timeout?: number;
}

/**
 * Result from routed LLM request
 */
export interface RouterResult<T> {
  /** The response from the LLM */
  result: T;
  /** Which authentication tier succeeded */
  tier: AuthTier;
  /** All tiers that were attempted */
  tiersAttempted: string[];
}

// ============================================
// Environment Helpers
// ============================================

/**
 * Parse boolean from environment variable.
 * Treats 'true', '1', 'yes' as true (case-insensitive).
 */
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const lower = value.toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

/**
 * Get CLI environment variable name for a provider.
 */
function getCLIEnvVar(provider: LLMProvider): string {
  const mapping: Record<LLMProvider, string> = {
    anthropic: 'USE_CLAUDE_CLI',
    gemini: 'USE_GEMINI_CLI',
    openai: 'USE_CODEX_CLI',
  };
  return mapping[provider];
}

/**
 * Get CLI tool name for a provider.
 */
function getCLITool(provider: LLMProvider): CLITool {
  const mapping: Record<LLMProvider, CLITool> = {
    anthropic: 'claude',
    gemini: 'gemini',
    openai: 'codex',
  };
  return mapping[provider];
}

// ============================================
// Availability Checks
// ============================================

/**
 * Check if OpenCode CLI should be used.
 * Checks USE_OPENCODE env and CLI availability.
 */
export function shouldUseOpenCode(): boolean {
  const envEnabled = parseBoolEnv(process.env.USE_OPENCODE, false);

  if (!envEnabled) {
    logVerbose('OpenCode disabled via USE_OPENCODE env');
    return false;
  }

  const available = isOpenCodeAvailable();
  if (!available) {
    logVerbose('OpenCode enabled but CLI not available');
    return false;
  }

  return true;
}

/**
 * Check if native CLI should be used for a provider.
 * Checks USE_*_CLI env and CLI availability.
 */
export function shouldUseCLI(provider: LLMProvider): boolean {
  const envVar = getCLIEnvVar(provider);
  const envEnabled = parseBoolEnv(process.env[envVar], true);

  if (!envEnabled) {
    logVerbose(`${provider} CLI disabled via ${envVar} env`);
    return false;
  }

  const cliTool = getCLITool(provider);
  const detection = detectCLI(cliTool);

  if (!detection.available) {
    logVerbose(`${provider} CLI enabled but ${cliTool} not available`);
    return false;
  }

  return true;
}

/**
 * Get current router configuration from environment.
 * Returns which CLI modes are enabled.
 */
export function getRouterConfig(): Record<string, boolean> {
  return {
    opencode: shouldUseOpenCode(),
    claudeCLI: shouldUseCLI('anthropic'),
    geminiCLI: shouldUseCLI('gemini'),
    codexCLI: shouldUseCLI('openai'),
    useOpenCodeEnv: parseBoolEnv(process.env.USE_OPENCODE, false),
    useClaudeCLIEnv: parseBoolEnv(process.env.USE_CLAUDE_CLI, true),
    useGeminiCLIEnv: parseBoolEnv(process.env.USE_GEMINI_CLI, true),
    useCodexCLIEnv: parseBoolEnv(process.env.USE_CODEX_CLI, true),
  };
}

// ============================================
// Error Classification
// ============================================

/**
 * Check if an error should trigger fallback to next tier.
 * CLI-related errors (not found, auth, timeout) trigger fallback.
 * Other errors are re-thrown.
 */
function shouldFallback(error: unknown): boolean {
  if (error instanceof CLINotFoundError) {
    return true;
  }
  if (error instanceof CLIAuthError) {
    return true;
  }
  if (error instanceof CLITimeoutError) {
    return true;
  }
  if (error instanceof CLIError) {
    // General CLI errors also trigger fallback
    return true;
  }
  return false;
}

// ============================================
// Main Router
// ============================================

/**
 * Route an LLM request through the multi-tier fallback system.
 *
 * Attempts tiers in order:
 * 1. OpenCode CLI (if enabled and opencodeRequest provided)
 * 2. Native CLI (if enabled and cliRequest provided)
 * 3. Direct API (if enabled)
 *
 * CLI-related errors trigger fallback to next tier.
 * Non-CLI errors are re-thrown immediately.
 *
 * @param apiRequest - Direct API call function (tier 3)
 * @param cliRequest - Native CLI call function (tier 2, optional)
 * @param opencodeRequest - OpenCode call function (tier 1, optional)
 * @param options - Router configuration
 * @returns Result with response, tier used, and tiers attempted
 */
export async function routeLLMRequest<T>(
  apiRequest: () => Promise<T>,
  cliRequest?: () => Promise<T>,
  opencodeRequest?: () => Promise<T>,
  options?: FallbackRouterOptions
): Promise<RouterResult<T>> {
  const provider = options?.provider || 'gemini';
  const tiersAttempted: string[] = [];

  // Determine which tiers to try
  const enableOpenCode =
    options?.enableOpenCode ?? shouldUseOpenCode();
  const enableCLI =
    options?.enableCLI ?? shouldUseCLI(provider);
  const enableAPI = options?.enableAPI ?? true;

  // Tier 1: OpenCode CLI
  if (enableOpenCode && opencodeRequest) {
    tiersAttempted.push('opencode');
    logVerbose(`Attempting Tier 1: OpenCode CLI for ${provider}`);

    try {
      const result = await opencodeRequest();
      logInfo(`Request routed via OpenCode CLI (subscription auth)`);
      return { result, tier: 'opencode', tiersAttempted };
    } catch (error) {
      if (shouldFallback(error)) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        logWarning(`OpenCode CLI failed, falling back: ${errorMsg}`);
      } else {
        throw error;
      }
    }
  }

  // Tier 2: Native CLI
  if (enableCLI && cliRequest) {
    const cliTool = getCLITool(provider);
    tiersAttempted.push(`cli:${cliTool}`);
    logVerbose(`Attempting Tier 2: ${cliTool} CLI for ${provider}`);

    try {
      const result = await cliRequest();
      logInfo(`Request routed via ${cliTool} CLI (subscription auth)`);
      return { result, tier: 'cli', tiersAttempted };
    } catch (error) {
      if (shouldFallback(error)) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        logWarning(`${cliTool} CLI failed, falling back: ${errorMsg}`);
      } else {
        throw error;
      }
    }
  }

  // Tier 3: Direct API
  if (enableAPI) {
    tiersAttempted.push('api');
    logVerbose(`Attempting Tier 3: Direct API for ${provider}`);

    try {
      const result = await apiRequest();
      logInfo(`Request routed via direct API (per-token billing)`);
      return { result, tier: 'api', tiersAttempted };
    } catch (error) {
      // API errors are not recoverable, re-throw
      throw error;
    }
  }

  // No tiers available
  throw new Error(
    `No authentication tiers available for ${provider}. ` +
      `Attempted: ${tiersAttempted.join(', ') || 'none'}. ` +
      `Check environment variables and CLI installations.`
  );
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Route a request with automatic tier selection based on provider.
 * Simplified version that only requires API request.
 *
 * @param provider - LLM provider
 * @param apiRequest - Direct API call function
 * @returns Result with response and tier information
 */
export async function routeToProvider<T>(
  provider: LLMProvider,
  apiRequest: () => Promise<T>
): Promise<RouterResult<T>> {
  return routeLLMRequest(apiRequest, undefined, undefined, { provider });
}

/**
 * Log router configuration summary.
 * Useful for debugging auth tier availability.
 */
export function logRouterStatus(): void {
  const config = getRouterConfig();

  logInfo('Router Configuration:');
  logInfo(`  OpenCode: ${config.opencode ? 'available' : 'disabled'} (env: ${config.useOpenCodeEnv})`);
  logInfo(`  Claude CLI: ${config.claudeCLI ? 'available' : 'disabled'} (env: ${config.useClaudeCLIEnv})`);
  logInfo(`  Gemini CLI: ${config.geminiCLI ? 'available' : 'disabled'} (env: ${config.useGeminiCLIEnv})`);
  logInfo(`  Codex CLI: ${config.codexCLI ? 'available' : 'disabled'} (env: ${config.useCodexCLIEnv})`);
}
