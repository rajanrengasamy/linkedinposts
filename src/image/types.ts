/**
 * Nano Banana CLI Types
 *
 * CLI-specific types, interfaces, and error classes for the Nano Banana
 * image generation fallback system.
 *
 * Priority: CLI (gemini) -> API -> Manual
 *
 * This module defines the type system for CLI-based image generation,
 * enabling subscription-based CLI tools (gemini) to be used before
 * falling back to direct API calls or manual generation.
 *
 * @see docs/PRD-v2.md Section 11 for full requirements
 */

// ============================================
// Constants
// ============================================

/**
 * Default model for Nano Banana CLI image generation.
 * Uses Gemini 3 Pro Image Preview for high-quality infographics.
 */
export const DEFAULT_NANO_BANANA_MODEL = 'gemini-3-pro-image-preview';

/**
 * Timeout for CLI image generation in milliseconds.
 * Images take longer than text generation, so we use a longer timeout.
 * 2 minutes allows for complex infographic generation.
 */
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;

/**
 * Output directory for CLI-generated images.
 * The CLI writes images to this directory before we read them.
 */
export const NANO_BANANA_OUTPUT_DIR = 'nanobanana-output';

// ============================================
// Error Classes
// ============================================

/**
 * Base error class for Nano Banana CLI failures.
 *
 * All Nano Banana errors extend this class, allowing catch blocks
 * to handle any CLI-related error uniformly.
 *
 * @example
 * ```typescript
 * try {
 *   await generateWithCLI(prompt);
 * } catch (error) {
 *   if (error instanceof NanoBananaError) {
 *     console.log(`CLI error (exit ${error.exitCode}): ${error.message}`);
 *   }
 * }
 * ```
 */
export class NanoBananaError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number
  ) {
    super(message);
    this.name = 'NanoBananaError';
  }
}

/**
 * Error thrown when the Nano Banana CLI (gemini) is not found on the system.
 *
 * This indicates the CLI tool needs to be installed or the PATH
 * needs to be configured. Check GEMINI_CLI_PATH environment variable
 * for custom installation paths.
 *
 * @example
 * ```typescript
 * if (!await detectCLI()) {
 *   throw new NanoBananaNotFoundError();
 * }
 * ```
 */
export class NanoBananaNotFoundError extends NanoBananaError {
  constructor() {
    super('Nano Banana (gemini CLI) not found in PATH or configured path');
    this.name = 'NanoBananaNotFoundError';
  }
}

/**
 * Error thrown when CLI authentication fails.
 *
 * This typically means the CLI is installed but not authenticated,
 * or the authentication has expired. The user needs to run
 * `gemini auth` or equivalent to re-authenticate.
 *
 * @example
 * ```typescript
 * if (exitCode === 1 && stderr.includes('auth')) {
 *   throw new NanoBananaAuthError('Session expired');
 * }
 * ```
 */
export class NanoBananaAuthError extends NanoBananaError {
  constructor(details?: string) {
    super(`Nano Banana authentication failed${details ? `: ${details}` : ''}`);
    this.name = 'NanoBananaAuthError';
  }
}

/**
 * Error thrown when CLI image generation times out.
 *
 * Image generation can take significant time. If it exceeds the
 * configured timeout, this error is thrown. Consider increasing
 * the timeout or simplifying the prompt.
 *
 * @example
 * ```typescript
 * const timeoutId = setTimeout(() => {
 *   process.kill();
 *   throw new NanoBananaTimeoutError(DEFAULT_CLI_TIMEOUT_MS);
 * }, timeout);
 * ```
 */
export class NanoBananaTimeoutError extends NanoBananaError {
  constructor(timeoutMs: number) {
    super(`Nano Banana image generation timed out after ${timeoutMs}ms`);
    this.name = 'NanoBananaTimeoutError';
  }
}

/**
 * Error thrown when CLI image generation fails.
 *
 * This is a general error for generation failures that aren't
 * authentication or timeout related. Check the details for
 * specific failure reasons.
 *
 * @example
 * ```typescript
 * if (exitCode !== 0 && !isAuthError && !isTimeout) {
 *   throw new NanoBananaGenerationError(stderr);
 * }
 * ```
 */
export class NanoBananaGenerationError extends NanoBananaError {
  constructor(details?: string) {
    super(`Nano Banana image generation failed${details ? `: ${details}` : ''}`);
    this.name = 'NanoBananaGenerationError';
  }
}

// ============================================
// CLI Response Types
// ============================================

/**
 * Response from CLI execution.
 *
 * Represents the result of running the gemini CLI for image generation.
 * Contains the path to the generated image file (if successful) and
 * metadata about the generation.
 */
export interface NanoBananaCliResponse {
  /** Whether the CLI execution succeeded */
  success: boolean;
  /** Path to the generated image file, or null if failed */
  imagePath: string | null;
  /** Directory where the image was written */
  outputDir: string;
  /** The prompt that was used for generation */
  prompt: string;
  /** Model used for generation */
  model: string;
  /** Optional success/error message */
  message?: string;
  /** Raw CLI output for debugging */
  rawOutput?: string;
}

// ============================================
// Router Types
// ============================================

/**
 * Tier identifiers for image generation routing.
 *
 * - cli: Use the gemini CLI (subscription-based, no API costs)
 * - api: Use direct API calls (requires API key, incurs costs)
 * - manual: Fall back to manual generation instructions
 */
export type ImageGenerationTier = 'cli' | 'api' | 'manual';

/**
 * Result from the image generation router.
 *
 * Contains the generated image buffer (if successful) and metadata
 * about which tier was used and what tiers were attempted.
 *
 * @example
 * ```typescript
 * const result = await routeImageGeneration(brief, config);
 * if (result.buffer) {
 *   console.log(`Generated via ${result.tier}`);
 * } else {
 *   console.log(`Failed tiers: ${result.tiersAttempted.join(', ')}`);
 * }
 * ```
 */
export interface ImageRouterResult {
  /** Generated image buffer, or null if all tiers failed */
  buffer: Buffer | null;
  /** Tier that successfully generated the image (or 'manual' if all failed) */
  tier: ImageGenerationTier;
  /** List of tiers that were attempted (in order) */
  tiersAttempted: string[];
}

/**
 * Configuration options for the image generation router.
 *
 * Allows enabling/disabling specific tiers and configuring
 * timeout for CLI operations.
 *
 * @example
 * ```typescript
 * const options: ImageRouterOptions = {
 *   enableCLI: true,
 *   enableAPI: true,
 *   enableManual: true,
 *   timeout: 120_000,
 * };
 * ```
 */
export interface ImageRouterOptions {
  /** Enable CLI tier (default: true) */
  enableCLI?: boolean;
  /** Enable API tier (default: true) */
  enableAPI?: boolean;
  /** Enable manual fallback tier (default: true) */
  enableManual?: boolean;
  /** Timeout for CLI operations in milliseconds (default: DEFAULT_CLI_TIMEOUT_MS) */
  timeout?: number;
}

// ============================================
// Prompt Export Types
// ============================================

/**
 * Image generation mode
 * - 'api': Generate via Gemini API (existing behavior)
 * - 'export': Export prompts for manual generation (default)
 */
export type ImageGenerationMode = 'api' | 'export';

/**
 * Prompt export metadata for a single infographic.
 *
 * Contains information about a generated prompt file,
 * including the infographic brief details.
 */
export interface PromptExportMetadata {
  /** Post number (1, 2, or 3) */
  postNumber: number;
  /** Relative file path within image-assets directory */
  file: string;
  /** Character count of the prompt */
  charCount: number;
  /** Infographic brief summary */
  infographicBrief: {
    title: string;
    keyPoints: string[];
    suggestedStyle: string;
    accentColor?: string;
  };
}

/**
 * Result from prompt export operation.
 *
 * Contains paths to all generated files and metadata
 * about the export operation.
 */
export interface PromptExportResult {
  /** Directory where assets were written */
  outputDir: string;
  /** Number of prompts generated */
  promptCount: number;
  /** Paths to generated files */
  files: {
    brandingBookMd: string;
    brandingBookJson: string;
    metadataJson: string;
    readmeMd: string;
    prompts: string[];
  };
}
