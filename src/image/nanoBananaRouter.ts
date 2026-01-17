/**
 * Nano Banana Image Router
 *
 * Implements three-tier fallback system for image generation:
 * - Tier 1: CLI (subscription billing via Gemini CLI)
 * - Tier 2: API (per-token billing via GOOGLE_AI_API_KEY)
 * - Tier 3: Manual (log instructions for user to generate manually)
 *
 * Priority: CLI -> API -> Manual
 *
 * Environment variables:
 * - USE_NANO_BANANA: Enable CLI tier (default: true)
 * - GOOGLE_AI_API_KEY: Required for API tier
 *
 * @see docs/plan-cli-image-fallback-system.md for full architecture
 */

import type { InfographicBrief } from '../schemas/synthesisResult.js';
import type { PipelineConfig } from '../types/index.js';
import { RESOLUTION_TO_IMAGE_SIZE, STAGE_TIMEOUT_MS } from '../types/index.js';
import { detectCLI } from '../llm/cli-detector.js';
import { logInfo, logWarning, logVerbose, logSuccess, sanitize } from '../utils/logger.js';
import { buildInfographicPrompt, makeImageRequest, parseImageResponse } from './nanoBanana.js';
import { withRetryAndTimeout } from '../utils/retry.js';
import { getNanoBananaCLIClient } from './nanoBananaCli.js';
import {
  NanoBananaError,
  NanoBananaNotFoundError,
  NanoBananaAuthError,
  NanoBananaTimeoutError,
  NanoBananaGenerationError,
  type ImageRouterResult,
  type ImageRouterOptions,
  type ImageGenerationTier,
} from './types.js';

// ============================================
// Environment Helpers
// ============================================

/**
 * Parse boolean from environment variable.
 * Treats 'true', '1', 'yes' as true (case-insensitive).
 * Treats 'false', '0', 'no' as false.
 * Returns default for undefined or empty values.
 *
 * @param value - Environment variable value
 * @param defaultValue - Default if undefined/empty
 * @returns Parsed boolean
 */
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') {
    return true;
  }
  if (lower === 'false' || lower === '0' || lower === 'no') {
    return false;
  }
  return defaultValue;
}

// ============================================
// Availability Checks
// ============================================

/**
 * Check if Nano Banana CLI should be used for image generation.
 *
 * Checks:
 * 1. USE_NANO_BANANA env var (default: true)
 * 2. Gemini CLI availability via detectCLI('gemini')
 *
 * @returns true if CLI tier is enabled and available
 *
 * @example
 * ```typescript
 * if (shouldUseNanoBananaCLI()) {
 *   // Try CLI-based generation first
 *   const buffer = await cliClient.generateImageBytes(prompt);
 * }
 * ```
 */
export function shouldUseNanoBananaCLI(): boolean {
  // Check environment variable (default: true for backward compat with CLI-first approach)
  const envEnabled = parseBoolEnv(process.env.USE_NANO_BANANA, true);

  if (!envEnabled) {
    logVerbose('Nano Banana CLI disabled via USE_NANO_BANANA env');
    return false;
  }

  // Check if Gemini CLI is available on the system
  const detection = detectCLI('gemini');

  if (!detection.available) {
    logVerbose('Nano Banana CLI enabled but gemini CLI not available');
    return false;
  }

  logVerbose(`Nano Banana CLI available: gemini v${detection.version || 'unknown'}`);
  return true;
}

/**
 * Check if API tier is available (GOOGLE_AI_API_KEY set).
 *
 * @returns true if API key is configured
 */
function isAPIAvailable(): boolean {
  return !!process.env.GOOGLE_AI_API_KEY;
}

// ============================================
// Error Classification
// ============================================

/**
 * Check if an error should trigger fallback to next tier.
 *
 * Errors that trigger fallback:
 * - NanoBananaNotFoundError: CLI not installed
 * - NanoBananaAuthError: CLI authentication failed
 * - NanoBananaTimeoutError: CLI timeout exceeded
 * - NanoBananaGenerationError: CLI generation failed
 * - NanoBananaError: Base CLI error class
 *
 * Other errors are NOT caught and will be re-thrown,
 * as they indicate unexpected issues that shouldn't be silently ignored.
 *
 * @param error - Error to classify
 * @returns true if fallback should be attempted
 */
export function shouldFallbackFromCLI(error: unknown): boolean {
  // Known recoverable CLI errors trigger fallback
  if (error instanceof NanoBananaNotFoundError) {
    return true;
  }
  if (error instanceof NanoBananaAuthError) {
    return true;
  }
  if (error instanceof NanoBananaTimeoutError) {
    return true;
  }
  if (error instanceof NanoBananaGenerationError) {
    return true;
  }
  // Base class catches any NanoBanana-specific errors
  if (error instanceof NanoBananaError) {
    return true;
  }

  // Do NOT fallback on unexpected errors - rethrow them
  return false;
}

// ============================================
// API Tier Implementation
// ============================================

/**
 * Generate infographic via direct API call (Tier 2).
 *
 * This is the existing API-based implementation, extracted for use
 * as the fallback tier in the router.
 *
 * @param brief - Infographic brief from synthesis
 * @param config - Pipeline configuration
 * @returns Buffer containing image data, or null on failure
 */
async function generateInfographicViaAPI(
  brief: InfographicBrief,
  config: PipelineConfig
): Promise<Buffer | null> {
  // Map resolution string to API format
  const resolution = RESOLUTION_TO_IMAGE_SIZE[config.imageResolution] ?? '2K';
  const resolutionLabel = config.imageResolution;

  logVerbose(`API tier: Generating ${resolution} infographic: "${brief.title}"`);

  // Build prompt
  const prompt = buildInfographicPrompt(brief, resolutionLabel);
  logVerbose(`API tier: Prompt length: ${prompt.length} characters`);

  // Make API request with retry and timeout
  const result = await withRetryAndTimeout(
    async () => {
      const response = await makeImageRequest(prompt, resolution);
      const imageBuffer = parseImageResponse(response);

      if (!imageBuffer) {
        throw new Error('No image data in API response');
      }

      return imageBuffer;
    },
    STAGE_TIMEOUT_MS,
    {
      maxRetries: 2,
      baseDelayMs: 2000,
      operationName: 'Image generation (API)',
    }
  );

  if (result.success) {
    return result.data;
  }

  // Log but don't throw - API tier failure should fall through to manual tier
  logWarning(`API tier failed: ${sanitize(result.error.message)}`);
  return null;
}

// ============================================
// Manual Tier Instructions
// ============================================

/**
 * Log manual mode instructions for user.
 *
 * When both CLI and API tiers are unavailable, provide the user
 * with the prompt they can paste into Gemini web interface.
 *
 * @param brief - Infographic brief containing title and key points
 */
function logManualModeInstructions(brief: InfographicBrief): void {
  logWarning('Image generation unavailable (no CLI or API key)');
  logInfo('To generate manually, paste this prompt into Gemini web:');
  logInfo('');
  logInfo(`Title: ${brief.title}`);

  // Show first 3 key points for brevity
  const pointsToShow = brief.keyPoints.slice(0, 3);
  logInfo(`Key points: ${pointsToShow.join(', ')}`);

  if (brief.keyPoints.length > 3) {
    logInfo(`  (+ ${brief.keyPoints.length - 3} more points)`);
  }

  logInfo('');
  logInfo('Visit: https://gemini.google.com/');
  logInfo('Use /generate command or Nano Banana extension');
}

// ============================================
// Main Router
// ============================================

/**
 * Route image generation through the three-tier fallback system.
 *
 * Attempts image generation in order:
 * 1. CLI tier (subscription billing) - if enabled and CLI available
 * 2. API tier (per-token billing) - if API key configured
 * 3. Manual tier (no generation) - logs instructions for user
 *
 * CLI errors trigger automatic fallback to API tier.
 * API errors trigger automatic fallback to manual tier.
 * Unexpected errors are re-thrown.
 *
 * @param brief - Infographic brief from synthesis stage
 * @param config - Pipeline configuration
 * @param options - Router options to control tier availability
 * @returns ImageRouterResult with buffer (or null), tier used, and tiers attempted
 *
 * @example
 * ```typescript
 * const result = await routeImageGeneration(brief, config);
 *
 * if (result.buffer) {
 *   await writePNG('output/infographic.png', result.buffer);
 *   logInfo(`Image generated via ${result.tier} tier`);
 * } else {
 *   logWarning('No image generated, manual mode active');
 * }
 * ```
 */
export async function routeImageGeneration(
  brief: InfographicBrief,
  config: PipelineConfig,
  options?: ImageRouterOptions
): Promise<ImageRouterResult> {
  const tiersAttempted: ImageGenerationTier[] = [];

  // Check if image generation is skipped globally
  if (config.skipImage) {
    logVerbose('Image generation skipped (--skip-image flag)');
    return { buffer: null, tier: 'manual', tiersAttempted };
  }

  // ============================================
  // Tier 1: CLI (subscription billing)
  // ============================================
  if (options?.enableCLI !== false && shouldUseNanoBananaCLI()) {
    tiersAttempted.push('cli');
    logVerbose('Attempting Tier 1: CLI (subscription billing)');

    try {
      const client = getNanoBananaCLIClient();

      if (client) {
        // Build prompt for CLI
        const resolutionLabel = config.imageResolution;
        const prompt = buildInfographicPrompt(brief, resolutionLabel);

        // Generate image via CLI
        const buffer = await client.generateImageBytes(prompt);

        if (buffer) {
          const sizeKB = Math.round(buffer.length / 1024);
          logSuccess(`Infographic generated via CLI (${sizeKB} KB, subscription billing)`);
          return { buffer, tier: 'cli', tiersAttempted };
        }

        // CLI returned null without error - fall through to API
        logWarning('CLI tier returned no image, falling back to API');
      }
    } catch (error) {
      if (shouldFallbackFromCLI(error)) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logWarning(`CLI tier failed, falling back: ${sanitize(errorMsg)}`);
        // Continue to Tier 2
      } else {
        // Unexpected error - rethrow
        throw error;
      }
    }
  }

  // ============================================
  // Tier 2: API (per-token billing)
  // ============================================
  if (options?.enableAPI !== false && isAPIAvailable()) {
    tiersAttempted.push('api');
    logVerbose('Attempting Tier 2: API (per-token billing)');

    try {
      const buffer = await generateInfographicViaAPI(brief, config);

      if (buffer) {
        const sizeKB = Math.round(buffer.length / 1024);
        logSuccess(`Infographic generated via API (${sizeKB} KB, per-token billing)`);
        return { buffer, tier: 'api', tiersAttempted };
      }

      // API returned null - fall through to manual
      logWarning('API tier returned no image, falling back to manual');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logWarning(`API tier failed: ${sanitize(errorMsg)}`);
      // Continue to Tier 3
    }
  }

  // ============================================
  // Tier 3: Manual (no generation)
  // ============================================
  if (options?.enableManual !== false) {
    tiersAttempted.push('manual');
    logVerbose('Falling back to Tier 3: Manual mode');
    logManualModeInstructions(brief);
  }

  return { buffer: null, tier: 'manual', tiersAttempted };
}

// ============================================
// Status Logging
// ============================================

/**
 * Log the current image router configuration status.
 *
 * Shows which tiers are available and why others might be disabled.
 * Useful for debugging and verifying configuration.
 *
 * @example
 * ```typescript
 * // Output:
 * // Image Router Configuration:
 * //   CLI (subscription): available
 * //   API (per-token): available
 * //   Manual (fallback): always available
 * logImageRouterStatus();
 * ```
 */
export function logImageRouterStatus(): void {
  const cliAvailable = shouldUseNanoBananaCLI();
  const apiAvailable = isAPIAvailable();

  logInfo('Image Router Configuration:');
  logInfo(`  CLI (subscription): ${cliAvailable ? 'available' : 'disabled'}`);
  logInfo(`  API (per-token): ${apiAvailable ? 'available' : 'no key'}`);
  logInfo('  Manual (fallback): always available');

  // Log additional debug info
  if (!cliAvailable) {
    const envEnabled = parseBoolEnv(process.env.USE_NANO_BANANA, true);
    if (!envEnabled) {
      logVerbose('  CLI disabled via USE_NANO_BANANA=false');
    } else {
      logVerbose('  CLI not available: gemini CLI not found in PATH');
    }
  }

  if (!apiAvailable) {
    logVerbose('  API not available: GOOGLE_AI_API_KEY not set');
  }
}

// ============================================
// Exports
// ============================================

export {
  // Re-export types for convenience
  type ImageRouterResult,
  type ImageRouterOptions,
  type ImageGenerationTier,
} from './types.js';
