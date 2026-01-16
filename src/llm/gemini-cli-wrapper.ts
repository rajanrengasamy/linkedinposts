/**
 * Gemini CLI Wrapper
 *
 * Provides a Google GenAI SDK-compatible interface that routes requests
 * through the Gemini CLI, using Gemini Ultra subscription instead of
 * per-token API billing.
 *
 * Command pattern: gemini -m gemini-3-pro-preview -o json --yolo
 *
 * Features:
 * - SDK-compatible models.generateContent() interface
 * - Environment scrubbing (removes GOOGLE_API_KEY to force subscription auth)
 * - JSON response parsing with usage extraction
 * - Thinking level configuration
 * - Comprehensive error classification
 *
 * @see https://github.com/google-gemini/gemini-cli
 */

import { spawn } from 'child_process';
import type { CLIResponse, CLIUsage } from './types.js';
import {
  CLIError,
  CLINotFoundError,
  CLIAuthError,
  CLITimeoutError,
  CLIModelError,
  DEFAULT_CLI_TIMEOUT_MS,
} from './types.js';
import { detectCLI, getCLIPath } from './cli-detector.js';
import { logVerbose, logWarning } from '../utils/logger.js';

// ============================================
// Model Configuration
// ============================================

/**
 * Model aliases for Gemini CLI
 * Maps short names to full model identifiers
 */
const MODEL_ALIASES: Record<string, string> = {
  'gemini-3-flash-preview': 'gemini-3-flash-preview',
  'gemini-3-pro-preview': 'gemini-3-pro-preview',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  flash: 'gemini-3-flash-preview',
  pro: 'gemini-3-pro-preview',
};

/**
 * Default model for new instances
 */
const DEFAULT_MODEL = 'gemini-3-flash-preview';

// ============================================
// SDK-Compatible Types
// ============================================

/**
 * Content format matching Google GenAI SDK
 */
export type GeminiContent = string | Array<{ text: string }>;

/**
 * Generation config matching Google GenAI SDK
 */
export interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  thinkingConfig?: {
    thinkingBudget?: number;
  };
}

/**
 * Request parameters matching Google GenAI SDK
 */
export interface GeminiRequestParams {
  model: string;
  contents: GeminiContent;
  config?: GeminiGenerationConfig;
}

/**
 * Response format matching Google GenAI SDK
 */
export interface GeminiSDKResponse {
  text: string;
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    thoughtsTokenCount?: number;
    totalTokenCount: number;
  };
}

// ============================================
// Environment Handling
// ============================================

/**
 * Scrub environment to remove API keys.
 * Forces CLI to use subscription authentication.
 */
function scrubEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Remove API keys to force subscription auth
  const keysToRemove = [
    'GOOGLE_API_KEY',
    'GOOGLE_AI_API_KEY',
    'GOOGLE_GENAI_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ];

  for (const key of keysToRemove) {
    delete env[key];
  }

  // Ensure HOME is set for CLI auth token storage
  if (!env.HOME) {
    env.HOME = process.env.HOME || '~';
  }

  return env;
}

// ============================================
// Prompt Building
// ============================================

/**
 * Build prompt string from contents.
 * Handles both string and array-of-parts formats.
 */
function buildPrompt(contents: GeminiContent): string {
  if (typeof contents === 'string') {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents.map((item) => item.text).join('\n');
  }

  return String(contents);
}

// ============================================
// Output Parsing
// ============================================

/**
 * Check for specific error types in output.
 * Throws typed errors for known error patterns.
 */
function checkForErrors(text: string): void {
  const lower = text.toLowerCase();

  if (
    lower.includes('auth') ||
    lower.includes('unauthorized') ||
    lower.includes('login')
  ) {
    throw new CLIAuthError('gemini', text);
  }

  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('unavailable'))
  ) {
    throw new CLIModelError('gemini', 'unknown');
  }
}

/**
 * Parse CLI JSON output.
 * Handles nested stats structure from Gemini CLI.
 *
 * Expected CLI JSON format:
 * {
 *   "session_id": "...",
 *   "response": "...",
 *   "stats": {
 *     "models": {
 *       "model-name": {
 *         "tokens": {"input": N, "candidates": N, "thoughts": N, "total": N}
 *       }
 *     }
 *   }
 * }
 */
function parseOutput(
  stdout: string,
  stderr: string
): { text: string; usage?: CLIUsage } {
  const output = stdout.trim();

  if (!output) {
    if (stderr) {
      checkForErrors(stderr);
    }
    return { text: '' };
  }

  // Try parsing as JSON envelope
  try {
    const data = JSON.parse(output);

    // Extract response text from various possible locations
    let text = '';
    if (data.response) {
      text = String(data.response);
    } else if (data.text) {
      text = String(data.text);
    } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = data.candidates[0].content.parts[0].text;
    }

    // Strip markdown code fences if present (CLI sometimes wraps JSON in fences)
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }

    // Extract usage from stats
    let usage: CLIUsage | undefined;
    const stats = data.stats || data.usage || data.usageMetadata;
    if (stats) {
      // Handle nested stats structure from Gemini CLI
      if (stats.models) {
        const modelStats = Object.values(stats.models)[0] as Record<
          string,
          unknown
        >;
        if (modelStats?.tokens) {
          const tokens = modelStats.tokens as Record<string, number>;
          usage = {
            promptTokens: tokens.input || tokens.prompt || 0,
            completionTokens: tokens.candidates || tokens.output || 0,
            totalTokens: tokens.total || 0,
            thinkingTokens: tokens.thoughts || 0,
          };
        }
      } else {
        // Handle flat stats structure
        usage = {
          promptTokens: stats.promptTokenCount || stats.input_tokens || 0,
          completionTokens:
            stats.candidatesTokenCount || stats.output_tokens || 0,
          totalTokens: stats.totalTokenCount || 0,
          thinkingTokens: stats.thoughtsTokenCount || 0,
        };
      }
    }

    return { text, usage };
  } catch {
    // Not JSON, return raw text (strip markdown fences if present)
    let text = output;
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }
    return { text };
  }
}

// ============================================
// CLI Execution
// ============================================

/**
 * Execute Gemini CLI command.
 * Uses stdin to pass prompt for large prompt support.
 */
async function executeCLI(
  prompt: string,
  model: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  const cliPath = getCLIPath('gemini');

  if (!cliPath) {
    throw new CLINotFoundError('gemini');
  }

  const resolvedModel = MODEL_ALIASES[model] || model;

  const args = [
    '-m',
    resolvedModel,
    '-o',
    'json', // JSON output for structured parsing
    '--yolo', // Skip confirmations for automation
  ];

  logVerbose(`Executing: gemini ${args.join(' ')}`);
  logVerbose(`Prompt length: ${prompt.length} chars`);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn(cliPath, args, {
      env: scrubEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      reject(new CLITimeoutError('gemini', timeoutMs));
    }, timeoutMs);

    // Send prompt via stdin (supports large prompts)
    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);

      if (timedOut) return;

      if (code !== 0 && code !== null) {
        // Check for specific error types before throwing generic error
        try {
          checkForErrors(stderr || stdout);
        } catch (err) {
          reject(err);
          return;
        }
        reject(new CLIError(`CLI exited with code ${code}`, 'gemini', code));
        return;
      }

      resolve({ stdout, stderr });
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(new CLIError(`Failed to spawn CLI: ${err.message}`, 'gemini'));
    });
  });
}

// ============================================
// Main Wrapper Class
// ============================================

/**
 * Gemini CLI Wrapper class providing SDK-compatible interface.
 *
 * Usage:
 * ```typescript
 * const client = new GeminiCLIWrapper({ model: 'gemini-3-pro-preview' });
 * const response = await client.models.generateContent({
 *   model: 'gemini-3-pro-preview',
 *   contents: 'Analyze this problem...',
 * });
 * console.log(response.text);
 * ```
 */
export class GeminiCLIWrapper {
  private timeout: number;
  private model: string;

  constructor(options?: { model?: string; timeout?: number }) {
    this.model = options?.model || DEFAULT_MODEL;
    this.timeout = options?.timeout || DEFAULT_CLI_TIMEOUT_MS;

    // Verify CLI is available at construction time
    const detection = detectCLI('gemini');
    if (!detection.available) {
      throw new CLINotFoundError('gemini');
    }

    logVerbose(
      `GeminiCLIWrapper initialized: model=${this.model}, timeout=${this.timeout}ms`
    );
    if (detection.version) {
      logVerbose(`Gemini CLI version: ${detection.version}`);
    }
  }

  /**
   * SDK-compatible models interface.
   * Provides generateContent() method matching Google GenAI SDK.
   */
  models = {
    generateContent: async (
      params: GeminiRequestParams
    ): Promise<GeminiSDKResponse> => {
      const prompt = buildPrompt(params.contents);
      const model = params.model || this.model;

      const { stdout, stderr } = await executeCLI(prompt, model, this.timeout);
      const { text, usage } = parseOutput(stdout, stderr);

      // Log thinking tokens if present
      if (usage?.thinkingTokens && usage.thinkingTokens > 0) {
        logVerbose(`Thinking tokens used: ${usage.thinkingTokens}`);
      }

      return {
        text,
        candidates: [
          {
            content: {
              parts: [{ text }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: usage
          ? {
              promptTokenCount: usage.promptTokens,
              candidatesTokenCount: usage.completionTokens,
              thoughtsTokenCount: usage.thinkingTokens,
              totalTokenCount: usage.totalTokens,
            }
          : undefined,
      };
    },
  };
}

// ============================================
// Factory Function
// ============================================

/**
 * Factory function to get Gemini CLI client.
 * Returns null if CLI is not available (allows graceful fallback).
 *
 * @param options - Configuration options
 * @returns GeminiCLIWrapper instance or null
 *
 * @example
 * ```typescript
 * const client = getGeminiCLIClient({ model: 'pro' });
 * if (client) {
 *   const response = await client.models.generateContent({...});
 * } else {
 *   // Fall back to API client
 * }
 * ```
 */
export function getGeminiCLIClient(options?: {
  model?: string;
  timeout?: number;
}): GeminiCLIWrapper | null {
  try {
    return new GeminiCLIWrapper(options);
  } catch (err) {
    if (err instanceof CLINotFoundError) {
      logWarning('Gemini CLI not found, wrapper unavailable');
      return null;
    }
    throw err;
  }
}
