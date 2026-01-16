/**
 * LLM Module
 *
 * CLI-based LLM wrappers for subscription authentication.
 * Provides SDK-compatible interfaces that route through CLI tools
 * to use subscription billing instead of per-token API credits.
 */

// Types
export type {
  CLITool,
  CLIUsage,
  CLIResponse,
  CLIDetectionResult,
  OpenCodeProvider,
  OpenCodeConfig,
} from './types.js';

export {
  DEFAULT_CLI_TIMEOUT_MS,
  CLIError,
  CLINotFoundError,
  CLIAuthError,
  CLITimeoutError,
  CLIModelError,
} from './types.js';

// CLI Detection
export {
  detectCLI,
  getCLIPath,
  clearCLICache,
  detectAllCLIs,
} from './cli-detector.js';

// Codex CLI Wrapper
export type {
  CodexMessage,
  CodexRequestParams,
  CodexSDKResponse,
} from './codex-cli-wrapper.js';

export { CodexCLIWrapper, getCodexCLIClient } from './codex-cli-wrapper.js';

// Claude CLI Wrapper
export type {
  ClaudeMessage,
  ClaudeRequestParams,
  ClaudeSDKResponse,
} from './claude-cli-wrapper.js';

export { ClaudeCLIWrapper, getClaudeCLIClient } from './claude-cli-wrapper.js';

// Gemini CLI Wrapper
export type {
  GeminiContent,
  GeminiGenerationConfig,
  GeminiRequestParams,
  GeminiSDKResponse,
} from './gemini-cli-wrapper.js';

export { GeminiCLIWrapper, getGeminiCLIClient } from './gemini-cli-wrapper.js';

// OpenCode CLI Wrapper
export type {
  OpenCodeMessage,
  OpenCodeChatParams,
  OpenCodeChatResponse,
  OpenCodeContent,
  OpenCodeGenerateParams,
  OpenCodeGenerateResponse,
} from './opencode-wrapper.js';

export {
  OpenCodeWrapper,
  getOpenCodeGoogleClient,
  getOpenCodeOpenAIClient,
  isOpenCodeAvailable,
} from './opencode-wrapper.js';
