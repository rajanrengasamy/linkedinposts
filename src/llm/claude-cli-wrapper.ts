/**
 * Claude CLI Wrapper
 *
 * Provides an Anthropic SDK-compatible interface that routes requests
 * through the Claude Code CLI, using Claude Max subscription instead
 * of per-token API billing.
 *
 * Command pattern: claude --print --model sonnet --dangerously-skip-permissions
 *
 * Features:
 * - SDK-compatible messages.create() interface
 * - Environment scrubbing (removes ANTHROPIC_API_KEY to force subscription auth)
 * - JSON/text response parsing with fallback
 * - Extended thinking support via prompt keywords
 * - Comprehensive error classification
 *
 * @see https://docs.anthropic.com/en/docs/claude-code
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
 * Model aliases for Claude CLI.
 * Maps SDK model names to CLI model aliases.
 */
const MODEL_ALIASES: Record<string, string> = {
  // Full model names to CLI aliases
  'claude-sonnet-4-20250514': 'sonnet',
  'claude-opus-4-20250514': 'opus',
  'claude-haiku-4-20250514': 'haiku',
  // Direct aliases
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
};

/**
 * Default model for CLI requests
 */
const DEFAULT_MODEL = 'sonnet';

// ============================================
// SDK-Compatible Types
// ============================================

/**
 * Message format matching Anthropic SDK
 */
export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Request parameters matching Anthropic SDK messages.create()
 */
export interface ClaudeRequestParams {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
  temperature?: number;
  thinking?: {
    type: 'enabled';
    budget_tokens: number;
  };
}

/**
 * Response format matching Anthropic SDK
 */
export interface ClaudeSDKResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text' | 'thinking';
    text?: string;
    thinking?: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================
// Environment Handling
// ============================================

/**
 * Scrub environment to remove API keys.
 * Forces CLI to use subscription authentication instead of API keys.
 *
 * @returns Scrubbed environment variables
 */
function scrubEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Remove API keys to force subscription auth
  const keysToRemove = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_AI_API_KEY',
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
 * Build prompt string from messages array.
 * Formats messages with role prefixes for CLI input.
 *
 * @param messages - Array of messages
 * @param system - Optional system prompt
 * @returns Combined prompt string
 */
function buildPrompt(messages: ClaudeMessage[], system?: string): string {
  const parts: string[] = [];

  // Add system prompt with XML tags (matches reference implementation)
  if (system) {
    parts.push(`<system>\n${system}\n</system>`);
  }

  // Add conversation messages with XML tags
  for (const msg of messages) {
    if (msg.role === 'system') {
      parts.push(`<system>\n${msg.content}\n</system>`);
    } else if (msg.role === 'assistant') {
      parts.push(`<assistant>\n${msg.content}\n</assistant>`);
    } else {
      parts.push(`<user>\n${msg.content}\n</user>`);
    }
  }

  return parts.join('\n\n');
}

// ============================================
// Output Parsing
// ============================================

/**
 * Parse CLI output to extract response text.
 * Handles both plain text and JSON responses.
 *
 * @param stdout - Standard output from CLI
 * @param stderr - Standard error from CLI
 * @returns Parsed response with text and optional usage
 */
function parseOutput(
  stdout: string,
  stderr: string
): { text: string; usage?: CLIUsage } {
  const output = stdout.trim();

  if (!output) {
    // Check stderr for errors
    if (stderr) {
      checkForErrors(stderr);
    }
    return { text: '' };
  }

  // Try parsing as JSON (last line might be JSON)
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{')) {
      try {
        const data = JSON.parse(line);

        // Handle various response formats
        if (data.result) {
          return { text: String(data.result) };
        }
        if (data.content) {
          // Handle content blocks array
          if (Array.isArray(data.content) && data.content.length > 0) {
            for (const block of data.content) {
              if (
                typeof block === 'object' &&
                block.type === 'text' &&
                block.text
              ) {
                return { text: String(block.text) };
              }
            }
          }
          return { text: String(data.content) };
        }
        if (data.text) {
          return { text: String(data.text) };
        }
      } catch {
        // Not valid JSON, continue checking other lines
      }
    }
  }

  // Return raw text as fallback
  return { text: output };
}

/**
 * Check for specific error types in output.
 * Throws appropriate error class based on content.
 *
 * @param text - Output text to check
 * @throws CLIAuthError or CLIModelError if detected
 */
function checkForErrors(text: string): void {
  const lower = text.toLowerCase();

  if (
    lower.includes('auth') ||
    lower.includes('unauthorized') ||
    lower.includes('login')
  ) {
    throw new CLIAuthError('claude', text);
  }

  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('unavailable'))
  ) {
    throw new CLIModelError('claude', 'unknown');
  }
}

// ============================================
// CLI Execution
// ============================================

/**
 * Execute Claude CLI command.
 *
 * @param prompt - Prompt text to send
 * @param model - Model alias to use
 * @param timeoutMs - Command timeout in milliseconds
 * @returns Promise with stdout and stderr
 * @throws CLINotFoundError, CLITimeoutError, or CLIError
 */
async function executeCLI(
  prompt: string,
  model: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  const cliPath = getCLIPath('claude');

  if (!cliPath) {
    throw new CLINotFoundError('claude');
  }

  const resolvedModel = MODEL_ALIASES[model] || model;

  const args = [
    '--print',
    '--model',
    resolvedModel,
    '--dangerously-skip-permissions',
    '-p',
    prompt,
  ];

  logVerbose(`Executing: claude ${args.slice(0, 4).join(' ')}...`);

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
      reject(new CLITimeoutError('claude', timeoutMs));
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) return;

      if (code !== 0 && code !== null) {
        checkForErrors(stderr || stdout);
        reject(new CLIError(`CLI exited with code ${code}`, 'claude', code));
        return;
      }

      resolve({ stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new CLIError(`Failed to spawn CLI: ${err.message}`, 'claude'));
    });
  });
}

// ============================================
// Wrapper Class
// ============================================

/**
 * Claude CLI Wrapper class providing SDK-compatible interface.
 *
 * Usage:
 * ```typescript
 * const client = new ClaudeCLIWrapper({ model: 'sonnet' });
 * const response = await client.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * console.log(response.content[0].text);
 * ```
 */
export class ClaudeCLIWrapper {
  private timeout: number;
  private model: string;
  private thinkingEnabled: boolean;

  constructor(options?: {
    model?: string;
    timeout?: number;
    thinkingEnabled?: boolean;
  }) {
    this.model = options?.model || DEFAULT_MODEL;
    this.timeout = options?.timeout || DEFAULT_CLI_TIMEOUT_MS;
    this.thinkingEnabled = options?.thinkingEnabled || false;

    // Verify CLI is available
    const detection = detectCLI('claude');
    if (!detection.available) {
      throw new CLINotFoundError('claude');
    }

    logVerbose(
      `ClaudeCLIWrapper initialized: model=${this.model}, timeout=${this.timeout}ms`
    );
  }

  /**
   * SDK-compatible messages interface.
   */
  messages = {
    /**
     * Create a message using Claude CLI.
     *
     * @param params - Request parameters matching Anthropic SDK
     * @returns Promise with SDK-compatible response
     */
    create: async (params: ClaudeRequestParams): Promise<ClaudeSDKResponse> => {
      let prompt = buildPrompt(params.messages, params.system);
      const model = params.model || this.model;

      // Add ultrathink keyword if extended thinking is enabled
      // This triggers Claude Code's maximum thinking budget
      if (this.thinkingEnabled || params.thinking?.type === 'enabled') {
        prompt = `ultrathink\n\n${prompt}`;
        logVerbose(`Extended thinking enabled via 'ultrathink' prompt trigger`);
      }

      const { stdout, stderr } = await executeCLI(prompt, model, this.timeout);
      const { text, usage } = parseOutput(stdout, stderr);

      return {
        id: `cli-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text,
          },
        ],
        model: MODEL_ALIASES[model] || model,
        stop_reason: 'end_turn',
        usage: {
          input_tokens: usage?.promptTokens || 0,
          output_tokens: usage?.completionTokens || 0,
        },
      };
    },
  };
}

// ============================================
// Factory Function
// ============================================

/**
 * Factory function to get Claude CLI client.
 * Returns null if CLI is not available (safe for fallback chains).
 *
 * @param options - Optional configuration
 * @returns ClaudeCLIWrapper instance or null
 */
export function getClaudeCLIClient(options?: {
  model?: string;
  timeout?: number;
  thinkingEnabled?: boolean;
}): ClaudeCLIWrapper | null {
  try {
    return new ClaudeCLIWrapper(options);
  } catch (err) {
    if (err instanceof CLINotFoundError) {
      logWarning('Claude CLI not found, wrapper unavailable');
      return null;
    }
    throw err;
  }
}
