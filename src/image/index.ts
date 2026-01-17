/**
 * Image Generation Module
 *
 * Exports the Nano Banana Pro (Gemini Image) generation functionality.
 *
 * @see docs/PRD-v2.md Section 11 for full requirements
 */

// ============================================
// Public API
// ============================================

/**
 * Main function to generate infographic images (non-blocking).
 * Returns null on skip or failure; pipeline continues without image.
 */
export { generateInfographic, generateMultipleInfographics } from './nanoBanana.js';

/**
 * Get the cost for image generation based on resolution.
 */
export { getImageCost } from './nanoBanana.js';

// ============================================
// Types (re-exported from types/)
// ============================================

export type { GeminiImageResponse } from '../types/image.js';

// ============================================
// CLI Types (for Nano Banana fallback system)
// ============================================

/**
 * CLI-specific types and error classes for Nano Banana image generation.
 */
export {
  // Error classes
  NanoBananaError,
  NanoBananaNotFoundError,
  NanoBananaAuthError,
  NanoBananaTimeoutError,
  NanoBananaGenerationError,
  // Constants
  DEFAULT_NANO_BANANA_MODEL,
  DEFAULT_CLI_TIMEOUT_MS,
  NANO_BANANA_OUTPUT_DIR,
} from './types.js';

export type {
  NanoBananaCliResponse,
  ImageGenerationTier,
  ImageRouterResult,
  ImageRouterOptions,
} from './types.js';

// ============================================
// Constants (re-exported from types/ as single source of truth)
// ============================================

/**
 * The Gemini model used for image generation.
 * Re-exported from types/index.js (authoritative source).
 */
export { IMAGE_MODEL } from '../types/index.js';

/**
 * Maps '2k'/'4k' to API resolution strings ('2K'/'4K').
 * Re-exported from types/index.js (authoritative source).
 */
export { RESOLUTION_TO_IMAGE_SIZE } from '../types/index.js';

/**
 * Cost per resolution (from utils/cost.ts - single source of truth).
 */
export { IMAGE_COSTS } from '../utils/cost.js';

/**
 * Prompt building constants.
 */
export {
  MAX_TITLE_LENGTH,
  MAX_KEY_POINT_LENGTH,
  MAX_KEY_POINTS,
  STYLE_INSTRUCTIONS,
  DEFAULT_COLOR_SCHEME,
} from './nanoBanana.js';

// ============================================
// Validation Utilities
// ============================================

/**
 * Validate that an image size string is in expected format.
 */
export { isValidImageSize } from './nanoBanana.js';

/**
 * Get recommended image sizes for LinkedIn content.
 */
export { getRecommendedImageSizes } from './nanoBanana.js';

// ============================================
// Router (three-tier fallback system)
// ============================================

/**
 * Route image generation through CLI -> API -> Manual fallback system.
 */
export { routeImageGeneration, shouldUseNanoBananaCLI, logImageRouterStatus, shouldFallbackFromCLI } from './nanoBananaRouter.js';

// ============================================
// CLI Wrapper
// ============================================

/**
 * CLI wrapper for Nano Banana image generation.
 */
export { NanoBananaCLIWrapper, getNanoBananaCLIClient, isNanoBananaCliAvailable } from './nanoBananaCli.js';

// ============================================
// Internal Utilities (exported for testing and router)
// ============================================

/**
 * Build an image generation prompt from an InfographicBrief.
 * Exported for unit testing prompt generation logic.
 */
export { buildInfographicPrompt } from './nanoBanana.js';

/**
 * Generate infographic via direct API call (Tier 2).
 * Used by nanoBananaRouter.ts for the API fallback tier.
 * @internal
 */
export { generateInfographicViaAPI } from './nanoBanana.js';

/**
 * Check if an error is retryable with the fallback model.
 * Used by nanoBananaRouter.ts to determine fallback behavior.
 * @internal
 */
export { isRetryableForFallback } from './nanoBanana.js';

/**
 * Parse Gemini API response to extract image buffer.
 * Exported for unit testing response parsing logic.
 */
export { parseImageResponse } from './nanoBanana.js';

/**
 * Make the actual API request to Gemini for image generation.
 * Exported for mocking in integration tests.
 */
export { makeImageRequest } from './nanoBanana.js';

/**
 * Get an initialized Gemini client for image generation.
 * Exported for testing client initialization.
 */
export { getImageClient } from './nanoBanana.js';

/**
 * Extract HTTP status code from error if available.
 * Exported for unit testing error handling logic.
 */
export { extractStatusCode } from './nanoBanana.js';

/**
 * Get user-friendly error message for specific HTTP status codes.
 * Exported for unit testing error message generation.
 */
export { getStatusCodeMessage } from './nanoBanana.js';
