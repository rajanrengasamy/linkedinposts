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
import { STAGE_TIMEOUT_MS, DEFAULT_CONFIG } from '../types/index.js';
import type { SynthesizerFn, SynthesisOptions } from './types.js';

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
 * Options: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
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
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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
 *
 * Covers: ATTENTION, STRUCTURE, CREDIBILITY, ACTION, and INVIOLABLE RULES
 */
export const SYSTEM_PROMPT = `You are an expert LinkedIn content strategist who transforms verified research into high-engagement professional posts. Your posts consistently achieve top performance because you understand LinkedIn's unique dynamics.

ATTENTION - THE CRITICAL FIRST LINES:
- The first 2-3 lines appear ABOVE the "see more" fold - they determine if readers expand
- Lead with your strongest hook: a surprising stat, provocative question, or contrarian take
- Never waste the opening on generic statements like "I've been thinking about..."
- Create immediate tension or curiosity that demands resolution

STRUCTURE - VISUAL HIERARCHY FOR MOBILE:
- Short paragraphs (1-3 sentences max) with generous white space
- Single-sentence paragraphs for emphasis and pacing
- Use line breaks liberally - walls of text kill engagement
- Build rhythm: hook -> insight -> evidence -> insight -> evidence -> takeaway -> CTA
- Each paragraph should advance ONE idea, not multiple

CREDIBILITY - SOURCE EVERYTHING:
- Every claim, quote, and statistic MUST be backed by provided sources
- Never paraphrase in a way that changes meaning or creates false attribution
- When citing, use the EXACT wording from verified claims
- NEVER truncate quotes mid-sentence or mid-word - use COMPLETE sentences only
- If a quote is too long, select a complete sentence from it, don't cut it arbitrarily
- If a source has limitations, acknowledge them rather than overselling

ACTION - DRIVE ENGAGEMENT:
- End with a clear call-to-action that prompts comments, not just likes
- Ask specific questions that invite professional perspectives
- Create posts that readers want to share because they make the sharer look insightful
- Give readers something to think about, feel, or do differently

INVIOLABLE RULES:
1. ONLY use claims, quotes, and statistics from the provided verified sources - NEVER fabricate
2. Every quote in keyQuotes MUST have a sourceUrl from the provided claims
3. Use "Unknown" for missing author names - NEVER use empty strings
4. Keep posts under 3000 characters with 3-5 relevant hashtags
5. Always respond with valid JSON matching the exact requested schema
6. When uncertain about a claim's accuracy, omit it rather than risk misinformation

OUTPUT QUALITY REQUIREMENTS:
- The linkedinPost MUST be a clean, ready-to-publish post with NO meta-commentary
- NEVER include phrases like "I should...", "Let me...", "I'm going to...", "This post will..."
- NEVER explain what you're doing or describe your process - just produce the final output
- NEVER include instructions or method descriptions in the post itself
- The output should read as if written by a human professional, not an AI explaining its work
- No placeholder text, no "insert X here", no "[description of what goes here]"`;

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
 * Uses the Responses API (recommended for GPT-5.2) which provides:
 * - Better reasoning support with persistent chain-of-thought
 * - 40-80% better cache utilization (lower costs)
 * - 3% better performance on benchmarks vs Chat Completions
 *
 * Features:
 * - GPT-5.2 with configurable reasoning effort (none → xhigh)
 * - JSON response format enforcement via text.format
 * - Timeout enforcement via Promise.race
 * - Retry with exponential backoff (CRITICAL_RETRY_OPTIONS)
 * - Error sanitization to prevent API key exposure
 *
 * @see https://platform.openai.com/docs/guides/migrate-to-responses
 *
 * @param prompt - The user prompt to send (instructions added automatically)
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
    // Note: temperature is not used with Responses API reasoning models
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

      // Build the API request using Responses API (recommended for GPT-5.2)
      // Responses API provides better reasoning support, caching, and performance
      // @see https://platform.openai.com/docs/guides/migrate-to-responses
      const apiPromise = client.responses.create({
        model: GPT_MODEL,
        instructions: SYSTEM_PROMPT,
        input: [{ role: 'user' as const, content: prompt }],
        reasoning: { effort: reasoningEffort },
        text: { format: { type: 'json_object' as const } },
        max_output_tokens: maxTokens,
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      // Extract content from Responses API structure
      // Responses API uses output_text helper for text content
      const content = response.output_text;
      if (!content || content.trim().length === 0) {
        throw new Error('GPT API response has empty output_text');
      }

      // Extract usage statistics (MAJ-2: throw if missing for accurate cost tracking)
      // Responses API uses input_tokens/output_tokens instead of prompt_tokens/completion_tokens
      if (!response.usage) {
        throw new Error('Missing usage statistics in GPT API response');
      }
      const usage = response.usage;

      return {
        content: content.trim(),
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
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
  GPTMultiPostResponseSchema,
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
  type GPTMultiPostResponse,
  type LinkedInPost,
} from '../schemas/index.js';
import { sanitizePromptContent, sanitizeErrorMessage } from '../utils/sanitization.js';
import type { GroundedClaim } from './claims.js';
import type { PipelineConfig, PostStyle } from '../types/index.js';

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
 * Approximate fixed template size for prompt length estimation.
 * Updated to account for expanded guidance sections in buildSynthesisPrompt.
 */
const PROMPT_OVERHEAD = 5000;

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

  // Determine content depth for thin content handling
  const isThinContent = claims.length < 3;
  const thinContentNote = isThinContent
    ? `\nNOTE: Limited source material (${claims.length} claims). Keep post focused and concise - do not pad with generic statements. A shorter, high-quality post is better than a longer padded one.`
    : '';

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
- Total: ${claims.length} verified claims${thinContentNote}

${DELIMITERS.INSTRUCTIONS_START}

=== POST STRUCTURE ===

AIM FOR SUBSTANTIAL POSTS (1500-2500 characters). Short posts lack depth. LinkedIn rewards thoughtful, comprehensive content.

OPENING HOOK (First 2-3 lines - CRITICAL):
Choose ONE approach that fits your strongest claim:
- Surprising Statistic: Lead with a counter-intuitive number ("72% of executives say X, yet only 15% are doing Y")
- Provocative Question: Challenge assumptions ("What if everything we know about X is wrong?")
- Contrarian Take: Present an unexpected perspective ("The conventional wisdom about X misses the point entirely")
- Bold Statement: Make a claim you can back up ("X is not what most people think it is")

BODY STRUCTURE - USE RICH FORMATTING:

1. **Section Headers**: Use ### headers to create clear sections (e.g., "### What's changing", "### The real bottleneck", "### My takeaway")

2. **Numbered Lists**: For sequential points or frameworks, use numbered lists with **bold lead-ins**:
   1. **First point** explanation here
   2. **Second point** explanation here

3. **Bullet Points**: For non-sequential items, use bullets:
   • Point with **bold emphasis** on key phrase
   • Another point with specific details

4. **Bold for Emphasis**: Use **bold** liberally on key phrases, not just single words. Bold the insight, not filler.

5. **Multiple Perspectives**: Don't just state one thing - explore:
   - What changed?
   - Why it matters?
   - What's the implication?
   - What should readers do?

6. **Specificity**: Name specific tools, companies, frameworks when the claims support it. Generic insights feel thin.

SECTION FLOW (recommended structure):
- HOOK: 2-3 punchy lines
- CONTEXT: What's happening / what changed (with numbered points if multiple factors)
- SECTION 1: "### What's different now" or similar - explore implications with bullets
- SECTION 2: "### The real challenge" or similar - go deeper on one angle
- TAKEAWAY: "### My takeaway" - your synthesis
- CTA: Specific question
- HASHTAGS: At the very end

CLOSING:
- Key Takeaway: Frame it as "### My takeaway" section with 2-3 sentences of synthesis
- Specific CTA: Ask a question that invites professional perspectives (avoid generic "What do you think?")
- Sources Section: Add "---" then "Sources:" with numbered list of URLs for key quotes used
- Hashtags: ${LINKEDIN_HASHTAGS_MIN}-${LINKEDIN_HASHTAGS_MAX} relevant hashtags at the very end

CITATION FORMAT:
- When quoting a source in the post body, add a bracketed number: "quote text" [1]
- At the end (before hashtags), include a Sources section:
  ---
  Sources:
  [1] https://example.com/article
  [2] https://another-source.com/report
- Only include sources that are actually cited in the post
- This adds ~200-400 chars but provides crucial credibility

FORMATTING RULES:
- TARGET 1500-2500 characters (use the space - depth wins)
- Maximum ${LINKEDIN_POST_MAX_LENGTH} characters total
- Line breaks between paragraphs (double newline)
- Use ### headers to create scannable sections
- Use **bold** for key phrases throughout
- Use numbered lists for frameworks, bullets for features/examples
- No emoji unless the topic specifically warrants it
- Use quotation marks for direct quotes, attribute clearly

=== TONE GUIDELINES ===

Match tone to topic type:
- TECHNICAL topics: Precise language, specific details, avoid hyperbole, focus on implications
- LEADERSHIP topics: Inspirational but grounded, connect to broader themes, emphasize human elements
- CAREER topics: Practical, actionable, relatable personal angle where appropriate
- NEWS/TRENDS topics: Timely context, what it means for the reader, forward-looking perspective

General tone: Professional but conversational. Write as an expert sharing insights with peers, not lecturing.

=== keyQuotes SELECTION GUIDANCE ===

Select 2-4 quotes prioritizing:
1. Authority: Quotes from recognized industry leaders, researchers, or executives
2. Specificity: Concrete numbers, dates, or named examples over vague statements
3. Verifiability: PRIMARY_SOURCE and MULTISOURCE_CONFIRMED over single-source
4. Impact: Quotes that support the post's main argument or provide "aha" moments

CRITICAL QUOTE RULES - NEVER TRUNCATE:
- The "quote" field MUST be the COMPLETE claim text or a COMPLETE SENTENCE from it
- NEVER cut a quote mid-sentence or mid-word (e.g., "s docs" is WRONG)
- NEVER start a quote with a lowercase letter or partial word
- NEVER end a quote with "and it" or other incomplete phrases
- If a claim is too long, use a COMPLETE SENTENCE from it, not a fragment
- If you cannot fit a complete quote, OMIT it rather than truncate it
- Example of WRONG: "s docs, and the results blew my mind" (truncated start/end)
- Example of RIGHT: "I just fed GPT-4-32K nearly all of Pinecone's docs, and the results blew my mind!" (complete sentence)

Each quote MUST have:
- quote: COMPLETE text - full claim or complete sentence (NEVER truncate mid-word/mid-sentence)
- author: Full name from claims, or "Unknown" if not provided (NEVER empty string)
- sourceUrl: MUST match exactly from the claims provided
- verificationLevel: From the claim's verification level

=== infographicBrief VISUAL THINKING ===

title: Maximum 8 words, punchy, creates curiosity (e.g., "The Hidden Cost of X" not "Information About X")

keyPoints: 3-5 bullet points that:
- Stand alone without the post context
- Use parallel structure (all start same way: verbs, or nouns, or numbers)
- Are scannable - each under 15 words
- Build a logical progression or tell a mini-story

suggestedStyle:
- "minimal": Clean, simple, 1-2 key numbers or quotes (best for leadership/career topics)
- "data-heavy": Multiple statistics, charts implied (best for technical/research topics)
- "quote-focused": Central quote with supporting context (best for thought leadership)

colorScheme: Suggest colors that match the topic mood (professional blues for corporate, energetic oranges for innovation, etc.)

=== OUTPUT REQUIREMENTS ===

CRITICAL: The linkedinPost must be CLEAN, POLISHED, and READY TO PUBLISH.
- NO meta-commentary ("I should...", "Let me...", "I'm citing...")
- NO process explanations or method descriptions
- NO self-referential text - write AS the author, not ABOUT the authoring process
- The post should flow naturally as professional content, not as AI-generated explanation

1. LinkedIn Post (TARGET: 1500-2500 characters, max ${LINKEDIN_POST_MAX_LENGTH}):
   - Hook: 2-3 punchy lines that grab attention
   - Context: What's happening with numbered points if multiple factors
   - Section 1: ### header + bullets exploring implications
   - Section 2: ### header going deeper on the key challenge/opportunity
   - Takeaway: ### My takeaway with 2-3 synthesis sentences
   - CTA: Specific question inviting professional perspectives
   - Sources: "---" separator then "Sources:" with [1], [2] URLs matching in-text citations
   - Hashtags: At the very end

   CITATION EXAMPLE in post body: As McKinsey notes, "quote here" [1]
   SOURCES SECTION FORMAT (before hashtags):
   ---
   Sources:
   [1] https://mckinsey.com/...
   [2] https://cloudsecurityalliance.org/...

   USE RICH FORMATTING: ### headers, **bold** phrases, numbered lists, bullet points
   SHORT POSTS ARE REJECTED - aim for depth and substance
   CITATIONS ARE REQUIRED - every key quote must have [N] reference with URL in Sources section

2. keyQuotes Array (2-4 quotes):
   - Each with: quote, author, sourceUrl, verificationLevel
   - sourceUrl MUST match exactly from claims above
   - author: Use "Unknown" if not available (never empty string)

3. infographicBrief:
   - title: Max 8 words, catchy
   - keyPoints: 3-5 scannable bullets
   - suggestedStyle: "minimal", "data-heavy", or "quote-focused"
   - colorScheme: Mood-appropriate colors

4. factCheckSummary:
   - totalSourcesUsed: Unique sources referenced
   - verifiedQuotes: Quotes with verified sources
   - unverifiedClaims: Should be 0
   - primarySources: PRIMARY_SOURCE claims used
   - warnings: Any caveats (empty array if none)

${DELIMITERS.INSTRUCTIONS_END}

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

CRITICAL: Every quote in keyQuotes MUST have a valid sourceUrl from the claims provided. Never invent sources.`;

  return prompt;
}

// ============================================
// Multi-Post Prompt Building (Section 17.5)
// ============================================

/**
 * Build instructions for "variations" mode - distinct posts with different angles.
 */
function buildVariationsInstructions(postCount: number): string {
  return `=== VARIATIONS MODE ===
Generate ${postCount} DISTINCT posts with DIFFERENT angles:

CRITICAL RULES:
- Each post MUST use a DIFFERENT opening hook
- Do NOT repeat any key quotes across posts
- Distribute claims to maximize variety
- Each post stands alone

Post 1: Lead with surprising statistic
Post 2: Lead with provocative question
Post 3: Lead with expert insight`;
}

/**
 * Build instructions for "series" mode - connected multi-part content.
 */
function buildSeriesInstructions(postCount: number): string {
  return `=== SERIES MODE ===
Generate a ${postCount}-PART CONNECTED SERIES:

CRITICAL RULES:
- Part 1: Introduction - hook reader, set up the topic
- Part 2: Deep dive - main insights and analysis
- Part 3: Conclusions - takeaways and call to action
- Each post MUST start with "Part N/${postCount}: [Title]"
- Parts 1-2 end with teaser for next part
- Include seriesTitle field for all posts`;
}

/**
 * Build a multi-post synthesis prompt for GPT.
 *
 * Creates a prompt that generates multiple LinkedIn posts in one request,
 * either as variations (different angles) or series (connected parts).
 *
 * @param claims - Array of grounded claims to use
 * @param userPrompt - The user's original topic/prompt
 * @param postCount - Number of posts to generate (1-3)
 * @param postStyle - 'variations' for A/B testing, 'series' for connected content
 * @returns Complete multi-post prompt string ready to send to GPT
 * @throws Error if inputs are invalid
 */
export function buildMultiPostPrompt(
  claims: GroundedClaim[],
  userPrompt: string,
  postCount: number,
  postStyle: PostStyle
): string {
  // Validate inputs
  if (!userPrompt || userPrompt.trim().length < MIN_USER_PROMPT_LENGTH) {
    throw new Error(`FATAL: User prompt too short`);
  }

  const sanitizedUserPrompt = sanitizePromptContent(userPrompt, MAX_CLAIM_LENGTH);
  const formattedClaims = formatClaimsForPrompt(claims);

  const styleInstructions =
    postStyle === 'series'
      ? buildSeriesInstructions(postCount)
      : buildVariationsInstructions(postCount);

  return `Generate ${postCount} LinkedIn posts about the following topic.

${DELIMITERS.USER_PROMPT_START}
${sanitizedUserPrompt}
${DELIMITERS.USER_PROMPT_END}

USE ONLY the following verified claims. Do NOT invent facts, quotes, or statistics.

${DELIMITERS.CLAIMS_START}
${formattedClaims}
${DELIMITERS.CLAIMS_END}

${styleInstructions}

${DELIMITERS.INSTRUCTIONS_START}
Each post MUST:
- Be under ${LINKEDIN_POST_MAX_LENGTH} characters
- Have ${LINKEDIN_HASHTAGS_MIN}-${LINKEDIN_HASHTAGS_MAX} hashtags
- Include source citations for quotes
- Be professional but engaging

CRITICAL QUOTE RULES - NEVER TRUNCATE:
- Quotes MUST be COMPLETE sentences, never cut mid-word or mid-sentence
- NEVER start a quote with a lowercase letter or partial word (e.g., "s docs" is WRONG)
- NEVER end a quote with incomplete phrases like "and it" or "but the"
- If a claim is too long, use a COMPLETE SENTENCE from it, not a fragment
- If you cannot fit a complete quote, OMIT it rather than truncate it

Return ONLY valid JSON:
{
  "posts": [
    {
      "postNumber": 1,
      "totalPosts": ${postCount},
      "linkedinPost": "Post content here...",
      "keyQuotes": [{"quote": "...", "author": "...", "sourceUrl": "...", "verificationLevel": "..."}],
      "infographicBrief": {"title": "...", "keyPoints": [...], "suggestedStyle": "minimal", "colorScheme": "..."}${postStyle === 'series' ? ',\n      "seriesTitle": "Series Title Here"' : ''}
    }
  ],
  "factCheckSummary": {
    "totalSourcesUsed": 0,
    "verifiedQuotes": 0,
    "unverifiedClaims": 0,
    "primarySources": 0,
    "warnings": []
  }
}
${DELIMITERS.INSTRUCTIONS_END}`;
}

// ============================================
// Multi-Post Response Parsing (Section 17.5)
// ============================================

/**
 * Parse GPT's multi-post response into validated data.
 *
 * @param response - Raw text response from GPT API
 * @returns Validated GPTMultiPostResponse
 * @throws SchemaValidationError if validation fails
 */
export function parseMultiPostResponse(response: string): GPTMultiPostResponse {
  const rawParsed = parseModelResponse<unknown>(response);

  const result = GPTMultiPostResponseSchema.safeParse(rawParsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new SchemaValidationError(
      `Multi-post schema validation failed: ${errors}`,
      result.error
    );
  }

  return result.data;
}

/**
 * Parse multi-post response with retry on fixable errors.
 *
 * @param content - Raw GPT response content
 * @param originalPrompt - Original prompt for context in retry
 * @returns Validated GPTMultiPostResponse
 * @throws Error with FATAL prefix if parsing fails
 */
async function parseMultiPostWithRetry(
  content: string,
  originalPrompt: string
): Promise<GPTMultiPostResponse> {
  try {
    return parseMultiPostResponse(content);
  } catch (parseError) {
    if (!isFixableParseError(parseError)) {
      throw new Error(
        `FATAL: Multi-post parse failed - ${sanitizeErrorMessage(parseError instanceof Error ? parseError.message : String(parseError))}`
      );
    }
    logWarning('Multi-post parse failed, attempting fix...');
    // For now, throw - can enhance retry logic later if needed
    throw parseError;
  }
}

/**
 * Convert multi-post GPT response to SynthesisResult format.
 *
 * Maps the multi-post structure to the existing SynthesisResult schema,
 * using the first post as the primary post while including all posts
 * in the posts array.
 *
 * @param multiPost - Validated multi-post response from GPT
 * @param prompt - Original user prompt
 * @param config - Pipeline configuration
 * @returns SynthesisResult with posts array populated
 */
function convertMultiPostToSynthesisResult(
  multiPost: GPTMultiPostResponse,
  prompt: string,
  config: PipelineConfig
): SynthesisResult {
  const firstPost = multiPost.posts[0];

  // Combine all keyQuotes from all posts (deduplicated by quote text)
  const allQuotes = multiPost.posts.flatMap((p) => p.keyQuotes);
  const uniqueQuotes = allQuotes.filter(
    (q, i, arr) => arr.findIndex((x) => x.quote === q.quote) === i
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    prompt,
    postStyle: config.postStyle,
    posts: multiPost.posts as LinkedInPost[],
    linkedinPost: firstPost.linkedinPost,
    keyQuotes: uniqueQuotes,
    infographicBrief: firstPost.infographicBrief,
    factCheckSummary: multiPost.factCheckSummary,
    metadata: {
      sourcesUsed: multiPost.factCheckSummary.totalSourcesUsed,
      processingTimeMs: 0, // Will be set by caller
      estimatedCost: createEmptyCostBreakdown(),
    },
  };
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

    // Detect truncated quotes - quotes should not start with lowercase or partial words
    const quoteText = quote.quote.trim();

    // Check for quotes starting with lowercase (likely truncated mid-sentence)
    if (quoteText.length > 0 && /^[a-z]/.test(quoteText)) {
      logWarning(
        `Quote appears truncated (starts with lowercase): "${quoteText.substring(0, 60)}..." - ` +
        `This may indicate GPT cut the quote mid-sentence. Consider regenerating.`
      );
    }

    // Check for quotes ending abruptly (common truncation patterns)
    const truncationEndings = [' and it', ' and the', ' but it', ' but the', ' that it', ' which'];
    for (const ending of truncationEndings) {
      if (quoteText.toLowerCase().endsWith(ending)) {
        logWarning(
          `Quote appears truncated (ends with "${ending}"): "...${quoteText.substring(quoteText.length - 60)}" - ` +
          `This may indicate GPT cut the quote mid-sentence.`
        );
        break;
      }
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
  config: PipelineConfig
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

  // Check if multi-post mode (Section 17.5)
  const isMultiPost = config.postCount > 1;

  logVerbose(
    `Synthesizing from ${claims.length} grounded claims` +
      (isMultiPost ? ` (${config.postCount} posts, ${config.postStyle} mode)` : '')
  );

  // 2. Build appropriate prompt based on mode
  const synthesisPrompt = isMultiPost
    ? buildMultiPostPrompt(claims, prompt, config.postCount, config.postStyle)
    : buildSynthesisPrompt(claims, prompt);

  // 3. Call GPT with retry (throws on failure - FATAL)
  let gptResponse: GPTResponse;
  try {
    gptResponse = await makeGPTRequest(synthesisPrompt, {
      operationName: isMultiPost ? 'GPT multi-post synthesis' : 'GPT synthesis',
      reasoningEffort: 'medium',
      // Increase max tokens for multi-post to accommodate larger response
      maxTokens: isMultiPost ? MAX_TOKENS * 2 : MAX_TOKENS,
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

  // 4. Parse response based on mode
  let parsedResult: SynthesisResult;
  if (isMultiPost) {
    const multiPostResult = await parseMultiPostWithRetry(
      gptResponse.content,
      synthesisPrompt
    );
    parsedResult = convertMultiPostToSynthesisResult(multiPostResult, prompt, config);
  } else {
    parsedResult = await parseWithRetry(gptResponse.content, synthesisPrompt);
  }

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

  const postInfo = isMultiPost
    ? `${finalResult.posts?.length ?? 1} posts (${finalResult.linkedinPost.length} chars primary)`
    : `${finalResult.linkedinPost.length} chars`;

  logVerbose(
    `Synthesis complete: ${postInfo}, ` +
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
// SynthesizerFn Adapter (CRIT-5/CRIT-6 Fix)
// ============================================

/**
 * Synthesize LinkedIn post using GPT-5.2 (SynthesizerFn interface).
 *
 * This is the standardized interface that all synthesizers implement.
 * Wraps the internal `synthesize()` function with the correct signature.
 *
 * @param prompt - The user's original topic/prompt
 * @param claims - Array of grounded claims with source URLs
 * @param options - Synthesis options (postCount, postStyle, etc.)
 * @returns Promise resolving to SynthesisResult
 */
export const synthesizeWithGPT: SynthesizerFn = async (
  prompt: string,
  claims: GroundedClaim[],
  options: SynthesisOptions
): Promise<SynthesisResult> => {
  // Build PipelineConfig from SynthesisOptions
  const config: PipelineConfig = {
    ...DEFAULT_CONFIG,
    postCount: options.postCount,
    postStyle: options.postStyle,
    verbose: options.verbose ?? false,
    timeoutSeconds: options.timeoutMs ? Math.floor(options.timeoutMs / 1000) : DEFAULT_CONFIG.timeoutSeconds,
  };

  // Call internal synthesize with correct argument order
  return synthesize(claims, prompt, config);
};

// ============================================
// Exports
// ============================================

export {
  GPT_MODEL,
  REASONING_EFFORT,
  MAX_TOKENS,
  TEMPERATURE,
};
