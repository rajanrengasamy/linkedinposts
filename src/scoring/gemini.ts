/**
 * Gemini Scoring Engine
 *
 * Implements Section 9.1 - Content scoring with Gemini 3 Flash (high thinking).
 *
 * This module provides:
 * - Gemini API client initialization and request handling
 * - Prompt building for batch-scoring content items
 * - Retry logic with exponential backoff for resilience
 * - High thinking mode for improved reasoning accuracy
 *
 * Other modules handle:
 * - Response parsing (parseScoringResponse in gemini.ts - Agent 3)
 * - Main scoreItems orchestration (Agent 5)
 * - Fallback scoring (fallback.ts - Agent 4)
 *
 * @see https://ai.google.dev/gemini-api/docs/gemini-3
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */

import { z } from 'zod';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getApiKey, getOpenCodeModel } from '../config.js';
import { withRetry, CRITICAL_RETRY_OPTIONS, TimeoutError } from '../utils/retry.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import { STAGE_TIMEOUT_MS, type PipelineConfig } from '../types/index.js';
import type { ValidatedItem } from '../schemas/validatedItem.js';
import { routeLLMRequest } from '../llm/fallback-router.js';
import { getGeminiCLIClient } from '../llm/gemini-cli-wrapper.js';
import { getOpenCodeGoogleClient } from '../llm/opencode-wrapper.js';
import {
  parseAndValidate,
  retryWithFixPrompt,
  type ParseResult,
  type ParseRetryResult,
  type ScoredItem,
  type VerificationLevel,
  VERIFICATION_BOOSTS,
  calculateOverallScore,
  ScoredItemSchema,
} from '../schemas/index.js';
import { fallbackScore } from './fallback.js';

/** Maximum content length to include in prompt (manages token usage) */
const MAX_CONTENT_LENGTH = 500;

/**
 * Gemini model to use for scoring.
 * gemini-3-flash-preview is Google's latest high-speed thinking model (Dec 2025)
 * @see https://ai.google.dev/gemini-api/docs/gemini-3
 */
const GEMINI_MODEL = 'gemini-3-flash-preview';

/**
 * Thinking level for Gemini 3 Flash.
 * HIGH maximizes reasoning depth for better scoring accuracy.
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */
const GEMINI_THINKING_LEVEL = ThinkingLevel.HIGH;

/**
 * Maximum prompt length to prevent excessive API costs and timeouts
 */
const MAX_PROMPT_LENGTH = 100000;

// ============================================
// Types
// ============================================

/**
 * Options for Gemini scoring requests
 */
export interface GeminiScoringOptions {
  /** The prompt to send to Gemini */
  prompt: string;
  /** Request timeout in milliseconds (default: STAGE_TIMEOUT_MS) */
  timeoutMs?: number;
}

/**
 * Options for the makeGeminiRequest function
 */
export interface GeminiRequestOptions {
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Operation name for logging */
  operationName?: string;
}

// ============================================
// Client Initialization
// ============================================

/**
 * Get an initialized Gemini client.
 *
 * Retrieves the API key from environment and creates a new GoogleGenAI
 * instance. Throws if the API key is not configured.
 *
 * @returns Initialized GoogleGenAI client
 * @throws Error if GOOGLE_AI_API_KEY is not set
 */
function getGeminiClient(): GoogleGenAI {
  const apiKey = getApiKey('GOOGLE_AI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'GOOGLE_AI_API_KEY is required for scoring. ' +
        'Please set it in your .env file or environment.'
    );
  }
  return new GoogleGenAI({ apiKey });
}

// ============================================
// Main API Request Function
// ============================================

/**
 * Make a request to the Gemini API for scoring.
 *
 * Sends a prompt to Gemini 3 Flash with high thinking mode and returns the
 * text response. Uses retry logic with exponential backoff for resilience
 * against transient failures and rate limits.
 *
 * @param prompt - The scoring prompt to send
 * @param options - Optional request configuration
 * @returns Promise resolving to the text response from Gemini
 * @throws Error if API key is missing, prompt is too long, or all retries fail
 *
 * @example
 * ```typescript
 * const response = await makeGeminiRequest(
 *   'Score these items on relevance: ...',
 *   { timeoutMs: 30000 }
 * );
 * const scores = JSON.parse(response);
 * ```
 */
export async function makeGeminiRequest(
  prompt: string,
  options?: GeminiRequestOptions
): Promise<string> {
  const { timeoutMs = STAGE_TIMEOUT_MS, operationName = 'Gemini scoring request' } =
    options ?? {};

  // Validate prompt length to prevent excessive costs
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `Prompt exceeds maximum length (${prompt.length} > ${MAX_PROMPT_LENGTH}). ` +
        'Consider reducing batch size or content length.'
    );
  }

  logVerbose(`${operationName}: Sending request (${prompt.length} chars)`);

  // Initialize client
  const client = getGeminiClient();

  // Make API request with retry logic and timeout enforcement
  const result = await withRetry(
    async () => {
      // Create timeout promise to enforce timeoutMs
      // Note: @google/genai SDK doesn't support AbortSignal, so we use Promise.race
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TimeoutError(`Gemini request timed out after ${timeoutMs}ms`, timeoutMs)),
          timeoutMs
        );
      });

      const apiPromise = client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          thinkingConfig: {
            thinkingLevel: GEMINI_THINKING_LEVEL,
          },
        },
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);
      const text = response.text;

      if (!text || text.trim().length === 0) {
        throw new Error('Empty response received from Gemini API');
      }

      return text;
    },
    {
      ...CRITICAL_RETRY_OPTIONS,
      operationName,
    }
  );

  // Handle retry result
  if (!result.success) {
    logWarning(`${operationName}: Failed after ${result.attempts} attempts`);
    // CRIT-6: Use createSanitizedError to prevent API key exposure in stack/cause/other properties
    const safeError = createSanitizedError(
      `${operationName} (after ${result.attempts} attempts)`,
      result.error
    );
    throw safeError;
  }

  logVerbose(
    `${operationName}: Response received (${result.data.length} chars, ${result.attempts} attempt(s))`
  );

  return result.data;
}

// ============================================
// Error Handling
// ============================================

/**
 * Patterns that indicate sensitive data in Gemini error messages.
 */
const SENSITIVE_ERROR_PATTERNS = [
  /AIza[a-zA-Z0-9_-]{30,}/gi, // Google API keys
  /[a-f0-9]{32,}/gi, // Long hex strings (potential keys)
];

/**
 * Sanitize a string to remove potential API keys and sensitive data.
 *
 * @param text - Raw text that may contain sensitive data
 * @returns Sanitized text safe for logging
 */
function sanitizeString(text: string): string {
  let sanitized = text;

  for (const pattern of SENSITIVE_ERROR_PATTERNS) {
    // Reset regex state before each use
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized;
}

/**
 * Sanitize Gemini error messages to prevent API key exposure.
 *
 * @param message - Raw error message
 * @returns Sanitized error message safe for logging
 * @deprecated Use createSanitizedError for complete error sanitization
 */
function sanitizeGeminiError(message: string): string {
  return sanitizeString(message);
}

/**
 * Create a sanitized error without exposing sensitive data.
 *
 * CRIT-6 FIX: This function creates a new error object that:
 * 1. Sanitizes the message to remove API keys
 * 2. Does NOT copy the original stack trace (may contain secrets)
 * 3. Does NOT copy cause or other properties (may contain secrets)
 *
 * The new error captures its own stack from this point, which is safe.
 *
 * @param operationName - Name of the operation for context
 * @param originalError - The original error (may contain sensitive data)
 * @returns A new, sanitized Error object safe for logging/throwing
 */
function createSanitizedError(operationName: string, originalError: unknown): Error {
  // Extract and sanitize the message
  let message: string;
  if (originalError instanceof Error) {
    message = sanitizeString(originalError.message);
  } else {
    message = sanitizeString(String(originalError));
  }

  // Create new error - captures fresh stack from this point, no sensitive data
  const safeError = new Error(`${operationName} failed: ${message}`);

  // Preserve TimeoutError type information if applicable
  if (originalError instanceof TimeoutError) {
    safeError.name = 'TimeoutError';
  }

  return safeError;
}

// ============================================
// CLI Request Functions (Tier 1 & Tier 2)
// ============================================

/**
 * Make Gemini scoring request via Gemini CLI (Gemini Ultra subscription)
 * This is Tier 2 in the fallback chain.
 */
async function makeGeminiRequestViaCLI(
  prompt: string,
  options?: GeminiRequestOptions
): Promise<string> {
  const { timeoutMs = STAGE_TIMEOUT_MS, operationName = 'Gemini CLI scoring' } = options ?? {};

  logVerbose(`${operationName}: Sending request via CLI (${prompt.length} chars)`);

  const client = getGeminiCLIClient({
    model: GEMINI_MODEL,
    timeout: timeoutMs,
  });

  if (!client) {
    throw new Error('Gemini CLI client not available');
  }

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });

  const text = response.text;
  if (!text || text.trim().length === 0) {
    throw new Error('Empty response received from Gemini CLI');
  }

  logVerbose(`${operationName}: CLI response received (${text.length} chars)`);
  return text;
}

/**
 * Make Gemini scoring request via OpenCode CLI (subscription auth).
 * This is Tier 1 in the fallback chain (highest priority).
 */
async function makeGeminiRequestViaOpenCode(
  prompt: string,
  options?: GeminiRequestOptions
): Promise<string> {
  const { timeoutMs = STAGE_TIMEOUT_MS, operationName = 'OpenCode Gemini scoring' } = options ?? {};

  logVerbose(`${operationName}: Sending request via OpenCode (${prompt.length} chars)`);

  const model = getOpenCodeModel('gemini');
  const client = getOpenCodeGoogleClient({
    model,
    timeout: timeoutMs,
  });

  if (!client) {
    throw new Error('OpenCode client not available');
  }

  const response = await client.models.generateContent({
    model,
    contents: prompt,
  });

  const text = response.text;
  if (!text || text.trim().length === 0) {
    throw new Error('Empty response received from OpenCode');
  }

  logVerbose(`${operationName}: OpenCode response received (${text.length} chars)`);
  return text;
}

/**
 * Make Gemini scoring request with fallback routing (OpenCode -> CLI -> API).
 *
 * Routes through the multi-tier authentication system:
 * - Tier 1: OpenCode CLI (subscription auth via plugins)
 * - Tier 2: Gemini CLI (Gemini Ultra subscription)
 * - Tier 3: Direct API (per-token billing)
 *
 * @param prompt - The scoring prompt to send
 * @param options - Optional request configuration
 * @returns Promise resolving to the text response
 */
export async function makeGeminiRequestWithFallback(
  prompt: string,
  options?: GeminiRequestOptions
): Promise<string> {
  const result = await routeLLMRequest<string>(
    () => makeGeminiRequest(prompt, options),              // Tier 3: API
    () => makeGeminiRequestViaCLI(prompt, options),        // Tier 2: CLI
    () => makeGeminiRequestViaOpenCode(prompt, options),   // Tier 1: OpenCode
    { provider: 'gemini' }
  );

  logVerbose(`Gemini scoring completed via ${result.tier} tier`);
  return result.result;
}

// ============================================
// Prompt Building Utilities
// ============================================

/** Delimiters for structured item separation in prompts */
const ITEM_START_DELIMITER = '<<<ITEM_START>>>';
const ITEM_END_DELIMITER = '<<<ITEM_END>>>';

/** Delimiters for user prompt to prevent injection attacks */
const PROMPT_START_DELIMITER = '<<<USER_PROMPT_START>>>';
const PROMPT_END_DELIMITER = '<<<USER_PROMPT_END>>>';

/** Approximate fixed template size for prompt length estimation (updated for enhanced prompt) */
const PROMPT_OVERHEAD = 2800;

/** Per-item overhead for delimiters and metadata in prompt */
const ITEM_OVERHEAD = 200;

/** Patterns that could be used for prompt injection attacks */
const INJECTION_PATTERNS = [
  /<<<.*>>>/gi,
  /\{%.*%\}/gi,
  /\{\{.*\}\}/gi,
  /<script[^>]*>.*<\/script>/gi,
  /ignore (previous|above|all) instructions/gi,
  /disregard (previous|above|all)/gi,
  /system:\s*$/gim,
  /assistant:\s*$/gim,
  /user:\s*$/gim,
];

/**
 * Sanitizes content to prevent prompt injection attacks.
 * Removes potentially dangerous patterns and truncates to max length.
 *
 * @param content - Raw content string to sanitize
 * @returns Sanitized and truncated content
 */
function sanitizeContent(content: string): string {
  let sanitized = content;

  // Remove injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REMOVED]');
  }

  // Truncate to max length
  if (sanitized.length > MAX_CONTENT_LENGTH) {
    sanitized = sanitized.slice(0, MAX_CONTENT_LENGTH) + '...';
  }

  return sanitized.trim();
}

/**
 * Formats engagement stats into a human-readable string.
 *
 * @param engagement - Engagement object with likes, comments, shares
 * @returns Formatted string like "150 likes, 30 comments, 10 shares"
 */
function formatEngagement(engagement: ValidatedItem['engagement']): string {
  const parts: string[] = [];

  if (engagement.likes > 0) {
    parts.push(`${engagement.likes} likes`);
  }
  if (engagement.comments > 0) {
    parts.push(`${engagement.comments} comments`);
  }
  if (engagement.shares > 0) {
    parts.push(`${engagement.shares} shares`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No engagement data';
}

/**
 * Formats a single item for inclusion in the scoring prompt.
 *
 * @param item - Validated item to format
 * @returns Formatted item block with delimiters
 */
function formatItem(item: ValidatedItem): string {
  const lines: string[] = [
    ITEM_START_DELIMITER,
    `ID: ${item.id}`,
    `Content: ${sanitizeContent(item.content)}`,
    `Verification: ${item.validation.level}`,
  ];

  if (item.author) {
    lines.push(`Author: ${item.author}`);
  }

  if (item.publishedAt) {
    lines.push(`Published: ${item.publishedAt}`);
  }

  lines.push(`Engagement: ${formatEngagement(item.engagement)}`);
  lines.push(ITEM_END_DELIMITER);

  return lines.join('\n');
}

/**
 * Builds a scoring prompt for Gemini to evaluate content items.
 *
 * Creates a structured prompt that:
 * - Explains the scoring task and dimensions
 * - Includes the user's original prompt for relevance context
 * - Formats each item with ID, content, verification level, and metadata
 * - Requests JSON output in a specific format
 *
 * Content is sanitized to prevent prompt injection and truncated
 * to 500 characters to manage token usage.
 *
 * @param items - Array of validated items to score
 * @param userPrompt - The user's original search/topic prompt
 * @returns Complete prompt string ready to send to Gemini
 *
 * @example
 * ```typescript
 * const prompt = buildScoringPrompt(validatedItems, 'AI trends in 2025');
 * const response = await geminiClient.generate(prompt);
 * ```
 */
export function buildScoringPrompt(
  items: ValidatedItem[],
  userPrompt: string
): string {
  // MAJ-10: Pre-estimate prompt length to fail fast before expensive string construction
  const estimatedLength =
    PROMPT_OVERHEAD +
    userPrompt.length +
    items.reduce(
      (sum, item) =>
        sum + Math.min(item.content.length, MAX_CONTENT_LENGTH) + ITEM_OVERHEAD,
      0
    );

  if (estimatedLength > MAX_PROMPT_LENGTH) {
    throw new Error(
      `Estimated prompt length (${estimatedLength}) exceeds maximum (${MAX_PROMPT_LENGTH}). ` +
        `Reduce batch size from ${items.length} items or shorten content.`
    );
  }

  const sanitizedUserPrompt = sanitizeContent(userPrompt);

  const formattedItems = items.map(formatItem).join('\n\n');

  // MAJ-9: Use structured delimiters for user prompt to prevent injection attacks
  const prompt = `You are a content scoring assistant. Score each item's potential for a LinkedIn post about the following topic:

${PROMPT_START_DELIMITER}
${sanitizedUserPrompt}
${PROMPT_END_DELIMITER}

SCORING DIMENSIONS (0-100 scale for each):

1. RELEVANCE - How relevant to the topic
   Rubric:
   - 0-29: Off-topic or tangentially related at best
   - 30-49: Related field but different focus or weak connection
   - 50-69: Moderately relevant, addresses the topic but not directly
   - 70-89: Strongly relevant, directly addresses the topic with clear alignment
   - 90-100: Exceptional match - core topic, highly specific, authoritative

2. AUTHENTICITY - Baseline credibility/rigor based on the content ITSELF
   (DO NOT use the verification level - verification boosts are applied separately downstream)
   Score based on: clarity of claims, presence of data/evidence, professional tone, absence of sensationalism.
   Rubric:
   - 0-29: Vague claims, no evidence, sensational/clickbait tone
   - 30-49: Some claims but weak evidence, informal or biased tone
   - 50-69: Reasonable claims with some support, professional tone
   - 70-89: Clear claims with data/evidence, authoritative tone
   - 90-100: Rigorous analysis, multiple data points, expert-level clarity

3. RECENCY - Based on publication date
   Rubric:
   - 0-29: Over 2 years old or severely outdated information
   - 30-49: 1-2 years old, potentially stale
   - 50-69: 6-12 months old OR unknown date (use 50 for unknown)
   - 70-89: Within last 6 months, current information
   - 90-100: Within last month, breaking news or very recent

4. ENGAGEMENT POTENTIAL - Estimate FUTURE potential for LinkedIn audience
   (Do NOT simply mirror observed engagement counts - estimate potential based on content quality and topic appeal)
   Rubric:
   - 0-29: Dry, technical, niche audience only, no hook
   - 30-49: Limited appeal, specialized topic, weak narrative
   - 50-69: Moderate appeal, decent hook but limited shareability
   - 70-89: Strong hook, broad appeal, thought-provoking or actionable
   - 90-100: Viral potential, highly shareable, strong emotional/professional resonance

NEGATIVE SIGNALS (apply score penalties):
- Clickbait headlines or sensationalism: -10 to -20 on authenticity
- Promotional/sales content: -15 on engagementPotential
- Outdated info presented as current: -20 on recency
- Vague or unsupported claims: -10 to -15 on authenticity
- Generic content lacking specifics: -10 on relevance and engagementPotential

TIE-BREAKING GUIDELINES (when items score similarly):
- Prefer direct quotes over paraphrased content
- Prefer specific data/numbers over general statements
- Prefer more recent content over older
- Prefer named sources over anonymous

CALIBRATION GUIDANCE:
- Aim for score distribution across the full range - avoid clustering at 70-80
- Use the full 0-100 scale; reserve 90+ for truly exceptional content
- A "typical" item should score around 50-60; be discriminating

Items to score:
${formattedItems}

Return ONLY valid JSON in this exact format:
{
  "scores": [
    {"id": "item-id-here", "relevance": 85, "authenticity": 70, "recency": 90, "engagementPotential": 75, "reasoning": ["point 1", "point 2", "point 3"]}
  ]
}

Requirements:
- Include an entry for EVERY item ID provided
- All scores must be integers between 0 and 100
- REQUIRED: Provide exactly 3 reasoning points per item (no more, no less)
- Return ONLY the JSON object, no additional text`;

  return prompt;
}

// ============================================
// Section 9.1-9.2: Response Schema & Parsing
// ============================================

/**
 * Schema for individual score entry from Gemini response
 */
const GeminiScoreEntrySchema = z.object({
  /** Item ID to match with ValidatedItem */
  id: z.string(),

  /** Relevance to original prompt (0-100) */
  relevance: z.number().min(0).max(100),

  /** Base authenticity score before verification boost (0-100) */
  authenticity: z.number().min(0).max(100),

  /** Recency score based on publication date (0-100) */
  recency: z.number().min(0).max(100),

  /** Engagement potential score (0-100) */
  engagementPotential: z.number().min(0).max(100),

  /** Optional reasoning bullets for the scores */
  reasoning: z.array(z.string()).optional(),
});

/**
 * Schema for complete Gemini scoring response
 *
 * Validates the JSON structure returned by Gemini when scoring items.
 * Used with parseAndValidate() to extract and type-check responses.
 */
export const GeminiScoreResponseSchema = z.object({
  /** Array of scores, one per item */
  scores: z.array(GeminiScoreEntrySchema),
});

export type GeminiScoreResponse = z.infer<typeof GeminiScoreResponseSchema>;
export type GeminiScoreEntry = z.infer<typeof GeminiScoreEntrySchema>;

// ============================================
// Response Parsing
// ============================================

/**
 * Parse Gemini's scoring response text into validated data
 *
 * Handles common LLM output patterns:
 * - Markdown code fences (```json ... ```)
 * - Raw JSON with trailing text
 * - JSON with leading/trailing whitespace
 *
 * @param responseText - Raw text response from Gemini API
 * @returns ParseResult with validated GeminiScoreResponse or error message
 *
 * @example
 * ```typescript
 * const result = parseGeminiScoringResponse(geminiApiResponse);
 * if (result.success) {
 *   console.log('Parsed scores:', result.data.scores);
 * } else {
 *   console.error('Parse failed:', result.error);
 * }
 * ```
 */
export function parseGeminiScoringResponse(
  responseText: string
): ParseResult<GeminiScoreResponse> {
  return parseAndValidate(GeminiScoreResponseSchema, responseText);
}

// ============================================
// Verification Boost (Section 9.2)
// ============================================

/**
 * Apply verification level boost to base authenticity score
 *
 * Verification boosts reward items with stronger provenance:
 * - UNVERIFIED: +0 (no boost)
 * - SOURCE_CONFIRMED: +25
 * - MULTISOURCE_CONFIRMED: +50
 * - PRIMARY_SOURCE: +75
 *
 * The result is clamped to maximum 100.
 *
 * @param baseAuthenticity - Base authenticity score from Gemini (0-100)
 * @param verificationLevel - Verification level from validation stage
 * @returns Boosted authenticity score, clamped to 0-100
 *
 * @example
 * ```typescript
 * // UNVERIFIED item keeps base score
 * applyVerificationBoost(50, 'UNVERIFIED'); // 50
 *
 * // PRIMARY_SOURCE gets +75 boost
 * applyVerificationBoost(50, 'PRIMARY_SOURCE'); // 100 (clamped)
 * ```
 */
export function applyVerificationBoost(
  baseAuthenticity: number,
  verificationLevel: VerificationLevel
): number {
  const boost = VERIFICATION_BOOSTS[verificationLevel];
  return Math.min(100, baseAuthenticity + boost);
}

// ============================================
// Default Scores
// ============================================

/**
 * Default scores used when an item is missing from Gemini response
 */
const DEFAULT_SCORES: Omit<GeminiScoreEntry, 'id'> = {
  relevance: 50,
  authenticity: 50,
  recency: 50,
  engagementPotential: 50,
  reasoning: ['No scoring data available - using defaults'],
};

/**
 * Clamp a score value to the valid range 0-100
 */
function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// ============================================
// Score Processing
// ============================================

/**
 * Process validated items with Gemini scores into ranked ScoredItems
 *
 * This function:
 * 1. Validates all input item IDs are present in Gemini response
 * 2. Matches Gemini scores to items by ID
 * 3. Applies verification boost to authenticity scores
 * 4. Calculates weighted overall score using SCORING_WEIGHTS
 * 5. Sorts by overall score (descending)
 * 6. Assigns ranks (1 = highest score)
 * 7. Validates each item against ScoredItemSchema
 *
 * Throws error if Gemini response is missing any input IDs (CRIT-2 fix).
 *
 * @param items - Validated items to score
 * @param geminiScores - Parsed response from Gemini scoring API
 * @returns Array of ScoredItems sorted by rank (1 = best)
 * @throws Error if Gemini response is missing item IDs or item fails ScoredItemSchema validation
 *
 * @example
 * ```typescript
 * const items = await validateItems(rawItems, config);
 * const geminiResponse = await callGeminiScoring(items);
 * const parsed = parseGeminiScoringResponse(geminiResponse);
 *
 * if (parsed.success) {
 *   const scoredItems = processScoredItems(items, parsed.data);
 *   console.log('Top item:', scoredItems[0]);
 * }
 * ```
 */
export function processScoredItems(
  items: ValidatedItem[],
  geminiScores: GeminiScoreResponse
): ScoredItem[] {
  // Build lookup map for O(1) score access
  const scoreMap = new Map<string, GeminiScoreEntry>();
  for (const score of geminiScores.scores) {
    scoreMap.set(score.id, score);
  }

  // CRIT-2: Validate all input IDs are present in response
  // Throw error if IDs are missing so retry logic can attempt fix
  const inputIds = new Set(items.map(i => i.id));
  const responseIds = new Set(geminiScores.scores.map(s => s.id));
  const missingIds = [...inputIds].filter(id => !responseIds.has(id));

  if (missingIds.length > 0) {
    throw new Error(
      `Gemini response missing ${missingIds.length}/${inputIds.size} item IDs: ${missingIds.slice(0, 3).join(', ')}${missingIds.length > 3 ? '...' : ''}`
    );
  }

  // Process each item with scores
  const processedItems: Array<{
    item: ValidatedItem;
    scores: {
      relevance: number;
      authenticity: number;
      recency: number;
      engagementPotential: number;
      overall: number;
    };
    reasoning: string[];
  }> = [];

  for (const item of items) {
    const geminiScore = scoreMap.get(item.id);

    // Use Gemini scores or defaults
    const rawScores = geminiScore ?? { ...DEFAULT_SCORES, id: item.id };

    // Clamp all scores to valid range
    const relevance = clampScore(rawScores.relevance);
    const recency = clampScore(rawScores.recency);
    const engagementPotential = clampScore(rawScores.engagementPotential);

    // Apply verification boost to authenticity
    const baseAuthenticity = clampScore(rawScores.authenticity);
    const authenticity = applyVerificationBoost(
      baseAuthenticity,
      item.validation.level
    );

    // Calculate weighted overall score
    const overall = calculateOverallScore({
      relevance,
      authenticity,
      recency,
      engagementPotential,
    });

    // Ensure reasoning is an array
    const reasoning = rawScores.reasoning ?? [];

    processedItems.push({
      item,
      scores: {
        relevance,
        authenticity,
        recency,
        engagementPotential,
        overall,
      },
      reasoning,
    });
  }

  // Sort by overall score descending
  processedItems.sort((a, b) => b.scores.overall - a.scores.overall);

  // Build final ScoredItem array with ranks
  const scoredItems: ScoredItem[] = [];

  for (let i = 0; i < processedItems.length; i++) {
    const { item, scores, reasoning } = processedItems[i];
    const rank = i + 1; // 1-indexed rank

    // Build the scored item
    const scoredItem: ScoredItem = {
      ...item,
      scores,
      scoreReasoning: reasoning,
      rank,
    };

    // Validate against schema (will throw if invalid)
    const validated = ScoredItemSchema.parse(scoredItem);
    scoredItems.push(validated);
  }

  return scoredItems;
}

// ============================================
// Fix Prompt Retry Helper
// ============================================

/**
 * Attempt to fix a failed Gemini response using a retry prompt.
 * Uses fallback routing for the fix request.
 *
 * @param originalResponse - The original response text that failed parsing
 * @param originalPrompt - The original scoring prompt for context
 * @returns ParseRetryResult with fixed response or error
 */
async function attemptFixWithRetry(
  originalResponse: string,
  originalPrompt: string
): Promise<ParseRetryResult<GeminiScoreResponse>> {
  return retryWithFixPrompt(
    async (fixPrompt: string) => {
      return await makeGeminiRequestWithFallback(fixPrompt, {
        operationName: 'Gemini scoring fix retry',
      });
    },
    GeminiScoreResponseSchema,
    originalResponse,
    originalPrompt
  );
}

// ============================================
// Main Orchestrator (Section 9.1)
// ============================================

/**
 * Score validated items using Gemini or fallback heuristics.
 *
 * This function orchestrates the complete scoring process:
 *
 * 1. **Skip Check**: If config.skipScoring is true, immediately uses
 *    fallback heuristics (no API calls).
 *
 * 2. **Batching**: Splits items into batches of config.scoringBatchSize
 *    (default 25) to stay within API limits.
 *
 * 3. **Sequential Processing**: Processes batches one at a time (not
 *    concurrent) since Gemini scoring benefits from single-session context.
 *
 * 4. **Per-Batch Flow**:
 *    a. Build prompt with buildScoringPrompt()
 *    b. Call makeGeminiRequest() with retry logic
 *    c. Parse response with parseGeminiScoringResponse()
 *    d. On parse failure: attempt fix with retryWithFixPrompt()
 *    e. On complete failure: use fallbackScore() for this batch
 *    f. Process scores with processScoredItems()
 *
 * 5. **Final Processing**:
 *    - Merge all batch results
 *    - Re-sort by overall score (batches may overlap)
 *    - Re-assign ranks 1 to N
 *
 * **Error Handling**:
 * - Gemini API error: Log warning, use fallbackScore() for batch
 * - Parse error: Try retryWithFixPrompt(), then fallback
 * - All batches fail: Return items with fallback scores
 *
 * @param items - Validated items to score
 * @param userPrompt - Original user prompt for relevance scoring
 * @param config - Pipeline configuration
 * @returns Scored items sorted by overall score, with ranks assigned
 *
 * @example
 * ```typescript
 * const config = { skipScoring: false, scoringBatchSize: 25 };
 * const scored = await scoreItems(validatedItems, 'AI trends', config);
 * console.log('Top 10:', scored.slice(0, 10));
 * ```
 */
export async function scoreItems(
  items: ValidatedItem[],
  userPrompt: string,
  config: PipelineConfig
): Promise<ScoredItem[]> {
  // 1. Skip scoring check - use fallback heuristics
  if (config.skipScoring) {
    logVerbose('Scoring skipped, using fallback heuristics');
    return fallbackScore(items);
  }

  // Handle empty input
  if (items.length === 0) {
    logVerbose('No items to score');
    return [];
  }

  // 2. Split items into batches
  const batchSize = config.scoringBatchSize || 25;
  const batches: ValidatedItem[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const totalBatches = batches.length;
  logVerbose(`Scoring ${items.length} items in ${totalBatches} batch(es)`);

  const allScoredItems: ScoredItem[] = [];
  let successfulBatches = 0;

  // 3. Process batches sequentially
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchNum = batchIndex + 1;

    logVerbose(`Scoring batch ${batchNum}/${totalBatches}...`);

    try {
      // 4a. Build prompt
      const prompt = buildScoringPrompt(batch, userPrompt);

      // 4b. Call Gemini with retry and fallback routing
      const responseText = await makeGeminiRequestWithFallback(prompt, {
        operationName: `Gemini scoring batch ${batchNum}`,
      });

      // 4c. Parse response
      const parseResult = parseGeminiScoringResponse(responseText);

      let geminiScores: GeminiScoreResponse;

      if (parseResult.success) {
        geminiScores = parseResult.data;
      } else {
        // 4d. Parse failed - try fix prompt
        logVerbose(`Parse error on batch ${batchNum}: ${parseResult.error}`);
        logVerbose(`Attempting fix with retry...`);

        const fixResult = await attemptFixWithRetry(responseText, prompt);

        if (!fixResult.success) {
          // 4e. Fix failed - use fallback for this batch
          logWarning(
            `Batch ${batchNum} parse fix failed (${fixResult.error}), using fallback`
          );
          const fallbackItems = fallbackScore(batch);
          allScoredItems.push(...fallbackItems);
          continue;
        }

        geminiScores = fixResult.data;
        logVerbose(`Batch ${batchNum} fixed successfully (retried: ${fixResult.retried})`);
      }

      // 4f. Process scores
      const batchScoredItems = processScoredItems(batch, geminiScores);
      allScoredItems.push(...batchScoredItems);
      successfulBatches++;

    } catch (error) {
      // Gemini API error - use fallback for entire batch
      const errorMessage = error instanceof Error ? error.message : String(error);
      logWarning(`Batch ${batchNum} Gemini error: ${errorMessage}, using fallback`);

      const fallbackItems = fallbackScore(batch);
      allScoredItems.push(...fallbackItems);
    }
  }

  // Log summary
  if (successfulBatches === 0) {
    logWarning('All batches used fallback scoring');
  } else if (successfulBatches < totalBatches) {
    logVerbose(`${successfulBatches}/${totalBatches} batches scored with Gemini`);
  } else {
    logVerbose(`All ${totalBatches} batches scored successfully with Gemini`);
  }

  // Handle case where all processing failed
  if (allScoredItems.length === 0) {
    logWarning('No items were scored, returning empty result');
    return [];
  }

  // 5. Final processing: re-sort and re-rank all items together
  // This ensures correct ranking when batches have overlapping scores
  allScoredItems.sort((a, b) => b.scores.overall - a.scores.overall);

  // CRIT-3: Truncate to top N items (PRD specifies N=50)
  const topN = config.topScored ?? 50;
  const topItems = allScoredItems.slice(0, topN);

  // Re-rank only the top items (1-indexed)
  topItems.forEach((item, index) => {
    item.rank = index + 1;
  });

  // MAJ-5: Re-validate after rank mutation to ensure schema compliance
  const validatedTopItems = topItems.map(item => ScoredItemSchema.parse(item));

  logVerbose(
    `Returning top ${validatedTopItems.length} of ${allScoredItems.length} scored items, ` +
    `top score: ${validatedTopItems[0]?.scores.overall ?? 'N/A'}`
  );

  return validatedTopItems;
}

// ============================================
// Exports
// ============================================

export { GEMINI_MODEL };
