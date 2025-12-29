/**
 * Nano Banana Pro Image Generation
 *
 * Implements Section 11 - Infographic generation using Google's Gemini Image model.
 *
 * This module provides:
 * - InfographicBrief to image prompt conversion
 * - Style-specific instruction templates
 * - Input sanitization for prompt security
 * - Content truncation to prevent excessive prompt length
 * - API client for image generation
 * - Non-blocking failure handling (pipeline continues without image)
 *
 * @see docs/PRD-v2.md Section 11 for full requirements
 */

import { GoogleGenAI } from '@google/genai';
import type { InfographicBrief, InfographicStyle } from '../schemas/synthesisResult.js';
import type { PipelineConfig, GeminiImageResponse, ImageResolution } from '../types/index.js';
import { STAGE_TIMEOUT_MS, IMAGE_MODEL, IMAGE_MODEL_FALLBACK, RESOLUTION_TO_IMAGE_SIZE } from '../types/index.js';
import { sanitizePromptContent } from '../utils/sanitization.js';
import { logVerbose, logWarning, logSuccess, sanitize } from '../utils/logger.js';
import { withRetryAndTimeout } from '../utils/retry.js';
import { getApiKey } from '../config.js';
import { IMAGE_COSTS } from '../utils/cost.js';

// ============================================
// Constants
// ============================================

// IMAGE_MODEL and RESOLUTION_TO_IMAGE_SIZE are imported from types/index.js
// as the single source of truth for these constants.

/**
 * Maximum length for the infographic title in prompts.
 * Longer titles are truncated to prevent excessive prompt length.
 */
const MAX_TITLE_LENGTH = 100;

/**
 * Maximum length for each key point in prompts.
 * Longer points are truncated with ellipsis.
 */
const MAX_KEY_POINT_LENGTH = 150;

/**
 * Maximum number of key points to include in prompt.
 * Additional points are omitted to keep prompt focused.
 */
const MAX_KEY_POINTS = 5;

/**
 * Maximum length for color scheme description.
 */
const MAX_COLOR_SCHEME_LENGTH = 50;

/**
 * Default color scheme when not specified.
 */
const DEFAULT_COLOR_SCHEME = 'professional blue and white';

/**
 * Maximum API prompt length to prevent excessive costs
 */
const MAX_API_PROMPT_LENGTH = 50000;

/**
 * Minimum valid image size in bytes.
 * Images smaller than this are likely error responses, not real images.
 * A 1KB threshold catches most error/placeholder responses.
 */
const MIN_IMAGE_SIZE_BYTES = 1000;

/**
 * PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
 * All valid PNG files begin with this 8-byte signature.
 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * JPEG magic bytes: FF D8 FF
 * All valid JPEG files begin with this 3-byte signature.
 */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Validate that a buffer contains valid PNG or JPEG image data.
 *
 * Checks the magic bytes at the start of the buffer to verify
 * the data is actually an image file, not malformed base64 or
 * an error response decoded as binary.
 *
 * @param buffer - The buffer to validate
 * @returns True if buffer starts with PNG or JPEG magic bytes
 */
function isValidImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;

  const isPng = buffer.subarray(0, 8).equals(PNG_MAGIC);
  const isJpeg = buffer.subarray(0, 3).equals(JPEG_MAGIC);

  return isPng || isJpeg;
}

// ============================================
// Error Handling Utilities
// ============================================

/**
 * Extract HTTP status code from error if available
 *
 * @param error - Error object to inspect
 * @returns HTTP status code or undefined
 */
function extractStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const anyError = error as Record<string, unknown>;

  // Direct status property
  if (typeof anyError.status === 'number') {
    return anyError.status;
  }
  if (typeof anyError.statusCode === 'number') {
    return anyError.statusCode;
  }

  // Nested response object
  if (anyError.response && typeof anyError.response === 'object') {
    const resp = anyError.response as Record<string, unknown>;
    if (typeof resp.status === 'number') {
      return resp.status;
    }
  }

  // Check message for status codes
  if (anyError.message && typeof anyError.message === 'string') {
    const match = anyError.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return undefined;
}

/**
 * Get user-friendly error message for specific HTTP status codes
 *
 * @param statusCode - HTTP status code
 * @returns Human-readable error message
 */
function getStatusCodeMessage(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Invalid request - check prompt format and parameters';
    case 401:
      return 'Authentication failed - check GOOGLE_AI_API_KEY';
    case 403:
      return 'Access denied - API key may lack image generation permissions';
    case 404:
      return 'Model not found - image generation model may not be available';
    case 429:
      return 'Rate limited - too many requests, will retry with backoff';
    case 500:
      return 'Server error - Gemini service temporarily unavailable';
    case 503:
      return 'Service unavailable - Gemini service is overloaded';
    default:
      return `HTTP ${statusCode} error`;
  }
}

/**
 * Check if an error is retryable with the fallback model.
 *
 * We retry with fallback on:
 * - 5xx server errors (service temporarily unavailable)
 * - 404 (model not found - primary model may not be available)
 *
 * We do NOT retry on:
 * - 400 (bad request - prompt issue, won't help to retry)
 * - 401/403 (auth issues - same key for fallback)
 * - 429 (rate limit - handled by withRetry)
 *
 * @param error - Error to check
 * @returns True if the error warrants trying a fallback model
 */
function isRetryableForFallback(error: unknown): boolean {
  const statusCode = extractStatusCode(error);
  if (!statusCode) return false;

  // 5xx server errors and 404 (model not found) are retryable with fallback
  return statusCode >= 500 || statusCode === 404;
}

// ============================================
// Client Initialization
// ============================================

/**
 * Get an initialized Gemini client for image generation
 *
 * Retrieves the API key from environment and creates a new GoogleGenAI
 * instance. Uses the same API key as the scoring module (GOOGLE_AI_API_KEY).
 *
 * @returns Initialized GoogleGenAI client
 * @throws Error if GOOGLE_AI_API_KEY is not set
 */
export function getImageClient(): GoogleGenAI {
  const apiKey = getApiKey('GOOGLE_AI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'GOOGLE_AI_API_KEY is required for image generation. ' +
        'Please set it in your .env file or environment.'
    );
  }
  return new GoogleGenAI({ apiKey });
}

// ============================================
// Style-Specific Instructions
// ============================================

/**
 * Style-specific design instructions for each infographic type.
 *
 * These provide targeted guidance to the image generation model
 * based on the suggested style from the synthesis stage.
 */
const STYLE_INSTRUCTIONS: Record<InfographicStyle, string> = {
  minimal: `Style Guidelines (Minimal):
- Use generous whitespace and clean layouts
- Simple, elegant icons where appropriate
- Limited color palette (2-3 colors max)
- Focus on typography and hierarchy
- Avoid clutter - less is more
- Sans-serif fonts for modern feel`,

  'data-heavy': `Style Guidelines (Data-Heavy):
- Include charts, graphs, or statistical callouts
- Use number visualizations prominently
- Infographic-style data representations
- Clear data labels and annotations
- Comparison visuals where relevant
- Percentage bars, pie charts, or trend lines`,

  'quote-focused': `Style Guidelines (Quote-Focused):
- Large, prominent quote text as centerpiece
- Elegant quotation marks or decorative elements
- Clear author attribution styling
- Typography-driven design
- Complementary imagery that supports the quote
- Inspirational or professional tone`,
};

// ============================================
// Prompt Builder
// ============================================

/**
 * Build an image generation prompt from an InfographicBrief.
 *
 * Converts the structured InfographicBrief into a detailed text prompt
 * suitable for image generation APIs (Nano Banana Pro).
 *
 * Features:
 * - Input sanitization to prevent prompt injection
 * - Style-specific design instructions
 * - Content truncation to manage prompt length
 * - Resolution specification for output quality
 *
 * @param brief - The infographic brief from synthesis stage
 * @param imageSize - Target resolution (e.g., "1080x1080", "1200x628")
 * @returns Formatted prompt string for image generation API
 *
 * @example
 * ```typescript
 * const prompt = buildInfographicPrompt(
 *   {
 *     title: "AI Trends 2025",
 *     keyPoints: ["Point 1", "Point 2", "Point 3"],
 *     suggestedStyle: "minimal",
 *     colorScheme: "blue gradient"
 *   },
 *   "1080x1080"
 * );
 * // Use prompt with image generation API
 * ```
 */
export function buildInfographicPrompt(
  brief: InfographicBrief,
  imageSize: string
): string {
  // Sanitize and truncate title
  const sanitizedTitle = sanitizePromptContent(brief.title, MAX_TITLE_LENGTH);

  // Handle empty keyPoints array defensively (MAJ-3)
  // While Zod schema requires min(1), runtime edge cases could occur
  let keyPointsSection: string;
  if (!brief.keyPoints || brief.keyPoints.length === 0) {
    logWarning('Image: Empty keyPoints array, using title as primary visual focus');
    keyPointsSection = '  (Focus on title as the main visual element)';
  } else {
    // Sanitize and truncate each key point, limit count
    const sanitizedKeyPoints = brief.keyPoints
      .slice(0, MAX_KEY_POINTS)
      .map((point, index) => {
        const sanitized = sanitizePromptContent(point, MAX_KEY_POINT_LENGTH);
        return `  ${index + 1}. ${sanitized}`;
      });
    keyPointsSection = sanitizedKeyPoints.join('\n');
  }

  // Sanitize color scheme or use default
  // Handle edge case where colorScheme is whitespace-only or sanitizes to empty
  const sanitizedColorScheme = brief.colorScheme?.trim()
    ? sanitizePromptContent(brief.colorScheme.trim(), MAX_COLOR_SCHEME_LENGTH)
    : '';
  const colorScheme = sanitizedColorScheme.trim() || DEFAULT_COLOR_SCHEME;

  // Get style-specific instructions
  const styleInstructions = STYLE_INSTRUCTIONS[brief.suggestedStyle];

  // Build the prompt with structured sections
  const prompt = `Create a professional infographic for LinkedIn:

Title: ${sanitizedTitle}

Key Points:
${keyPointsSection}

${styleInstructions}

Color Scheme: ${colorScheme}

Requirements:
- Clean, modern professional design
- Legible text (double-check all spelling)
- High visual hierarchy - title prominent
- Data visualization where appropriate
- Suitable for LinkedIn sharing
- Professional quality output
- Resolution: ${imageSize}

Important:
- Text must be crisp and readable
- Balanced composition
- Corporate/professional aesthetic
- No watermarks or artifacts`;

  // Validate prompt length (MAJ-2)
  if (prompt.length > MAX_API_PROMPT_LENGTH) {
    throw new Error(
      `Prompt exceeds maximum length (${prompt.length} > ${MAX_API_PROMPT_LENGTH} chars). ` +
      'Consider shortening title or reducing key points.'
    );
  }

  logVerbose(
    `Built infographic prompt: ${sanitizedTitle} (${brief.suggestedStyle}, ${imageSize})`
  );

  return prompt;
}

/**
 * Validate that an image size string is in expected format.
 *
 * Expected formats: "1080x1080", "1200x628", etc.
 *
 * @param imageSize - The image size string to validate
 * @returns True if format is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidImageSize("1080x1080"); // true
 * isValidImageSize("invalid");   // false
 * ```
 */
export function isValidImageSize(imageSize: string): boolean {
  // Pattern: digits, 'x', digits (e.g., "1080x1080")
  const pattern = /^\d+x\d+$/;
  return pattern.test(imageSize);
}

/**
 * Get recommended image sizes for LinkedIn content.
 *
 * @returns Object with recommended sizes for different use cases
 */
export function getRecommendedImageSizes(): Record<string, string> {
  return {
    /** Square format - ideal for feed posts */
    square: '1080x1080',
    /** Landscape format - good for articles and shares */
    landscape: '1200x628',
    /** Portrait format - for carousel posts */
    portrait: '1080x1350',
    /** LinkedIn article header */
    articleHeader: '1920x1080',
  };
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse the Gemini image response to extract image data.
 *
 * Searches through response candidates and parts to find inline image data.
 * Converts base64 encoded image to a Buffer with validation.
 *
 * @param response - Raw Gemini API response
 * @returns Buffer containing image data, or null if no image found
 */
export function parseImageResponse(response: GeminiImageResponse): Buffer | null {
  // Check for blocked content
  if (response.promptFeedback?.blockReason) {
    logWarning(`Image generation blocked: ${response.promptFeedback.blockReason}`);
    return null;
  }

  // Check for candidates
  if (!response.candidates || response.candidates.length === 0) {
    logWarning('Image response has no candidates');
    return null;
  }

  // Find the first candidate with image data
  for (const candidate of response.candidates) {
    const parts = candidate.content?.parts;
    if (!parts || parts.length === 0) {
      continue;
    }

    // Look for inline image data in parts
    for (const part of parts) {
      if (part.inlineData?.data) {
        try {
          // Convert base64 to Buffer
          const buffer = Buffer.from(part.inlineData.data, 'base64');

          // Size validation: check if buffer has reasonable size
          // Very small images likely indicate an error response
          if (buffer.length < MIN_IMAGE_SIZE_BYTES) {
            logWarning(`Image buffer suspiciously small (${buffer.length} bytes)`);
            continue;
          }

          // Magic byte validation: verify buffer is actually PNG or JPEG
          // Prevents accepting malformed base64 that decodes to non-image data
          if (!isValidImageBuffer(buffer)) {
            logWarning('Image buffer does not contain valid PNG or JPEG data');
            continue;
          }

          logVerbose(`Extracted image: ${buffer.length} bytes`);
          return buffer;
        } catch (error) {
          logWarning(`Failed to decode image data: ${error instanceof Error ? error.message : 'Unknown error'}`);
          continue;
        }
      }
    }
  }

  logWarning('No image data found in response parts');
  return null;
}

// ============================================
// API Request
// ============================================

/**
 * Make the actual API request to Gemini for image generation.
 * Separated for testability.
 *
 * Uses the @google/genai SDK with Gemini 3 Pro Image (Nano Banana Pro).
 * The model requires uppercase resolution strings: "1K", "2K", "4K".
 *
 * @param prompt - The image generation prompt
 * @param resolution - Resolution string ("2K" or "4K") - must be uppercase
 * @param model - Model to use (defaults to IMAGE_MODEL primary)
 * @returns Promise resolving to GeminiImageResponse
 * @throws Error if API key not configured or request fails
 *
 * @see https://ai.google.dev/gemini-api/docs/image-generation
 */
export async function makeImageRequest(
  prompt: string,
  resolution: string,
  model: string = IMAGE_MODEL
): Promise<GeminiImageResponse> {
  const client = getImageClient();

  // Gemini image models require uppercase resolution: "1K", "2K", "4K"
  const imageSize = resolution.toUpperCase();

  const response = await client.models.generateContent({
    model: model,
    contents: prompt,
    config: {
      responseModalities: ['image', 'text'],
      // Gemini image models support imageConfig for resolution control
      imageConfig: {
        imageSize: imageSize, // "2K" or "4K"
      },
    },
  });

  // Convert @google/genai response to our GeminiImageResponse type
  // The response structure may vary - handle safely
  const candidates = response.candidates;
  if (!candidates) {
    return { candidates: undefined };
  }

  return {
    candidates: candidates.map((candidate) => {
      const content = candidate.content;
      if (!content?.parts) {
        return { content: { parts: [] } };
      }

      return {
        content: {
          parts: content.parts.map((part) => {
            // Handle inline data (base64 image)
            if (part.inlineData) {
              return {
                inlineData: {
                  mimeType: part.inlineData.mimeType ?? 'image/png',
                  data: part.inlineData.data ?? '',
                },
              };
            }
            // Handle text parts
            if (part.text) {
              return { text: part.text };
            }
            return {};
          }),
        },
        finishReason: candidate.finishReason,
      };
    }),
  };
}

// ============================================
// Image Generation
// ============================================

/**
 * Generate an infographic image from a brief.
 *
 * This is the main entry point for image generation. It orchestrates:
 * 1. Check if image generation is skipped (config.skipImage)
 * 2. Map resolution to API format ('2k' -> '2K', '4k' -> '4K')
 * 3. Build the image prompt from the brief
 * 4. Make the API request to Gemini with retry logic
 * 5. Parse the response to extract image buffer
 *
 * This function is NON-BLOCKING: failures are logged as warnings but do not
 * halt the pipeline. Per PRD: "Failure: Log warning, continue without image"
 *
 * @param brief - The infographic brief from synthesis
 * @param config - Pipeline configuration (for skipImage and resolution)
 * @returns Buffer containing PNG image data, or null if skipped/failed
 *
 * @example
 * ```typescript
 * const brief = synthesis.infographicBrief;
 * const image = await generateInfographic(brief, config);
 *
 * if (image) {
 *   await writePNG(join(outputDir, 'infographic.png'), image);
 * }
 * ```
 */
export async function generateInfographic(
  brief: InfographicBrief,
  config: PipelineConfig
): Promise<Buffer | null> {
  // 1. Check if image generation should be skipped
  if (config.skipImage) {
    logVerbose('Image generation skipped (--skip-image flag)');
    return null;
  }

  try {
    // 2. Map resolution string ('2k' | '4k') to API format ('2K' | '4K')
    // Uses RESOLUTION_TO_IMAGE_SIZE from types/index.js as single source of truth
    const resolution = RESOLUTION_TO_IMAGE_SIZE[config.imageResolution] ?? '2K';

    // Use resolution label (2k/4k) in prompt as specified in TODO (CODEX-LOW-1)
    // This is more intuitive and matches the imageConfig.imageSize format
    const resolutionLabel = config.imageResolution; // '2k' or '4k'

    logVerbose(`Generating ${resolution} infographic: "${brief.title}"`);

    // 3. Build the prompt with resolution label
    const prompt = buildInfographicPrompt(brief, resolutionLabel);
    logVerbose(`Image prompt length: ${prompt.length} characters`);

    // 4. Attempt image generation with primary model (with retry and timeout)
    // Uses STAGE_TIMEOUT_MS (60s) per attempt to prevent indefinite hangs
    const primaryResult = await withRetryAndTimeout(
      async () => {
        const response = await makeImageRequest(prompt, resolution, IMAGE_MODEL);
        const imageBuffer = parseImageResponse(response);

        if (!imageBuffer) {
          throw new Error('No image data in response');
        }

        return imageBuffer;
      },
      STAGE_TIMEOUT_MS,
      {
        maxRetries: 2,
        baseDelayMs: 2000,
        operationName: 'Image generation (primary)',
      }
    );

    // 5. Handle primary result
    if (primaryResult.success) {
      // Log success with image size (KB), resolution, and model
      const sizeKB = Math.round(primaryResult.data.length / 1024);
      logSuccess(`Infographic generated (${sizeKB} KB, ${resolution}, primary model)`);
      return primaryResult.data;
    }

    // 6. Try fallback model if primary failed with retryable error (CODEX-MED-1)
    if (isRetryableForFallback(primaryResult.error)) {
      logWarning(`Primary model failed, trying fallback: ${IMAGE_MODEL_FALLBACK}`);

      const fallbackResult = await withRetryAndTimeout(
        async () => {
          const response = await makeImageRequest(prompt, resolution, IMAGE_MODEL_FALLBACK);
          const imageBuffer = parseImageResponse(response);

          if (!imageBuffer) {
            throw new Error('No image data in response');
          }

          return imageBuffer;
        },
        STAGE_TIMEOUT_MS,
        {
          maxRetries: 1,
          baseDelayMs: 2000,
          operationName: 'Image generation (fallback)',
        }
      );

      if (fallbackResult.success) {
        const sizeKB = Math.round(fallbackResult.data.length / 1024);
        logSuccess(`Infographic generated (${sizeKB} KB, ${resolution}, fallback model)`);
        return fallbackResult.data;
      }

      // Both models failed
      logWarning(`Fallback model also failed: ${sanitize(fallbackResult.error.message)}`);
      return null;
    }

    // Primary failed with non-retryable error (e.g., 400 bad request)
    logWarning(`Image generation failed: ${sanitize(primaryResult.error.message)}`);
    return null;

  } catch (error) {
    // Catch any unexpected errors - still non-blocking per PRD
    const errorMessage = error instanceof Error ? error.message : String(error);
    logWarning(`Image generation failed: ${sanitize(errorMessage)}`);
    return null;
  }
}

/**
 * Get the cost for image generation based on resolution.
 *
 * @param resolution - Resolution string ('2k' or '4k')
 * @returns Cost in dollars
 */
export function getImageCost(resolution: ImageResolution): number {
  return IMAGE_COSTS[resolution];
}

// ============================================
// Exports
// ============================================

export {
  MAX_TITLE_LENGTH,
  MAX_KEY_POINT_LENGTH,
  MAX_KEY_POINTS,
  STYLE_INSTRUCTIONS,
  DEFAULT_COLOR_SCHEME,
  // Error handling utilities (exported for testing)
  extractStatusCode,
  getStatusCodeMessage,
};
