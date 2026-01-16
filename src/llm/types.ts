/**
 * LLM CLI Integration Types
 *
 * Shared types for multi-tier authentication fallback system.
 * Priority: OpenCode -> Native CLI -> Direct API
 *
 * This module defines the type system for CLI wrapper integrations,
 * enabling subscription-based CLI tools (claude, gemini, codex, opencode)
 * to be used before falling back to API keys.
 */

// ============================================
// CLI Tool Identifiers
// ============================================

/**
 * Supported CLI tool identifiers.
 * - claude: Anthropic Claude CLI (subscription-based)
 * - gemini: Google Gemini CLI (subscription-based)
 * - codex: OpenAI Codex CLI (subscription-based)
 * - opencode: Multi-provider CLI tool
 */
export type CLITool = 'claude' | 'gemini' | 'codex' | 'opencode';

/**
 * Client execution mode indicating which tier is being used.
 * - opencode: Using OpenCode CLI (highest priority)
 * - cli: Using native provider CLI (second priority)
 * - api: Using direct API calls (fallback)
 */
export type ClientMode = 'opencode' | 'cli' | 'api';

/**
 * LLM provider types matching existing codebase conventions.
 */
export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'openrouter';

// ============================================
// CLI Detection Types
// ============================================

/**
 * Result of CLI tool detection.
 */
export interface CLIDetectionResult {
  /** Whether the CLI tool is available on the system */
  available: boolean;
  /** Absolute path to the CLI executable, or null if not found */
  path: string | null;
  /** Version string if detected, or null */
  version: string | null;
  /** Error message if detection failed */
  error?: string;
}

/**
 * Configuration for a specific CLI tool.
 */
export interface CLIConfig {
  /** CLI tool identifier */
  tool: CLITool;
  /** Custom path to CLI executable (overrides PATH lookup) */
  path?: string;
  /** Timeout for CLI commands in milliseconds */
  timeout: number;
  /** Whether this CLI is enabled for use */
  enabled: boolean;
}

// ============================================
// Environment Variable Constants
// ============================================

/**
 * Environment variable names for custom CLI paths.
 * If set, these override PATH lookup for the respective CLI.
 */
export const CLI_PATH_ENV_VARS: Record<CLITool, string> = {
  claude: 'CLAUDE_CLI_PATH',
  gemini: 'GEMINI_CLI_PATH',
  codex: 'CODEX_CLI_PATH',
  opencode: 'OPENCODE_CLI_PATH',
} as const;

/**
 * Environment variable names for CLI mode toggles.
 * Set to 'true' to enable, 'false' to disable.
 * Default: claude/gemini/codex=true, opencode=false
 */
export const CLI_MODE_ENV_VARS: Record<CLITool, string> = {
  claude: 'USE_CLAUDE_CLI',
  gemini: 'USE_GEMINI_CLI',
  codex: 'USE_CODEX_CLI',
  opencode: 'USE_OPENCODE',
} as const;

/**
 * Default timeout for CLI commands in milliseconds.
 * 5 minutes to accommodate long-running LLM requests.
 */
export const DEFAULT_CLI_TIMEOUT_MS = 300_000;

// ============================================
// CLI Error Classes
// ============================================

/**
 * Base error class for CLI wrapper failures.
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly tool: CLITool,
    public readonly exitCode?: number
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

/**
 * Error thrown when a CLI tool is not found on the system.
 */
export class CLINotFoundError extends CLIError {
  constructor(tool: CLITool) {
    super(`CLI tool '${tool}' not found in PATH or configured path`, tool);
    this.name = 'CLINotFoundError';
  }
}

/**
 * Error thrown when CLI authentication fails.
 */
export class CLIAuthError extends CLIError {
  constructor(tool: CLITool, details?: string) {
    super(`Authentication failed for '${tool}'${details ? `: ${details}` : ''}`, tool);
    this.name = 'CLIAuthError';
  }
}

/**
 * Error thrown when a CLI command times out.
 */
export class CLITimeoutError extends CLIError {
  constructor(tool: CLITool, timeoutMs: number) {
    super(`CLI '${tool}' timed out after ${timeoutMs}ms`, tool);
    this.name = 'CLITimeoutError';
  }
}

/**
 * Error thrown when a requested model is not available via CLI.
 */
export class CLIModelError extends CLIError {
  constructor(tool: CLITool, model: string) {
    super(`Model '${model}' not available via '${tool}'`, tool);
    this.name = 'CLIModelError';
  }
}

// ============================================
// CLI Response Types
// ============================================

/**
 * Token usage information from CLI response.
 * Compatible with SDK response formats.
 */
export interface CLIUsage {
  /** Number of tokens in the prompt */
  promptTokens: number;
  /** Number of tokens in the completion */
  completionTokens: number;
  /** Total tokens used (prompt + completion) */
  totalTokens: number;
  /** Thinking/reasoning tokens if applicable (Claude extended thinking) */
  thinkingTokens?: number;
  /** Cached prompt tokens (for prompt caching optimization) */
  cachedPromptTokens?: number;
}

/**
 * Standardized response from CLI wrappers.
 * Designed to be compatible with SDK response types.
 */
export interface CLIResponse {
  /** Generated text content */
  text: string;
  /** Token usage information if available */
  usage?: CLIUsage;
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** Model that was used for generation */
  model: string;
  /** Reason why generation finished (stop, length, etc.) */
  finishReason: string;
}

// ============================================
// OpenCode Specific Types
// ============================================

/**
 * Provider options supported by OpenCode CLI.
 */
export type OpenCodeProvider = 'google' | 'openai';

/**
 * Configuration for OpenCode CLI execution.
 */
export interface OpenCodeConfig {
  /** Provider to use (google or openai) */
  provider: OpenCodeProvider;
  /** Model identifier */
  model: string;
  /** Timeout in milliseconds */
  timeout: number;
  /** Working directory for CLI execution */
  workingDir?: string;
}

// ============================================
// Client Factory Types
// ============================================

/**
 * Options for creating an LLM client with fallback tiers.
 */
export interface LLMClientOptions {
  /** Target provider (determines which CLI to try first) */
  provider: LLMProvider;
  /** Model to use */
  model: string;
  /** Override timeout (defaults to DEFAULT_CLI_TIMEOUT_MS) */
  timeout?: number;
  /** Force a specific execution mode (skip fallback) */
  forceMode?: ClientMode;
}

/**
 * Result from LLM client creation, indicating which tier was selected.
 */
export interface LLMClientResult {
  /** Execution mode that will be used */
  mode: ClientMode;
  /** CLI tool being used (if mode is 'opencode' or 'cli') */
  tool?: CLITool;
  /** Path to CLI executable (if applicable) */
  path?: string;
}
