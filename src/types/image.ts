/**
 * Image Generation Types and Constants
 *
 * Shared definitions for Gemini image generation API interactions
 * used by the image generation module (nanoBanana.ts).
 *
 * @see https://ai.google.dev/gemini-api/docs/image-generation
 */

import type { ImageResolution } from './index.js';
import type { InfographicBrief } from '../schemas/index.js';

// ============================================
// Constants
// ============================================

/**
 * Primary model for image generation.
 * Gemini 3 Pro Image Preview - highest quality output (Dec 2025)
 *
 * This is the single source of truth for the image model constant.
 * Import this from types/index.js rather than defining locally.
 */
export const IMAGE_MODEL = 'gemini-3-pro-image-preview';

/**
 * Fallback model for image generation.
 * Gemini 2.5 Flash Image - faster, lower cost option used when primary fails
 * with retryable errors (5xx server errors or 404 model not found).
 */
export const IMAGE_MODEL_FALLBACK = 'gemini-2.5-flash-image';

/**
 * Image size options supported by Gemini image generation.
 * Maps to the imageConfig.imageSize parameter.
 */
export type ImageSizeOption = '1K' | '2K' | '4K';

/**
 * Maps pipeline config imageResolution to Gemini API ImageSizeOption.
 * Pipeline uses lowercase ('2k', '4k'), API expects uppercase ('2K', '4K').
 */
export const RESOLUTION_TO_IMAGE_SIZE: Record<ImageResolution, ImageSizeOption> = {
  '2k': '2K',
  '4k': '4K',
} as const;

// ============================================
// Types
// ============================================

/**
 * Configuration for image generation requests.
 *
 * Controls the image generation behavior including model selection,
 * resolution, and retry settings.
 */
export interface ImageGenerationConfig {
  /** Image size option for the API (1K, 2K, or 4K) */
  imageSize: ImageSizeOption;

  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;

  /** Operation name for logging */
  operationName?: string;

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
}

/**
 * Options for the generateInfographic function.
 *
 * Extends ImageGenerationConfig with the infographic brief
 * containing the content to generate.
 */
export interface GenerateInfographicOptions {
  /** The infographic content brief from synthesis */
  brief: InfographicBrief;

  /** Skip image generation entirely */
  skip?: boolean;

  /** Image generation configuration */
  config?: Partial<ImageGenerationConfig>;
}

/**
 * Raw response structure from Gemini image generation API.
 *
 * All top-level and nested properties are optional to handle partial API responses
 * gracefully. The Gemini API may return empty candidates, missing content, or
 * blocked prompts - defensive coding with optional chaining is essential.
 *
 * The base64-encoded image data is extracted from:
 * response.candidates[0].content.parts[].inlineData.data
 *
 * @example
 * ```typescript
 * // Safe access pattern:
 * const imageData = response.candidates?.[0]?.content?.parts?.find(
 *   p => p.inlineData?.data
 * )?.inlineData?.data;
 * ```
 */
export interface GeminiImageResponse {
  /** Array of generated candidates (optional - API may return empty) */
  candidates?: Array<{
    /** Content container (optional - candidate may be empty) */
    content?: {
      /** Parts containing the image data (optional - content may be empty) */
      parts?: Array<{
        /** Text content if any */
        text?: string;
        /** Inline image data container */
        inlineData?: {
          /** MIME type (e.g., "image/png") */
          mimeType: string;
          /** Base64-encoded image data */
          data: string;
        };
      }>;
    };
    /** Finish reason for this candidate */
    finishReason?: string;
  }>;
  /**
   * Prompt feedback when content is blocked.
   * Check this field to detect blocked prompts before processing candidates.
   */
  promptFeedback?: {
    /** Reason the prompt was blocked (e.g., "SAFETY", "OTHER") */
    blockReason?: string;
  };
}
