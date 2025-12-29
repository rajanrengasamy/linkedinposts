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
export { generateInfographic } from './nanoBanana.js';

/**
 * Get the cost for image generation based on resolution.
 */
export { getImageCost } from './nanoBanana.js';

// ============================================
// Types (re-exported from types/)
// ============================================

export type { GeminiImageResponse } from '../types/image.js';

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
// Internal Utilities (exported for testing)
// ============================================

/**
 * Build an image generation prompt from an InfographicBrief.
 * Exported for unit testing prompt generation logic.
 */
export { buildInfographicPrompt } from './nanoBanana.js';

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
