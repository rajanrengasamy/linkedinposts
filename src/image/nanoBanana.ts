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
import type { InfographicBrief, InfographicStyle, LinkedInPost } from '../schemas/synthesisResult.js';
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
 * Now references the brand palette for consistency.
 */
const DEFAULT_COLOR_SCHEME = 'lime accent on dark background';

// ============================================
// Brand Template
// ============================================

/**
 * Friendly professional accent color palette.
 * AI selects ONE primary accent per infographic based on topic mood.
 * All colors are high-contrast against dark backgrounds and WCAG AA compliant.
 */
export const ACCENT_PALETTE = {
  lime: { hex: '#a3e635', bestFor: 'tech, innovation, energy, growth' },
  cyan: { hex: '#22d3ee', bestFor: 'trust, clarity, data, systems' },
  coral: { hex: '#fb7185', bestFor: 'people, warmth, healthcare, community' },
  amber: { hex: '#fbbf24', bestFor: 'insights, warnings, finance, attention' },
  violet: { hex: '#a78bfa', bestFor: 'creative, AI/ML, future-focused, strategy' },
  sky: { hex: '#38bdf8', bestFor: 'calm, enterprise, cloud, communication' },
  emerald: { hex: '#34d399', bestFor: 'sustainability, success, balance, wellness' },
} as const;

/**
 * Brand template that ensures visual consistency across all generated infographics.
 *
 * This template defines:
 * - LOCKED elements: Must be consistent in every infographic
 * - FLEXIBLE elements: Can vary based on content/topic
 * - ACCENT PALETTE: Pre-approved colors that work on dark backgrounds
 *
 * Reference: Dark charcoal background with high-contrast accent colors,
 * line-art icons, clean typography, and generous whitespace.
 */
export const BRAND_TEMPLATE = `
=== BRAND IDENTITY (Apply to ALL infographics) ===

LOCKED ELEMENTS (Non-negotiable):

Background:
- Solid dark charcoal: #1e1e1e to #252525 (NO gradients, NO patterns)
- This is the foundation of brand consistency - never deviate

Frame/Border:
- Subtle rounded rectangle border around content area
- Border: 1-2px stroke at 15-20% white opacity (#ffffff with alpha)
- Corner radius: 20-30px
- Creates cohesive "card" feel without heaviness

Typography:
- Font family: Geometric sans-serif (Inter, SF Pro, Outfit style)
- Title: BOLD weight, white (#ffffff) or accent color for emphasis
- Body text: Regular weight, white (#ffffff)
- All text must pass WCAG AA contrast (4.5:1 minimum)
- Maximum 3 font sizes: title (large), body (medium), caption (small)

Icon Style:
- LINE-ART ONLY: Stroke weight 2-3px, NO fills
- Color: Primary accent color (from palette below)
- Simple, geometric, recognizable shapes
- Icons should be topic-appropriate but follow this style consistently

Whitespace:
- Minimum 8% margin on all edges (safe zone)
- Generous padding between sections
- Content must breathe - avoid cramped layouts
- 30-40% of canvas should be negative space

Title Position:
- Top 15-25% of canvas, centered horizontally
- Must be readable at thumbnail size (100px preview)
- Largest text element on the canvas

ACCENT COLOR PALETTE (Select ONE based on topic mood):

| Color   | Hex     | Best For                                    |
|---------|---------|---------------------------------------------|
| Lime    | #a3e635 | Tech, innovation, energy, growth            |
| Cyan    | #22d3ee | Trust, clarity, data, systems               |
| Coral   | #fb7185 | People, warmth, healthcare, community       |
| Amber   | #fbbf24 | Insights, warnings, finance, attention      |
| Violet  | #a78bfa | Creative, AI/ML, future-focused, strategy   |
| Sky     | #38bdf8 | Calm, enterprise, cloud, communication      |
| Emerald | #34d399 | Sustainability, success, balance, wellness  |

Color Application Rules:
- Primary accent: Headers, icons, key callouts, emphasis elements
- White (#ffffff): Body text, diagram elements, secondary labels
- Dark accent variants (20% opacity): Subtle backgrounds for diagram boxes if needed
- NEVER use multiple accent colors - pick ONE and commit

FLEXIBLE ELEMENTS (Creative freedom within guidelines):

Layout Structure:
- 2-5 content sections depending on information density
- Can use: horizontal rows, vertical columns, asymmetric grids, single hero visual
- Adapt layout to best serve the content

Visualizations (FULL CREATIVE FREEDOM):
- Choose ANY visualization type that best represents the content:
  * Flowcharts and process diagrams
  * Comparison tables and matrices
  * Pie/donut charts and bar graphs
  * Mind maps and relationship diagrams
  * Venn diagrams and overlapping concepts
  * Timelines and process wheels
  * Icon grids and feature lists
  * Statistics callouts and number highlights
  * Before/after comparisons
  * Quote blocks and testimonial layouts
  * Funnels and hierarchies
  * Checklists and step-by-step guides
- Visualization elements: White with black/dark text for boxes, accent color for highlights
- Keep visualizations simple and readable at small sizes

Icon Selection:
- Choose icons appropriate to the topic
- Must follow line-art style (stroke only, no fill)
- Use accent color for icon strokes

Section Count:
- 2-5 sections based on content complexity
- Each section should convey ONE clear idea

=== END BRAND IDENTITY ===
`;

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
 *
 * All styles inherit from BRAND_TEMPLATE (dark background, line-art icons,
 * accent color palette, etc.) but add style-specific composition rules.
 */
const STYLE_INSTRUCTIONS: Record<InfographicStyle, string> = {
  minimal: `Style Guidelines (Minimal - within brand template):
COMPOSITION:
- WHITESPACE: 40-50% of canvas should be empty/negative space
- Maximum 2-3 content sections
- Simple, elegant line-art icons (max 1-2 icons total)
- Focus on typography hierarchy as primary visual interest
- Content should breathe - generous padding everywhere

VISUAL APPROACH:
- Let the dark background do the heavy lifting
- Accent color used sparingly for maximum impact
- One key visual element OR pure typography
- Avoid any visual clutter - less is more
- Clean geometric shapes if any decoration needed`,

  'data-heavy': `Style Guidelines (Data-Heavy - within brand template):
COMPOSITION:
- ONE primary data visualization as the hero element
- Maximum 3-4 data points displayed - focus on most impactful
- Supporting line-art icons to complement (not compete with) data
- Clear visual hierarchy: Title > Data Viz > Supporting text

VISUALIZATION OPTIONS (choose ONE that fits content):
- Bar/column charts with accent color bars on dark background
- Donut/pie charts with accent color segments
- Statistics callouts with large numbers in accent color
- Comparison layouts (side-by-side or before/after)
- Progress indicators or percentage visualizations
- Trend lines or simple line graphs

DATA PRESENTATION:
- Numbers should be LARGE and in accent color
- Labels in white, clear and readable
- Data viz elements use white fills with dark text OR accent outlines
- Keep it simple - complexity kills readability`,

  'quote-focused': `Style Guidelines (Quote-Focused - within brand template):
COMPOSITION:
- Quote text occupies 50-60% of visual weight
- Quote in accent color OR white with accent quotation marks
- Author attribution smaller, in white, clearly positioned
- Minimal supporting elements - the quote IS the design

VISUAL APPROACH:
- Large elegant quotation marks in accent color (optional)
- Quote text centered or left-aligned with clear hierarchy
- Optional: subtle line-art icon representing the topic
- Optional: simple geometric accent shapes
- Background remains solid dark - no competing elements

TYPOGRAPHY EMPHASIS:
- Quote text should be the largest element after title
- Consider italics or different weight for quote vs. attribution
- Ensure quote is fully readable at thumbnail size`,
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

  // Determine accent color - prefer explicit accentColor, fall back to colorScheme hint
  let accentColorDirective: string;
  if (brief.accentColor && ACCENT_PALETTE[brief.accentColor]) {
    // Synthesis engine selected a specific accent color - use it
    const colorInfo = ACCENT_PALETTE[brief.accentColor];
    accentColorDirective = `ACCENT COLOR (MANDATORY - DO NOT CHANGE):
Use ${brief.accentColor.toUpperCase()} (${colorInfo.hex}) as the ONLY accent color.
- Headers: ${colorInfo.hex}
- Icons: ${colorInfo.hex} stroke
- Highlights/emphasis: ${colorInfo.hex}
- DO NOT substitute any other color`;
    logVerbose(`Using specified accent color: ${brief.accentColor} (${colorInfo.hex})`);
  } else {
    // No specific color selected - let image model choose from palette
    const colorHint = brief.colorScheme?.trim()
      ? sanitizePromptContent(brief.colorScheme.trim(), MAX_COLOR_SCHEME_LENGTH)
      : '';
    accentColorDirective = colorHint
      ? `Color Mood Hint: ${colorHint} (select appropriate accent from brand palette)`
      : '(Select accent color from brand palette based on topic)';
  }

  // Get style-specific instructions
  const styleInstructions = STYLE_INSTRUCTIONS[brief.suggestedStyle];

  // Build the prompt with brand template first, then content
  const prompt = `Create a professional infographic for LinkedIn.

${BRAND_TEMPLATE}

=== CONTENT FOR THIS INFOGRAPHIC ===

Title: ${sanitizedTitle}

Key Points to Visualize:
${keyPointsSection}

Suggested Style: ${brief.suggestedStyle}

${accentColorDirective}

${styleInstructions}

=== TECHNICAL REQUIREMENTS ===

Resolution: ${imageSize}

Mobile-First Validation:
- 70%+ of LinkedIn views are on mobile devices
- Text must be readable at thumbnail size (100px preview)
- Key message visible without zooming
- No fine details that disappear at small sizes

ABSOLUTE RESTRICTIONS (Negative Prompts):
- NO light or white backgrounds (brand requires dark charcoal)
- NO gradient backgrounds (solid color only)
- NO filled icons (line-art only)
- NO multiple accent colors (one accent color per infographic)
- NO stock imagery or generic business photos
- NO busy or cluttered compositions
- NO small or illegible text
- NO clip art or cartoon graphics
- NO generic corporate imagery (handshakes, globes, arrows)
- NO logos, watermarks, or brand marks
- NO decorative borders that compete with content
- NO more than 5 major visual elements

Final Check:
- Dark charcoal background (#1e1e1e to #252525)? ✓
- One accent color from palette? ✓
- Line-art icons only? ✓
- Subtle rounded border frame? ✓
- Title prominent and readable? ✓
- Content breathes with whitespace? ✓`;

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
 * Generate infographics for multiple posts.
 * Non-blocking: failures don't halt pipeline.
 *
 * @param posts - Array of LinkedIn posts with infographic briefs
 * @param config - Pipeline configuration
 * @returns Array of results (null entries indicate failed/skipped generation)
 */
export async function generateMultipleInfographics(
  posts: LinkedInPost[],
  config: PipelineConfig
): Promise<Array<{ postNumber: number; buffer: Buffer } | null>> {
  if (config.skipImage) {
    logVerbose('Image generation skipped');
    return posts.map(() => null);
  }

  const results: Array<{ postNumber: number; buffer: Buffer } | null> = [];

  for (const post of posts) {
    logVerbose(`Generating infographic ${post.postNumber}/${post.totalPosts}`);

    try {
      const buffer = await generateInfographic(post.infographicBrief, config);
      results.push(buffer ? { postNumber: post.postNumber, buffer } : null);
    } catch (error) {
      logWarning(
        `Infographic ${post.postNumber} failed: ${error instanceof Error ? error.message : 'Unknown'}`
      );
      results.push(null);
    }
  }

  const success = results.filter((r) => r !== null).length;
  logVerbose(`Generated ${success}/${posts.length} infographics`);

  return results;
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

// Note: BRAND_TEMPLATE and ACCENT_PALETTE are exported inline with their declarations
