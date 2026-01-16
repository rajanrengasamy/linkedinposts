/**
 * Codex CLI Wrapper
 *
 * Provides an OpenAI SDK-compatible interface that routes requests
 * through the OpenAI Codex CLI, using ChatGPT Pro subscription instead
 * of per-token API billing.
 *
 * Command pattern: codex exec --json --skip-git-repo-check --full-auto
 *
 * Features:
 * - SDK-compatible chat.completions.create() interface
 * - Environment scrubbing (removes OPENAI_API_KEY to force subscription auth)
 * - JSONL event stream parsing
 * - Token usage extraction including cached tokens
 * - Comprehensive error classification
 *
 * @see https://github.com/openai/codex
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
 * Model aliases for Codex CLI.
 * Maps user-friendly names to actual model IDs.
 */
const MODEL_ALIASES: Record<string, string> = {
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
  gpt5: 'gpt-5.2',
  codex: 'gpt-5.2-codex',
};

/** Default model for Codex CLI */
const DEFAULT_MODEL = 'gpt-5.2';

// ============================================
// Message Types
// ============================================

/**
 * Message format matching OpenAI SDK
 */
export interface CodexMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Request parameters matching OpenAI SDK chat.completions.create()
 */
export interface CodexRequestParams {
  model: string;
  messages: CodexMessage[];
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: 'low' | 'medium' | 'high';
}

/**
 * Response format matching OpenAI SDK
 */
export interface CodexSDKResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
  };
}

// ============================================
// Environment Helpers
// ============================================

/**
 * Scrub environment to remove API keys.
 * Forces CLI to use subscription authentication.
 */
function scrubEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Remove API keys to force subscription auth
  const keysToRemove = [
    'OPENAI_API_KEY',
    'GOOGLE_API_KEY',
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
 * Build prompt string from messages array.
 * Uses XML-style tags for clear role separation.
 */
function buildPrompt(messages: CodexMessage[]): string {
  const parts: string[] = [];

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
 * Check for specific error types in output.
 */
function checkForErrors(text: string): void {
  const lower = text.toLowerCase();

  if (
    lower.includes('auth') ||
    lower.includes('unauthorized') ||
    lower.includes('login')
  ) {
    throw new CLIAuthError('codex', text);
  }

  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('not supported'))
  ) {
    throw new CLIModelError('codex', 'unknown');
  }
}

/**
 * Parse JSONL event stream output from Codex CLI.
 *
 * Event types:
 * - thread.started: Contains thread_id
 * - item.completed: Contains response text in item.text
 * - turn.completed: Contains usage statistics
 * - error: Error message
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

  let text = '';
  let usage: CLIUsage | undefined;
  let sessionId: string | undefined;

  // Parse JSONL (line-by-line events)
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);
      const eventType = event.type || '';

      if (eventType === 'thread.started') {
        sessionId = event.thread_id;
        logVerbose(`Codex session: ${sessionId}`);
      } else if (eventType === 'item.completed') {
        const item = event.item || {};
        if (item.text) {
          text = item.text;
        }
      } else if (eventType === 'turn.completed') {
        const usageData = event.usage || {};
        if (usageData) {
          usage = {
            promptTokens: usageData.input_tokens || 0,
            completionTokens: usageData.output_tokens || 0,
            totalTokens:
              (usageData.input_tokens || 0) + (usageData.output_tokens || 0),
            thinkingTokens: usageData.reasoning_tokens || 0,
            cachedPromptTokens: usageData.cached_input_tokens || 0,
          };
        }
      } else if (eventType === 'error') {
        checkForErrors(event.message || 'Unknown error');
      } else if (eventType === 'turn.failed') {
        const errorData = event.error || {};
        checkForErrors(errorData.message || 'Turn failed');
      }
    } catch {
      // Not JSON, might be plain text response
      if (!text && trimmed) {
        text = trimmed;
      }
    }
  }

  // If still no text, use raw output
  if (!text) {
    text = output;
  }

  return { text, usage };
}

// ============================================
// CLI Execution
// ============================================

/**
 * Execute Codex CLI command.
 */
async function executeCLI(
  prompt: string,
  model: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  const cliPath = getCLIPath('codex');

  if (!cliPath) {
    throw new CLINotFoundError('codex');
  }

  const resolvedModel = MODEL_ALIASES[model] || model;

  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '--model',
    resolvedModel,
  ];

  logVerbose(`Executing: codex ${args.slice(0, 4).join(' ')}...`);
  logVerbose(`Model: ${resolvedModel}, Prompt length: ${prompt.length} chars`);

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
      reject(new CLITimeoutError('codex', timeoutMs));
    }, timeoutMs);

    // Send prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

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
        reject(new CLIError(`CLI exited with code ${code}`, 'codex', code));
        return;
      }

      resolve({ stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new CLIError(`Failed to spawn CLI: ${err.message}`, 'codex'));
    });
  });
}

// ============================================
// Wrapper Class
// ============================================

/**
 * Codex CLI Wrapper class providing SDK-compatible interface.
 *
 * Usage:
 * ```typescript
 * const client = new CodexCLIWrapper({ model: 'gpt-5.2' });
 * const response = await client.chat.completions.create({
 *   model: 'gpt-5.2',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * console.log(response.choices[0].message.content);
 * ```
 */
export class CodexCLIWrapper {
  private timeout: number;
  private model: string;

  constructor(options?: { model?: string; timeout?: number }) {
    this.model = options?.model || DEFAULT_MODEL;
    this.timeout = options?.timeout || DEFAULT_CLI_TIMEOUT_MS;

    // Verify CLI is available
    const detection = detectCLI('codex');
    if (!detection.available) {
      throw new CLINotFoundError('codex');
    }

    logVerbose(
      `CodexCLIWrapper initialized: model=${this.model}, timeout=${this.timeout}ms`
    );
    if (detection.version) {
      logVerbose(`Codex CLI version: ${detection.version}`);
    }
  }

  /**
   * SDK-compatible chat interface.
   */
  chat = {
    completions: {
      create: async (params: CodexRequestParams): Promise<CodexSDKResponse> => {
        const prompt = buildPrompt(params.messages);
        const model = params.model || this.model;

        const { stdout, stderr } = await executeCLI(
          prompt,
          model,
          this.timeout
        );
        const { text, usage } = parseOutput(stdout, stderr);

        logVerbose(
          `Codex response: ${text.length} chars, ${usage?.totalTokens || 0} tokens`
        );

        return {
          id: `cli-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: MODEL_ALIASES[model] || model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: text,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: usage?.promptTokens || 0,
            completion_tokens: usage?.completionTokens || 0,
            total_tokens: usage?.totalTokens || 0,
            reasoning_tokens: usage?.thinkingTokens,
          },
        };
      },
    },
  };
}

// ============================================
// Factory Function
// ============================================

/**
 * Factory function to get Codex CLI client.
 * Returns null if CLI is not available.
 *
 * @param options - Optional configuration
 * @returns CodexCLIWrapper instance or null
 */
export function getCodexCLIClient(options?: {
  model?: string;
  timeout?: number;
}): CodexCLIWrapper | null {
  try {
    return new CodexCLIWrapper(options);
  } catch (err) {
    if (err instanceof CLINotFoundError) {
      logWarning('Codex CLI not found, wrapper unavailable');
      return null;
    }
    throw err;
  }
}
