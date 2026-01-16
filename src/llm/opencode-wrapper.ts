/**
 * OpenCode CLI Wrapper
 *
 * Provides SDK-compatible interfaces for multiple providers through the
 * OpenCode CLI. This is the highest priority tier in the fallback chain,
 * using subscription authentication (Google OAuth, ChatGPT OAuth) via
 * OpenCode plugins.
 *
 * Command pattern: opencode run <prompt> --model=<provider>/<model> --format=json
 *
 * Features:
 * - Dual-provider support (Google & OpenAI)
 * - SDK-compatible interfaces matching native SDKs
 * - Environment scrubbing (removes ALL API keys)
 * - Response format translation
 * - Comprehensive error classification
 * - Usage/token tracking from CLI output
 *
 * @see https://opencode.ai
 */

import { spawn } from 'child_process';
import type { CLIUsage, OpenCodeProvider, OpenCodeConfig } from './types.js';
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
// Model Aliases
// ============================================

const GOOGLE_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-flash-preview': 'gemini-3-flash-preview',
  'gemini-3-pro-preview': 'gemini-3-pro-preview',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  flash: 'gemini-3-flash-preview',
  pro: 'gemini-3-pro-preview',
};

const OPENAI_MODEL_ALIASES: Record<string, string> = {
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  gpt5: 'gpt-5.2',
  codex: 'gpt-5.2-codex',
};

const MODEL_ALIASES: Record<OpenCodeProvider, Record<string, string>> = {
  google: GOOGLE_MODEL_ALIASES,
  openai: OPENAI_MODEL_ALIASES,
};

// Default models per provider
const DEFAULT_MODELS: Record<OpenCodeProvider, string> = {
  google: 'gemini-3-flash-preview',
  openai: 'gpt-5.2',
};

// ============================================
// Types
// ============================================

// OpenAI-compatible types
export interface OpenCodeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpenCodeChatParams {
  model: string;
  messages: OpenCodeMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface OpenCodeChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Google GenAI-compatible types
export type OpenCodeContent = string | Array<{ text: string }>;

export interface OpenCodeGenerateParams {
  model: string;
  contents: OpenCodeContent;
  config?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
}

export interface OpenCodeGenerateResponse {
  text: string;
  candidates: Array<{
    content: { parts: Array<{ text: string }> };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Scrub environment to remove ALL API keys.
 * Forces CLI to use subscription authentication via plugins.
 */
function scrubEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Remove ALL API keys to force subscription auth
  const keysToRemove = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_AI_API_KEY',
    'GOOGLE_GENAI_API_KEY',
    'PERPLEXITY_API_KEY',
    'OPENROUTER_API_KEY',
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

/**
 * Build prompt from messages (OpenAI style).
 */
function buildPromptFromMessages(messages: OpenCodeMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      parts.push(`System: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      parts.push(`Assistant: ${msg.content}`);
    } else {
      parts.push(`User: ${msg.content}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Build prompt from contents (Google style).
 */
function buildPromptFromContents(contents: OpenCodeContent): string {
  if (typeof contents === 'string') {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents.map((item) => item.text).join('\n');
  }

  return String(contents);
}

/**
 * Check for specific error types and throw appropriate exception.
 */
function checkForErrors(text: string): void {
  const lower = text.toLowerCase();

  if (
    lower.includes('auth') ||
    lower.includes('unauthorized') ||
    lower.includes('login') ||
    lower.includes('token') ||
    lower.includes('credential')
  ) {
    throw new CLIAuthError('opencode', text);
  }

  if (
    lower.includes('model') &&
    (lower.includes('not supported') ||
      lower.includes('unavailable') ||
      lower.includes('not found'))
  ) {
    throw new CLIModelError('opencode', 'unknown');
  }

  if (lower.includes('plugin') || lower.includes('provider')) {
    throw new CLIError(`OpenCode provider error: ${text}`, 'opencode');
  }

  if (text.trim()) {
    throw new CLIError(text, 'opencode');
  }
}

/**
 * Extract data from JSON response object.
 */
function extractFromJSON(data: Record<string, unknown>): {
  text: string;
  usage?: CLIUsage;
  sessionId?: string;
} {
  let text = '';
  let usage: CLIUsage | undefined;
  let sessionId: string | undefined;

  // Extract text
  text =
    (data.response as string) ||
    (data.text as string) ||
    (data.content as string) ||
    (data.output as string) ||
    '';

  // Extract session ID
  sessionId =
    (data.session_id as string) ||
    (data.thread_id as string) ||
    (data.id as string);

  // Extract usage
  const usageData = (data.usage || data.stats || {}) as Record<string, unknown>;
  if (usageData.models) {
    // Nested stats structure
    const models = usageData.models as Record<
      string,
      { tokens?: Record<string, number> }
    >;
    const modelStats = Object.values(models)[0];
    if (modelStats?.tokens) {
      usage = {
        promptTokens: modelStats.tokens.input || modelStats.tokens.prompt || 0,
        completionTokens:
          modelStats.tokens.candidates || modelStats.tokens.output || 0,
        totalTokens: modelStats.tokens.total || 0,
        thinkingTokens: modelStats.tokens.thoughts || 0,
      };
    }
  } else if (Object.keys(usageData).length > 0) {
    usage = {
      promptTokens:
        (usageData.input_tokens as number) ||
        (usageData.prompt_tokens as number) ||
        0,
      completionTokens:
        (usageData.output_tokens as number) ||
        (usageData.completion_tokens as number) ||
        0,
      totalTokens: (usageData.total_tokens as number) || 0,
      thinkingTokens: (usageData.thinking_tokens as number) || 0,
    };
  }

  // Check for errors
  if (data.error) {
    const errorMsg =
      typeof data.error === 'object'
        ? (data.error as { message?: string }).message
        : String(data.error);
    checkForErrors(errorMsg || 'Unknown error');
  }

  return { text, usage, sessionId };
}

/**
 * Parse CLI output (handles JSON and JSONL formats).
 */
function parseOutput(
  stdout: string,
  stderr: string
): { text: string; usage?: CLIUsage; sessionId?: string } {
  const output = stdout.trim();

  if (!output) {
    if (stderr) {
      checkForErrors(stderr);
    }
    return { text: '' };
  }

  // Try parsing as single JSON object
  try {
    const data = JSON.parse(output) as Record<string, unknown>;
    return extractFromJSON(data);
  } catch {
    // Not single JSON, try JSONL
  }

  // Parse JSONL (line-by-line events)
  let text = '';
  let usage: CLIUsage | undefined;
  let sessionId: string | undefined;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const eventType = (event.type as string) || '';

      // OpenCode CLI event types
      if (eventType === 'step_start') {
        sessionId =
          (event.sessionID as string) || (event.session_id as string);
      } else if (eventType === 'text') {
        const part = (event.part || {}) as Record<string, unknown>;
        if (part.text) {
          text = part.text as string;
        }
      } else if (eventType === 'step_finish') {
        const part = (event.part || {}) as Record<string, unknown>;
        const tokens = (part.tokens || {}) as Record<string, number>;
        if (Object.keys(tokens).length > 0) {
          usage = {
            promptTokens: tokens.input || 0,
            completionTokens: tokens.output || 0,
            totalTokens: (tokens.input || 0) + (tokens.output || 0),
            thinkingTokens: tokens.reasoning || 0,
          };
        }
      } else if (eventType === 'turn.completed') {
        const usageData = (event.usage || {}) as Record<string, number>;
        if (Object.keys(usageData).length > 0) {
          usage = {
            promptTokens: usageData.input_tokens || 0,
            completionTokens: usageData.output_tokens || 0,
            totalTokens:
              (usageData.input_tokens || 0) + (usageData.output_tokens || 0),
          };
        }
      } else if (eventType === 'error' || eventType === 'turn.failed') {
        const errorObj = event.error as Record<string, unknown> | undefined;
        const errorMsg =
          (event.message as string) ||
          (errorObj?.message as string) ||
          'Unknown error';
        checkForErrors(errorMsg);
      }
    } catch {
      // Not JSON, might be plain text
      if (!text && trimmed) {
        text = trimmed;
      }
    }
  }

  if (!text) {
    text = output;
  }

  return { text, usage, sessionId };
}

/**
 * Execute OpenCode CLI command.
 */
async function executeCLI(
  prompt: string,
  provider: OpenCodeProvider,
  model: string,
  timeoutMs: number,
  workingDir?: string
): Promise<{ stdout: string; stderr: string }> {
  const cliPath = getCLIPath('opencode');

  if (!cliPath) {
    throw new CLINotFoundError('opencode');
  }

  const aliases = MODEL_ALIASES[provider] || {};
  const resolvedModel = aliases[model] || model;
  const modelRef = `${provider}/${resolvedModel}`;

  const args = ['run', prompt, `--model=${modelRef}`, '--format=json'];

  logVerbose(`Executing: opencode run ... --model=${modelRef}`);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn(cliPath, args, {
      env: scrubEnvironment(),
      cwd: workingDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      reject(new CLITimeoutError('opencode', timeoutMs));
    }, timeoutMs);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) return;

      if (code !== 0 && code !== null) {
        try {
          checkForErrors(stderr || stdout || `CLI exited with code ${code}`);
        } catch (err) {
          reject(err);
          return;
        }
        reject(new CLIError(`CLI exited with code ${code}`, 'opencode', code));
        return;
      }

      resolve({ stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new CLIError(`Failed to spawn CLI: ${err.message}`, 'opencode'));
    });
  });
}

// ============================================
// OpenCode Wrapper Class
// ============================================

/**
 * OpenCode CLI Wrapper providing dual SDK-compatible interfaces.
 *
 * For Google provider: Use `models.generateContent()`
 * For OpenAI provider: Use `chat.completions.create()`
 */
export class OpenCodeWrapper {
  private provider: OpenCodeProvider;
  private model: string;
  private timeout: number;
  private workingDir?: string;

  constructor(config: OpenCodeConfig) {
    this.provider = config.provider;
    this.model = config.model || DEFAULT_MODELS[config.provider];
    this.timeout = config.timeout || DEFAULT_CLI_TIMEOUT_MS;
    this.workingDir = config.workingDir;

    // Verify CLI is available
    const detection = detectCLI('opencode');
    if (!detection.available) {
      throw new CLINotFoundError('opencode');
    }

    logVerbose(
      `OpenCodeWrapper initialized: provider=${this.provider}, model=${this.model}`
    );
  }

  /**
   * OpenAI-compatible chat interface.
   * Use this when provider is 'openai'.
   */
  chat = {
    completions: {
      create: async (
        params: OpenCodeChatParams
      ): Promise<OpenCodeChatResponse> => {
        const prompt = buildPromptFromMessages(params.messages);
        const model = params.model || this.model;

        const { stdout, stderr } = await executeCLI(
          prompt,
          this.provider,
          model,
          this.timeout,
          this.workingDir
        );

        const { text, usage, sessionId } = parseOutput(stdout, stderr);

        return {
          id: sessionId || `opencode-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: usage?.promptTokens || 0,
            completion_tokens: usage?.completionTokens || 0,
            total_tokens: usage?.totalTokens || 0,
          },
        };
      },
    },
  };

  /**
   * Google GenAI-compatible models interface.
   * Use this when provider is 'google'.
   */
  models = {
    generateContent: async (
      params: OpenCodeGenerateParams
    ): Promise<OpenCodeGenerateResponse> => {
      const prompt = buildPromptFromContents(params.contents);
      const model = params.model || this.model;

      const { stdout, stderr } = await executeCLI(
        prompt,
        this.provider,
        model,
        this.timeout,
        this.workingDir
      );

      const { text, usage } = parseOutput(stdout, stderr);

      return {
        text,
        candidates: [
          {
            content: { parts: [{ text }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: usage
          ? {
              promptTokenCount: usage.promptTokens,
              candidatesTokenCount: usage.completionTokens,
              totalTokenCount: usage.totalTokens,
            }
          : undefined,
      };
    },
  };

  /**
   * Low-level generate method for direct prompt execution.
   */
  async generate(prompt: string, model?: string): Promise<string> {
    const { stdout, stderr } = await executeCLI(
      prompt,
      this.provider,
      model || this.model,
      this.timeout,
      this.workingDir
    );

    const { text } = parseOutput(stdout, stderr);
    return text;
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Get OpenCode client for Google provider.
 */
export function getOpenCodeGoogleClient(options?: {
  model?: string;
  timeout?: number;
}): OpenCodeWrapper | null {
  try {
    return new OpenCodeWrapper({
      provider: 'google',
      model: options?.model || DEFAULT_MODELS.google,
      timeout: options?.timeout || DEFAULT_CLI_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof CLINotFoundError) {
      logWarning('OpenCode CLI not found, Google provider unavailable');
      return null;
    }
    throw err;
  }
}

/**
 * Get OpenCode client for OpenAI provider.
 */
export function getOpenCodeOpenAIClient(options?: {
  model?: string;
  timeout?: number;
}): OpenCodeWrapper | null {
  try {
    return new OpenCodeWrapper({
      provider: 'openai',
      model: options?.model || DEFAULT_MODELS.openai,
      timeout: options?.timeout || DEFAULT_CLI_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof CLINotFoundError) {
      logWarning('OpenCode CLI not found, OpenAI provider unavailable');
      return null;
    }
    throw err;
  }
}

/**
 * Check if OpenCode CLI is available.
 */
export function isOpenCodeAvailable(): boolean {
  return detectCLI('opencode').available;
}
