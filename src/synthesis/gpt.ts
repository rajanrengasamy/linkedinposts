/**
 * GPT-5.2 API Client Layer
 *
 * Implements Section 10.2 - Post generation API client with GPT-5.2 Thinking.
 *
 * This module provides:
 * - OpenAI client initialization and singleton management
 * - GPT-5.2 request handling with reasoning effort configuration
 * - Retry logic with exponential backoff for resilience
 * - Timeout enforcement with Promise.race pattern
 * - Error sanitization to prevent API key exposure
 *
 * Other modules handle:
 * - Claim extraction (claims.ts)
 * - Prompt building for synthesis (synthesis orchestration)
 * - Response parsing and validation (synthesis orchestration)
 *
 * @see https://platform.openai.com/docs/models/gpt-5.2
 */

import OpenAI from 'openai';
import { getApiKey } from '../config.js';
import { withRetry, CRITICAL_RETRY_OPTIONS, TimeoutError } from '../utils/retry.js';
import { createSafeError } from '../utils/sanitization.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import { STAGE_TIMEOUT_MS } from '../types/index.js';

// ============================================
// Model Configuration
// ============================================

/**
 * GPT-5.2 Thinking model ID
 * @see https://platform.openai.com/docs/models/gpt-5.2
 */
const GPT_MODEL = 'gpt-5.2';

/**
 * Reasoning effort level for GPT-5.2 Thinking.
 * Options: 'none' | 'low' | 'medium' | 'high' | 'xhigh'
 * 'medium' balances reasoning depth with response speed.
 */
const REASONING_EFFORT = 'medium' as const;

/**
 * Maximum tokens for response.
 * 8192 is sufficient for LinkedIn post (~3000 chars) plus metadata.
 */
const MAX_TOKENS = 8192;

/**
 * Temperature for generation.
 * 0.7 balances creativity with consistency.
 */
const TEMPERATURE = 0.7;

/**
 * Pricing for GPT-5.2 (used for cost tracking)
 * Rates are per million tokens
 */
export const GPT_PRICING = {
  inputPerMillion: 1.75,   // $1.75/1M input tokens
  outputPerMillion: 14.00, // $14/1M output tokens
};

// ============================================
// Types
// ============================================

/**
 * Reasoning effort levels for GPT-5.2 Thinking
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * GPT-5.2 specific reasoning configuration.
 * This extends the standard OpenAI API with thinking model parameters.
 */
interface GPT52ReasoningConfig {
  reasoning: {
    effort: ReasoningEffort;
  };
}

/**
 * Extended chat completion parameters for GPT-5.2 with reasoning support.
 * Combines standard OpenAI parameters with GPT-5.2 specific reasoning config.
 */
type GPT52ChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & GPT52ReasoningConfig;

/**
 * Options for GPT request configuration
 */
export interface GPTRequestOptions {
  /** Maximum tokens in response (default: 8192) */
  maxTokens?: number;

  /** Temperature for generation (default: 0.7) */
  temperature?: number;

  /** Request timeout in milliseconds (default: STAGE_TIMEOUT_MS) */
  timeout?: number;

  /** Reasoning effort level (default: 'medium') */
  reasoningEffort?: ReasoningEffort;

  /** Operation name for logging */
  operationName?: string;
}

/**
 * Response from GPT API call including usage statistics
 */
export interface GPTResponse {
  /** The text content returned by GPT */
  content: string;

  /** Token usage statistics for cost tracking */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ============================================
// System Prompt
// ============================================

/**
 * System prompt for LinkedIn post synthesis.
 * Instructs GPT to use only provided claims and maintain source attribution.
 */
export const SYSTEM_PROMPT = `You are a professional LinkedIn content creator. Your task is to synthesize verified information into engaging LinkedIn posts.

CRITICAL RULES:
1. ONLY use claims provided in the input - never invent facts
2. Every quote MUST have a sourceUrl from the provided claims
3. Keep the post under 3000 characters
4. Include 3-5 relevant hashtags
5. Use professional but approachable tone
6. Always respond with valid JSON matching the requested schema`;

// ============================================
// Client Initialization
// ============================================

/**
 * Singleton OpenAI client instance.
 * Initialized lazily on first use.
 */
let openaiClient: OpenAI | null = null;

/**
 * Lock flag to prevent race condition during client initialization.
 * While Node.js is single-threaded, async operations can interleave.
 */
let clientInitializing = false;

// ============================================
// Rate Limiting (MIN-4)
// ============================================

/**
 * Minimum interval between OpenAI API requests in milliseconds.
 * Helps prevent rate limiting from OpenAI (typically 60 RPM for most tiers).
 */
const MIN_REQUEST_INTERVAL_MS = 1000;

/**
 * Timestamp of the last OpenAI API request.
 * Used to enforce minimum interval between requests.
 */
let lastRequestTime = 0;

/**
 * Wait if necessary to respect the minimum request interval.
 * This is a simple rate limiter to prevent hitting OpenAI rate limits.
 *
 * @returns Promise that resolves when it's safe to make the next request
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < MIN_REQUEST_INTERVAL_MS && lastRequestTime > 0) {
    const waitTime = MIN_REQUEST_INTERVAL_MS - elapsed;
    logVerbose(`Rate limiting: waiting ${waitTime}ms before next request`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
}

/**
 * Reset rate limiting state (primarily for testing).
 */
export function resetRateLimiter(): void {
  lastRequestTime = 0;
}

/**
 * Get or create the OpenAI client singleton.
 *
 * Lazily initializes the OpenAI client on first call.
 * Validates that OPENAI_API_KEY is set before creating client.
 * Uses a lock flag to prevent race conditions during initialization.
 *
 * @returns Initialized OpenAI client
 * @throws Error if OPENAI_API_KEY is not configured or initialization race detected
 *
 * @example
 * ```typescript
 * const client = getOpenAIClient();
 * const response = await client.chat.completions.create({...});
 * ```
 */
export function getOpenAIClient(): OpenAI {
  // Fast path: client already exists
  if (openaiClient !== null) {
    return openaiClient;
  }

  // Prevent race condition: if already initializing, throw
  // This handles the case where multiple async operations call this
  // before the first initialization completes
  if (clientInitializing) {
    throw new Error(
      'OpenAI client initialization in progress. This indicates a race condition.'
    );
  }

  clientInitializing = true;
  try {
    // Double-check after acquiring lock (another call might have completed)
    if (openaiClient !== null) {
      return openaiClient;
    }

    const apiKey = getApiKey('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for synthesis. ' +
          'Please set it in your .env file or environment.'
      );
    }

    // Create and cache the client
    openaiClient = new OpenAI({ apiKey });
    logVerbose('OpenAI client initialized');

    return openaiClient;
  } finally {
    clientInitializing = false;
  }
}

/**
 * Reset the client singleton (primarily for testing)
 */
export function resetOpenAIClient(): void {
  openaiClient = null;
  clientInitializing = false;
}

// ============================================
// Main API Request Function
// ============================================

/**
 * Make a request to the GPT-5.2 API with reasoning enabled.
 *
 * Sends a prompt to GPT-5.2 with the specified reasoning effort and returns
 * the response content along with usage statistics. Uses retry logic with
 * exponential backoff for resilience against transient failures and rate limits.
 *
 * Features:
 * - GPT-5.2 Thinking with configurable reasoning effort
 * - JSON response format enforcement
 * - Timeout enforcement via Promise.race
 * - Retry with exponential backoff (CRITICAL_RETRY_OPTIONS)
 * - Error sanitization to prevent API key exposure
 *
 * @param prompt - The user prompt to send (system prompt added automatically)
 * @param options - Optional request configuration
 * @returns Promise resolving to GPTResponse with content and usage stats
 * @throws Error if API key is missing or all retries fail
 *
 * @example
 * ```typescript
 * const response = await makeGPTRequest(
 *   'Create a LinkedIn post about AI trends using these claims: ...',
 *   { reasoningEffort: 'high', maxTokens: 4096 }
 * );
 * console.log('Content:', response.content);
 * console.log('Tokens used:', response.usage.totalTokens);
 * ```
 */
export async function makeGPTRequest(
  prompt: string,
  options?: GPTRequestOptions
): Promise<GPTResponse> {
  const {
    maxTokens = MAX_TOKENS,
    temperature = TEMPERATURE,
    timeout = STAGE_TIMEOUT_MS,
    reasoningEffort = REASONING_EFFORT,
    operationName = 'GPT synthesis request',
  } = options ?? {};

  logVerbose(`${operationName}: Sending request (${prompt.length} chars, reasoning: ${reasoningEffort})`);

  // Get client (validates API key)
  const client = getOpenAIClient();

  // Make API request with retry logic and timeout enforcement
  const result = await withRetry(
    async () => {
      // MIN-4: Enforce rate limiting between requests
      await waitForRateLimit();

      // Create timeout promise to enforce timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TimeoutError(`GPT request timed out after ${timeout}ms`, timeout)),
          timeout
        );
      });

      // Build the API request with GPT-5.2 specific parameters
      // Uses GPT52ChatCompletionParams type to properly type the reasoning parameter
      const requestParams: GPT52ChatCompletionParams = {
        model: GPT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        reasoning: { effort: reasoningEffort },
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        temperature: temperature,
      };

      // Cast to base type for OpenAI client (reasoning param is GPT-5.2 specific)
      const apiPromise = client.chat.completions.create(
        requestParams as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
      );

      // Race between API call and timeout
      // Type assertion needed because Promise.race returns union with Stream type
      const response = await Promise.race([apiPromise, timeoutPromise]) as OpenAI.Chat.Completions.ChatCompletion;

      // MAJ-18: Extract content with specific error messages for each failure case
      if (!response.choices || response.choices.length === 0) {
        throw new Error('GPT API response has no choices array');
      }
      const firstChoice = response.choices[0];
      if (!firstChoice.message) {
        throw new Error('GPT API response choice has no message object');
      }
      const content = firstChoice.message.content;
      if (!content || content.trim().length === 0) {
        throw new Error('GPT API response message has empty content');
      }

      // Extract usage statistics (MAJ-2: throw if missing for accurate cost tracking)
      if (!response.usage) {
        throw new Error('Missing usage statistics in GPT API response');
      }
      const usage = response.usage;

      return {
        content: content.trim(),
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
      };
    },
    {
      ...CRITICAL_RETRY_OPTIONS,
      operationName,
    }
  );

  // Handle retry result
  if (!result.success) {
    logWarning(`${operationName}: Failed after ${result.attempts} attempts`);
    // Use createSafeError to prevent API key exposure
    const safeError = createSafeError(
      `${operationName} (after ${result.attempts} attempts)`,
      result.error
    );
    throw safeError;
  }

  logVerbose(
    `${operationName}: Response received (${result.data.content.length} chars, ` +
      `${result.data.usage.totalTokens} tokens, ${result.attempts} attempt(s))`
  );

  return result.data;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Calculate estimated cost for a GPT request based on token usage.
 *
 * @param usage - Token usage statistics from GPT response
 * @returns Estimated cost in USD
 *
 * @example
 * ```typescript
 * const response = await makeGPTRequest(prompt);
 * const cost = calculateGPTCost(response.usage);
 * console.log(`Request cost: $${cost.toFixed(4)}`);
 * ```
 */
export function calculateGPTCost(usage: GPTResponse['usage']): number {
  const inputCost = (usage.promptTokens / 1_000_000) * GPT_PRICING.inputPerMillion;
  const outputCost = (usage.completionTokens / 1_000_000) * GPT_PRICING.outputPerMillion;
  return inputCost + outputCost;
}

// ============================================
// Section 10.2-10.4: Response Parser & Orchestrator
// ============================================

import {
  parseModelResponse,
  retryWithFixPrompt,
  SynthesisResultSchema,
  GPTSynthesisResponseSchema,
  LINKEDIN_POST_MAX_LENGTH,
  LINKEDIN_HASHTAGS_MIN,
  LINKEDIN_HASHTAGS_MAX,
  SCHEMA_VERSION,
  createEmptyCostBreakdown,
  SchemaValidationError,
  isFixableParseError,
  type SynthesisResult,
  type ScoredItem,
  type SourceReference,
} from '../schemas/index.js';
import { sanitizePromptContent, sanitizeErrorMessage } from '../utils/sanitization.js';
import type { GroundedClaim } from './claims.js';
import type { PipelineConfig } from '../types/index.js';

// ============================================
// Prompt Building Constants
// ============================================

/**
 * Maximum prompt length to prevent excessive API costs (100k chars)
 */
const MAX_PROMPT_LENGTH = 100000;

/**
 * Maximum content length for individual claims in prompts (500 chars)
 */
const MAX_CLAIM_LENGTH = 500;

/**
 * Approximate fixed template size for prompt length estimation
 */
const PROMPT_OVERHEAD = 1500;

/**
 * Per-claim overhead for delimiters and metadata in prompt
 */
const CLAIM_OVERHEAD = 150;

/**
 * Approximate characters per token for estimation (~4 chars/token for GPT models)
 */
const CHARS_PER_TOKEN = 4;

// ============================================
// Delimiters for structured prompt sections
// ============================================

/**
 * Structured delimiters for prompt security.
 *
 * SECURITY BOUNDARY (MIN-3):
 * These delimiters form a critical security boundary between trusted instructions
 * and untrusted user content. They help the model distinguish between:
 * - System instructions (outside delimiters) - trusted, control behavior
 * - User content (inside delimiters) - untrusted, should be treated as data only
 *
 * Attack prevention:
 * - Prompt injection: User content cannot escape delimiters to inject instructions
 * - Data exfiltration: Model is instructed to only use claims within delimiters
 * - Instruction override: Delimiter-wrapped content is explicitly marked as data
 *
 * IMPORTANT: Always use sanitizePromptContent() on any content placed within delimiters
 * to neutralize delimiter escape attempts and other injection vectors.
 */
export const DELIMITERS = {
  USER_PROMPT_START: '<<<USER_PROMPT_START>>>',
  USER_PROMPT_END: '<<<USER_PROMPT_END>>>',
  CLAIMS_START: '<<<VERIFIED_CLAIMS_START>>>',
  CLAIMS_END: '<<<VERIFIED_CLAIMS_END>>>',
  INSTRUCTIONS_START: '<<<INSTRUCTIONS_START>>>',
  INSTRUCTIONS_END: '<<<INSTRUCTIONS_END>>>',
} as const;

// ============================================
// Token Estimation
// ============================================

/**
 * Estimate the number of tokens in a prompt string.
 *
 * Uses a simple heuristic of ~4 characters per token, which is
 * reasonably accurate for English text with GPT models.
 *
 * This is an estimate - actual token count depends on the specific
 * tokenizer and content. Use for cost estimation and limit checks,
 * not precise billing.
 *
 * @param prompt - The prompt string to estimate
 * @returns Estimated token count (rounded up)
 *
 * @example
 * ```typescript
 * const tokens = estimatePromptTokens(myPrompt);
 * const estimatedCost = tokens * COST_PER_INPUT_TOKEN;
 * ```
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / CHARS_PER_TOKEN);
}

// ============================================
// Prompt Building (Section 10.2)
// ============================================

/**
 * Format grounded claims for inclusion in the synthesis prompt.
 *
 * Each claim is formatted with:
 * - Sequential index number for reference
 * - Type (quote, statistic, insight)
 * - Sanitized and truncated claim text (max 500 chars)
 * - Author (if available)
 * - Source URL for attribution
 * - Verification level for trust context
 * - Source item ID for traceability
 *
 * Security measures:
 * - Content is sanitized using sanitizePromptContent()
 * - Long claims are truncated to MAX_CLAIM_LENGTH characters
 *
 * @param claims - Array of grounded claims to format
 * @returns Formatted claims string ready for prompt inclusion
 *
 * @example
 * ```typescript
 * const formatted = formatClaimsForPrompt(claims);
 * // Returns:
 * // [1] Type: insight
 * // Claim: AI will transform...
 * // Author: Unknown
 * // Source: https://...
 * // Verification: SOURCE_CONFIRMED
 * // ID: abc-123
 * ```
 */
export function formatClaimsForPrompt(claims: GroundedClaim[]): string {
  return claims
    .map((claim, index) => {
      // Sanitize ALL user-controlled fields to prevent prompt injection
      // CRIT-4: Author/URL fields were previously unsanitized attack vectors
      const sanitizedClaim = sanitizePromptContent(claim.claim, MAX_CLAIM_LENGTH);
      const sanitizedAuthor = sanitizePromptContent(claim.author ?? 'Unknown', 100);
      const sanitizedSourceUrl = sanitizePromptContent(claim.sourceUrl, 500);

      // Truncate claim if still over limit (sanitizePromptContent handles this, but be explicit)
      const truncatedClaim =
        sanitizedClaim.length > MAX_CLAIM_LENGTH
          ? sanitizedClaim.substring(0, MAX_CLAIM_LENGTH) + '...'
          : sanitizedClaim;

      return `[${index + 1}] Type: ${claim.type}
Claim: ${truncatedClaim}
Author: ${sanitizedAuthor}
Source: ${sanitizedSourceUrl}
Verification: ${claim.verificationLevel}
ID: ${claim.sourceItemId}`;
    })
    .join('\n\n');
}

/**
 * Build the synthesis prompt for GPT-5.2.
 *
 * Creates a structured prompt that:
 * - Provides the user's topic
 * - Lists all verified claims with source URLs
 * - Specifies output requirements (post length, hashtags, etc.)
 * - Requests JSON output matching SynthesisResultSchema
 *
 * @param claims - Array of grounded claims to use
 * @param userPrompt - The user's original topic/prompt
 * @returns Complete prompt string ready to send to GPT
 */
/**
 * Minimum user prompt length required for synthesis.
 * Prompts shorter than this are likely to produce poor results.
 */
const MIN_USER_PROMPT_LENGTH = 10;

/**
 * Safety buffer multiplier for prompt length estimation.
 * Accounts for sanitization potentially changing content length.
 */
const PROMPT_LENGTH_SAFETY_BUFFER = 1.1; // 10% buffer

export function buildSynthesisPrompt(
  claims: GroundedClaim[],
  userPrompt: string
): string {
  // MAJ-12: Validate minimum prompt length
  if (!userPrompt || userPrompt.trim().length < MIN_USER_PROMPT_LENGTH) {
    throw new Error(
      `FATAL: User prompt too short - ${userPrompt?.trim().length ?? 0} chars, minimum ${MIN_USER_PROMPT_LENGTH} required`
    );
  }

  // Pre-estimate prompt length to fail fast
  // MAJ-7: Add 10% safety buffer since sanitization may change length
  const rawEstimatedLength =
    PROMPT_OVERHEAD +
    userPrompt.length +
    claims.reduce(
      (sum, claim) =>
        sum + Math.min(claim.claim.length, MAX_CLAIM_LENGTH) + CLAIM_OVERHEAD,
      0
    );

  // Apply safety buffer to account for sanitization variations
  const estimatedLength = Math.ceil(rawEstimatedLength * PROMPT_LENGTH_SAFETY_BUFFER);

  if (estimatedLength > MAX_PROMPT_LENGTH) {
    throw new Error(
      `FATAL: Prompt too long - ${estimatedLength} chars exceeds ${MAX_PROMPT_LENGTH} max, reduce ${claims.length} claims`
    );
  }

  const sanitizedUserPrompt = sanitizePromptContent(userPrompt, MAX_CLAIM_LENGTH);
  const formattedClaims = formatClaimsForPrompt(claims);

  // Count verification levels for context
  const primaryCount = claims.filter(c => c.verificationLevel === 'PRIMARY_SOURCE').length;
  const multiCount = claims.filter(c => c.verificationLevel === 'MULTISOURCE_CONFIRMED').length;
  const singleCount = claims.filter(c => c.verificationLevel === 'SOURCE_CONFIRMED').length;

  const prompt = `Create a professional LinkedIn post about the following topic.

${DELIMITERS.USER_PROMPT_START}
${sanitizedUserPrompt}
${DELIMITERS.USER_PROMPT_END}

USE ONLY the following verified claims. Do NOT invent facts, quotes, or statistics.

${DELIMITERS.CLAIMS_START}
${formattedClaims}
${DELIMITERS.CLAIMS_END}

Source Summary:
- ${primaryCount} primary sources
- ${multiCount} multi-source confirmed
- ${singleCount} single-source confirmed
- Total: ${claims.length} verified claims

REQUIREMENTS:
1. LinkedIn Post (max ${LINKEDIN_POST_MAX_LENGTH} characters):
   - Hook: Engaging first line that grabs attention
   - Body: 2-3 key insights using the verified claims
   - For each quote or statistic, use the EXACT text from claims above
   - Call to action at end
   - ${LINKEDIN_HASHTAGS_MIN}-${LINKEDIN_HASHTAGS_MAX} relevant hashtags

2. keyQuotes Array:
   - Extract 2-4 key quotes used in the post
   - Each must have: quote, author, sourceUrl, verificationLevel
   - sourceUrl MUST match exactly from the claims above

3. infographicBrief:
   - title: Catchy title for visual
   - keyPoints: 3-5 bullet points summarizing main insights
   - suggestedStyle: "minimal", "data-heavy", or "quote-focused"
   - colorScheme: Optional color suggestion

4. factCheckSummary:
   - totalSourcesUsed: Number of unique sources referenced
   - verifiedQuotes: Number of quotes with verified sources
   - unverifiedClaims: Should be 0 (we only use verified claims)
   - primarySources: Count of PRIMARY_SOURCE level claims used
   - warnings: Array of any caveats (empty if none)

Return ONLY valid JSON in this exact format:
{
  "linkedinPost": "Your LinkedIn post text here...",
  "keyQuotes": [
    {
      "quote": "exact quote text",
      "author": "Author Name",
      "sourceUrl": "https://...",
      "verificationLevel": "PRIMARY_SOURCE"
    }
  ],
  "infographicBrief": {
    "title": "Infographic Title",
    "keyPoints": ["Point 1", "Point 2", "Point 3"],
    "suggestedStyle": "minimal",
    "colorScheme": "blue and white"
  },
  "factCheckSummary": {
    "totalSourcesUsed": 3,
    "verifiedQuotes": 2,
    "unverifiedClaims": 0,
    "primarySources": 1,
    "warnings": []
  }
}

CRITICAL: Every quote in keyQuotes MUST have a valid sourceUrl from the claims provided.`;

  return prompt;
}

// ============================================
// Response Parsing (Section 10.2)
// ============================================

/**
 * Parse GPT's synthesis response text into validated data.
 *
 * Uses parseModelResponse to handle common LLM output patterns
 * (markdown fences, trailing text, etc.).
 *
 * CODEX-CRIT-1 FIX: Validates against GPTSynthesisResponseSchema (partial schema)
 * instead of full SynthesisResultSchema. The full schema requires prompt: min(1),
 * but GPT doesn't return the prompt - it's added by synthesize() later.
 * Full schema validation happens in synthesize() after prompt is populated.
 *
 * @param response - Raw text response from GPT API
 * @returns Parsed SynthesisResult with placeholder prompt (to be set by caller)
 * @throws Error if parsing or validation fails
 */
export function parseSynthesisResponse(response: string): SynthesisResult {
  // Parse JSON from response (handles code fences, etc.)
  // Throws JsonParseError (fixable) if JSON is malformed
  const rawParsed = parseModelResponse<unknown>(response);

  // Validate against partial schema (GPT response fields only)
  // CODEX-CRIT-1: Don't validate full schema here - prompt is empty
  // MAJ-16: Wrap Zod errors as SchemaValidationError (not fixable)
  const validationResult = GPTSynthesisResponseSchema.safeParse(rawParsed);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new SchemaValidationError(
      `GPT response schema validation failed: ${errorMessages}`,
      validationResult.error
    );
  }
  const parsed = validationResult.data;

  // Build full SynthesisResult with placeholder metadata
  // Note: prompt and metadata will be updated by synthesize() with actual values
  const result: SynthesisResult = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    prompt: '[PENDING]', // Placeholder - will be set by synthesize()
    linkedinPost: parsed.linkedinPost,
    keyQuotes: parsed.keyQuotes,
    infographicBrief: parsed.infographicBrief,
    factCheckSummary: parsed.factCheckSummary,
    metadata: {
      sourcesUsed: parsed.factCheckSummary.totalSourcesUsed,
      processingTimeMs: 0, // Will be set by synthesize()
      estimatedCost: createEmptyCostBreakdown(),
    },
  };

  // Apply output constraints validation (post length, hashtags, sourceUrls)
  // Note: Full SynthesisResultSchema validation happens in synthesize() after prompt is set
  validateOutputConstraints(result);

  return result;
}

// ============================================
// Parse with Retry Helper (MAJ-8)
// ============================================

/**
 * Parse GPT response with automatic retry on fixable errors.
 *
 * Extracts the parse-and-retry logic from synthesize() to reduce function length
 * and improve testability.
 *
 * @param content - Raw GPT response content to parse
 * @param originalPrompt - Original synthesis prompt for retry context
 * @returns Parsed SynthesisResult
 * @throws Error with FATAL prefix if parsing fails after retry
 */
async function parseWithRetry(
  content: string,
  originalPrompt: string
): Promise<SynthesisResult> {
  try {
    return parseSynthesisResponse(content);
  } catch (parseError) {
    // MAJ-16: Check if error is fixable before attempting retry
    // Schema validation errors (wrong structure) won't be fixed by re-prompting
    if (!isFixableParseError(parseError)) {
      const originalMsg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(
        `FATAL: Synthesis parse failed - schema validation error, not retryable - ${sanitizeErrorMessage(originalMsg)}`
      );
    }

    // On fixable parse error (JSON syntax): retry once with fix prompt
    logWarning('Initial parse failed (JSON error), attempting fix with retry...');

    const fixResult = await retryWithFixPrompt(
      async (fixPrompt: string) => {
        const response = await makeGPTRequest(fixPrompt, {
          operationName: 'GPT synthesis fix retry',
          reasoningEffort: 'medium',
        });
        return response.content;
      },
      SynthesisResultSchema,
      content,
      originalPrompt
    );

    if (!fixResult.success) {
      const originalMsg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(
        `FATAL: Synthesis parse failed after retry - original: ${sanitizeErrorMessage(originalMsg)}, retry: ${sanitizeErrorMessage(fixResult.error)}`
      );
    }

    logVerbose(`Parse fix successful (retried: ${fixResult.retried})`);
    return fixResult.data;
  }
}

// ============================================
// Output Constraints (Section 10.3)
// ============================================

/**
 * Validate that the synthesis result meets output constraints.
 *
 * Checks:
 * - Post length <= 3000 characters
 * - Hashtag count (3-5, warning only)
 * - All quotes have sourceUrl (CRITICAL)
 * - All quote sourceUrls exist in provided claims (CRITICAL - CODEX-HIGH-1)
 *
 * @param result - Synthesis result to validate
 * @param allowedSourceUrls - Optional set of allowed source URLs from claims
 * @throws Error if critical constraints violated
 */
/**
 * Minimum recommended post length for LinkedIn engagement.
 * Posts shorter than this may not provide enough value.
 */
const MIN_POST_LENGTH = 100;

export function validateOutputConstraints(
  result: SynthesisResult,
  allowedSourceUrls?: Set<string>
): void {
  // MIN-2: Warn if post is too short (may lack substance)
  if (result.linkedinPost.length < MIN_POST_LENGTH) {
    logWarning(
      `Post is very short (${result.linkedinPost.length} chars, minimum recommended: ${MIN_POST_LENGTH}). ` +
        `Consider providing more claims for richer content.`
    );
  }

  // Check post length (hard limit)
  if (result.linkedinPost.length > LINKEDIN_POST_MAX_LENGTH) {
    throw new Error(
      `FATAL: Post too long - ${result.linkedinPost.length} chars exceeds maximum ${LINKEDIN_POST_MAX_LENGTH}`
    );
  }

  // Check hashtag count (warning only, not fatal)
  const hashtags = result.linkedinPost.match(/#\w+/g) ?? [];
  if (hashtags.length < LINKEDIN_HASHTAGS_MIN || hashtags.length > LINKEDIN_HASHTAGS_MAX) {
    logWarning(
      `Post has ${hashtags.length} hashtags (expected ${LINKEDIN_HASHTAGS_MIN}-${LINKEDIN_HASHTAGS_MAX})`
    );
  }

  // CRITICAL: Every quote must have sourceUrl
  for (const quote of result.keyQuotes) {
    if (!quote.sourceUrl) {
      throw new Error(
        `FATAL: Quote missing sourceUrl - "${quote.quote.substring(0, 50)}..."`
      );
    }

    // CODEX-HIGH-1: Validate that sourceUrl exists in provided claims
    if (allowedSourceUrls && !allowedSourceUrls.has(quote.sourceUrl)) {
      throw new Error(
        `FATAL: Quote has invalid sourceUrl - not found in claims: "${quote.sourceUrl}", quote: "${quote.quote.substring(0, 50)}..."`
      );
    }
  }
}

// ============================================
// Main Orchestrator (Section 10.2)
// ============================================

/**
 * Synthesize a LinkedIn post from grounded claims.
 *
 * Main orchestrator for the synthesis stage:
 * 1. Validates inputs (throws FATAL if empty claims)
 * 2. Builds prompt with buildSynthesisPrompt()
 * 3. Calls makeGPTRequest() with medium reasoning effort
 * 4. Parses response with parseSynthesisResponse()
 * 5. On parse error: retry once with retryWithFixPrompt(), then throw FATAL
 * 6. Adds metadata (processingTimeMs, sourcesUsed)
 * 7. Final validation with SynthesisResultSchema.parse()
 *
 * CRITICAL: GPT errors are FATAL - pipeline cannot complete without synthesis.
 *
 * @param claims - Array of grounded claims with source URLs
 * @param prompt - Original user prompt for context
 * @param config - Pipeline configuration
 * @returns Validated SynthesisResult
 * @throws Error with "FATAL:" prefix if synthesis fails
 *
 * @example
 * ```typescript
 * const claims = extractGroundedClaims(scoredItems);
 * const synthesis = await synthesize(claims, 'AI trends 2025', config);
 * console.log(synthesis.linkedinPost);
 * ```
 */
export async function synthesize(
  claims: GroundedClaim[],
  prompt: string,
  _config: PipelineConfig
): Promise<SynthesisResult> {
  const startTime = Date.now();

  // 0. Pre-validate API key before any processing (MAJ-1)
  // This prevents wasted processing if API key is missing
  const apiKey = getApiKey('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'FATAL: Missing API key - OPENAI_API_KEY is required for synthesis'
    );
  }

  // 1. Validate inputs - FATAL if empty
  if (!claims || claims.length === 0) {
    throw new Error(
      'FATAL: No claims provided - cannot generate post without verified source material'
    );
  }

  logVerbose(`Synthesizing from ${claims.length} grounded claims`);

  // 2. Build prompt
  const synthesisPrompt = buildSynthesisPrompt(claims, prompt);

  // 3. Call GPT with retry (throws on failure - FATAL)
  let gptResponse: GPTResponse;
  try {
    gptResponse = await makeGPTRequest(synthesisPrompt, {
      operationName: 'GPT synthesis',
      reasoningEffort: 'medium',
    });
  } catch (error) {
    // Always create a new sanitized error - never re-throw original (may contain API keys)
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('FATAL:')) {
      throw new Error(`FATAL: GPT synthesis failed - ${sanitizeErrorMessage(message)}`);
    }
    // Even for FATAL errors, create new error to ensure sanitization
    throw new Error(sanitizeErrorMessage(message));
  }

  // 4. Parse response with automatic retry on fixable errors (MAJ-8)
  const parsedResult = await parseWithRetry(gptResponse.content, synthesisPrompt);

  // 5. Update metadata
  const processingTimeMs = Date.now() - startTime;

  // Calculate cost from token usage
  const gptCost = calculateGPTCost(gptResponse.usage);

  const resultWithMetadata: SynthesisResult = {
    ...parsedResult,
    prompt, // Set the original user prompt
    metadata: {
      ...parsedResult.metadata,
      processingTimeMs,
      sourcesUsed: new Set(claims.map(c => c.sourceUrl)).size,
      estimatedCost: {
        ...parsedResult.metadata.estimatedCost,
        openai: gptCost,
        total: gptCost, // Will be updated with other costs at pipeline level
      },
    },
  };

  // 6. Final validation with schema
  const finalResult = SynthesisResultSchema.parse(resultWithMetadata);

  // 8. CODEX-HIGH-1: Validate quote provenance - sourceUrls must exist in claims
  const allowedSourceUrls = new Set(claims.map(c => c.sourceUrl));
  validateOutputConstraints(finalResult, allowedSourceUrls);

  logVerbose(
    `Synthesis complete: ${finalResult.linkedinPost.length} chars, ` +
      `${finalResult.keyQuotes.length} quotes, ` +
      `${processingTimeMs}ms`
  );

  return finalResult;
}

// ============================================
// Source References (Section 10.4)
// ============================================

/**
 * Build source references from scored items and synthesis result.
 *
 * Creates a SourceReference for each item, marking whether it was
 * used in the final LinkedIn post (based on quote URLs).
 *
 * @param items - All scored items that were considered
 * @param synthesis - The synthesis result with keyQuotes
 * @returns Array of SourceReference objects for provenance tracking
 *
 * @example
 * ```typescript
 * const sources = buildSourceReferences(scoredItems, synthesis);
 * writeSourcesJson(join(outputDir, 'sources.json'), sources);
 * ```
 */
export function buildSourceReferences(
  items: ScoredItem[],
  synthesis: SynthesisResult
): SourceReference[] {
  // Build set of URLs used in the post for O(1) lookup
  const usedUrls = new Set(synthesis.keyQuotes.map(q => q.sourceUrl));

  return items.map(item => ({
    id: item.id,
    url: item.sourceUrl,
    title: item.title ?? 'Untitled',
    author: item.author,
    publishedAt: item.publishedAt,
    retrievedAt: item.retrievedAt,
    verificationLevel: item.validation.level,
    usedInPost: usedUrls.has(item.sourceUrl),
  }));
}

// ============================================
// Exports
// ============================================

export {
  GPT_MODEL,
  REASONING_EFFORT,
  MAX_TOKENS,
  TEMPERATURE,
};
