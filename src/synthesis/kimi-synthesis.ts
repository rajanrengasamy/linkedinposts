/**
 * Kimi K2 Synthesis via OpenRouter
 *
 * Implements LinkedIn post synthesis using Kimi K2 Thinking model.
 * Deep reasoning option, cost-effective via OpenRouter.
 *
 * Pattern follows: src/refinement/kimi.ts
 *
 * KIMI K2 Thinking features:
 * - 1T total params, 32B active per forward pass
 * - 256k context window with extended reasoning
 * - Strong performance on reasoning and content generation
 *
 * @see https://openrouter.ai/moonshotai/kimi-k2-thinking
 * @see docs/PRD-v2.md Section 15
 */

import axios, { AxiosError } from 'axios';
import { getApiKey } from '../config.js';
import { withRetry, CRITICAL_RETRY_OPTIONS, TimeoutError } from '../utils/retry.js';
import { createSafeError, sanitizeErrorMessage } from '../utils/sanitization.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';
import { STAGE_TIMEOUT_MS } from '../types/index.js';
import {
  SCHEMA_VERSION,
  SynthesisResultSchema,
  GPTSynthesisResponseSchema,
  GPTMultiPostResponseSchema,
  createEmptyCostBreakdown,
  SchemaValidationError,
  parseModelResponse,
  type SynthesisResult,
  type GPTMultiPostResponse,
  type LinkedInPost,
} from '../schemas/index.js';
import type { SynthesizerFn, SynthesisOptions } from './types.js';
import type { GroundedClaim } from './claims.js';
import {
  SYSTEM_PROMPT,
  buildSynthesisPrompt,
  buildMultiPostPrompt,
  validateOutputConstraints,
} from './prompts.js';

// ============================================
// Constants
// ============================================

/**
 * OpenRouter API endpoint
 */
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * KIMI K2 Thinking model ID.
 * Extended reasoning model with 256k context window.
 * @see https://openrouter.ai/moonshotai/kimi-k2-thinking
 */
const KIMI_MODEL = 'moonshotai/kimi-k2-thinking';

/**
 * Maximum tokens for response.
 * Kimi K2 supports large context.
 */
const MAX_TOKENS = 16384;

/**
 * HTTP headers required by OpenRouter
 */
const OPENROUTER_HEADERS = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://github.com/linkedin-quotes-cli',
  'X-Title': 'LinkedIn Quotes CLI',
} as const;

/**
 * Pricing for Kimi K2 via OpenRouter (used for cost tracking)
 * Rates are per million tokens
 * @see https://openrouter.ai/moonshotai/kimi-k2-thinking
 */
export const KIMI_SYNTHESIS_PRICING = {
  inputPerMillion: 0.6,   // $0.60/1M input tokens
  outputPerMillion: 2.4,  // $2.40/1M output tokens
};

// ============================================
// Types
// ============================================

/**
 * OpenRouter chat completion request body
 */
interface OpenRouterRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  max_tokens?: number;
  reasoning?: { effort: 'high' | 'medium' | 'low' | 'minimal' | 'none' };
}

/**
 * OpenRouter chat completion response
 */
interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
      reasoning_details?: Array<{
        type: string;
        content: string;
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================
// API Key Validation
// ============================================

/**
 * Get OpenRouter API key from environment.
 *
 * @returns API key string
 * @throws Error if OPENROUTER_API_KEY is not set
 */
function getOpenRouterApiKey(): string {
  const apiKey = getApiKey('OPENROUTER_API_KEY');
  if (!apiKey) {
    // CRIT-3: FATAL prefix for critical configuration errors
    throw new Error(
      'FATAL: OPENROUTER_API_KEY is required for Kimi synthesis. ' +
        'Please set it in your .env file or environment.'
    );
  }
  return apiKey;
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse single-post synthesis response from Kimi.
 *
 * @param responseText - Raw text response from Kimi
 * @returns Parsed SynthesisResult
 * @throws SchemaValidationError if validation fails
 */
function parseKimiSynthesisResponse(responseText: string): SynthesisResult {
  // Parse JSON from response (handles code fences, etc.)
  const rawParsed = parseModelResponse<unknown>(responseText);

  // Validate against partial schema (response fields only)
  const validationResult = GPTSynthesisResponseSchema.safeParse(rawParsed);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new SchemaValidationError(
      `Kimi synthesis response schema validation failed: ${errorMessages}`,
      validationResult.error
    );
  }
  const parsed = validationResult.data;

  // Build full SynthesisResult with placeholder metadata
  const result: SynthesisResult = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    prompt: '[PENDING]', // Will be set by caller
    linkedinPost: parsed.linkedinPost,
    keyQuotes: parsed.keyQuotes,
    infographicBrief: parsed.infographicBrief,
    factCheckSummary: parsed.factCheckSummary,
    metadata: {
      sourcesUsed: parsed.factCheckSummary.totalSourcesUsed,
      processingTimeMs: 0, // Will be set by caller
      estimatedCost: createEmptyCostBreakdown(),
    },
  };

  return result;
}

/**
 * Parse multi-post synthesis response from Kimi.
 *
 * @param responseText - Raw text response from Kimi
 * @returns Parsed GPTMultiPostResponse
 * @throws SchemaValidationError if validation fails
 */
function parseKimiMultiPostResponse(responseText: string): GPTMultiPostResponse {
  const rawParsed = parseModelResponse<unknown>(responseText);

  const result = GPTMultiPostResponseSchema.safeParse(rawParsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new SchemaValidationError(
      `Kimi multi-post schema validation failed: ${errors}`,
      result.error
    );
  }

  return result.data;
}

/**
 * Convert multi-post response to SynthesisResult format.
 */
function convertMultiPostToSynthesisResult(
  multiPost: GPTMultiPostResponse,
  prompt: string,
  options: SynthesisOptions
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
    postStyle: options.postStyle,
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

/**
 * Extract error message from axios error response.
 * MAJ-7: Carefully extracts only safe error information to prevent API key exposure.
 * Only reads from response.data (server response), never from request config.
 */
function extractAxiosErrorMessage(error: AxiosError): string {
  // Only extract from response data (server-provided error messages)
  // Never access error.config which contains the Authorization header
  if (error.response?.data) {
    const data = error.response.data as Record<string, unknown>;
    if (typeof data.error === 'object' && data.error !== null) {
      const errObj = data.error as Record<string, unknown>;
      if (typeof errObj.message === 'string') {
        // Sanitize even server messages in case they echo back headers
        return sanitizeErrorMessage(errObj.message);
      }
    }
    if (typeof data.message === 'string') {
      return sanitizeErrorMessage(data.message);
    }
  }
  // For the base error.message, sanitize to remove any sensitive data
  // that might have been included (e.g., in network error messages)
  return sanitizeErrorMessage(error.message);
}

/**
 * Calculate cost for Kimi synthesis request.
 *
 * @param usage - Token usage from response
 * @returns Estimated cost in USD
 */
export function calculateKimiSynthesisCost(usage: { prompt_tokens: number; completion_tokens: number }): number {
  const inputCost = (usage.prompt_tokens / 1_000_000) * KIMI_SYNTHESIS_PRICING.inputPerMillion;
  const outputCost = (usage.completion_tokens / 1_000_000) * KIMI_SYNTHESIS_PRICING.outputPerMillion;
  return inputCost + outputCost;
}

// ============================================
// Main Synthesizer
// ============================================

/**
 * Synthesize LinkedIn post using Kimi K2 via OpenRouter.
 *
 * Uses Kimi K2 Thinking with medium reasoning effort for balanced quality.
 *
 * Features:
 * - OpenRouter API integration
 * - Timeout enforcement with Promise.race pattern
 * - Retry with CRITICAL_RETRY_OPTIONS for resilience
 * - Error sanitization to prevent API key exposure
 * - Zod validation for structured response
 *
 * @param prompt - The user's original prompt/topic
 * @param claims - Array of grounded claims with source URLs
 * @param options - Synthesis options (postCount, postStyle, etc.)
 * @returns Promise resolving to validated SynthesisResult
 * @throws Error if API call fails after retries
 */
export const synthesizeWithKimi: SynthesizerFn = async (
  prompt: string,
  claims: GroundedClaim[],
  options: SynthesisOptions
): Promise<SynthesisResult> => {
  // CRIT-2: Validate claims are provided - cannot generate post without source material
  if (!claims || claims.length === 0) {
    throw new Error('FATAL: No claims provided - cannot generate post without verified source material');
  }

  const startTime = Date.now();
  const timeout = options.timeoutMs ?? STAGE_TIMEOUT_MS;
  const operationName = 'Kimi K2 synthesis';

  logInfo(`${operationName}: Generating post with ${claims.length} claims`);

  // Get API key (validates it exists)
  const apiKey = getOpenRouterApiKey();

  // Determine if multi-post mode
  const isMultiPost = options.postCount > 1;

  // Build appropriate prompt
  const synthesisPrompt = isMultiPost
    ? buildMultiPostPrompt(claims, prompt, options.postCount, options.postStyle)
    : buildSynthesisPrompt(claims, prompt);

  // Build request body
  const requestBody: OpenRouterRequest = {
    model: KIMI_MODEL,
    max_tokens: isMultiPost ? MAX_TOKENS * 2 : MAX_TOKENS,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: synthesisPrompt,
      },
    ],
    // Use medium reasoning effort for balanced quality/speed
    reasoning: { effort: 'medium' },
  };

  // Make API request with retry logic and timeout enforcement
  const result = await withRetry(
    async () => {
      // Create timeout promise for enforcement
      // MAJ-9: FATAL prefix on timeout errors
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TimeoutError(`FATAL: ${operationName} timed out after ${timeout}ms`, timeout)),
          timeout
        );
      });

      // Build the API request
      const apiPromise = axios.post<OpenRouterResponse>(OPENROUTER_API_URL, requestBody, {
        headers: {
          ...OPENROUTER_HEADERS,
          Authorization: `Bearer ${apiKey}`,
        },
        timeout,
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      // Extract content from response
      const content = response.data.choices?.[0]?.message?.content;

      if (!content || content.trim().length === 0) {
        throw new Error('Empty response received from Kimi via OpenRouter');
      }

      // Log token usage if available
      if (response.data.usage) {
        logVerbose(
          `${operationName}: Used ${response.data.usage.prompt_tokens} input + ` +
            `${response.data.usage.completion_tokens} output tokens`
        );
      }

      return {
        content: content.trim(),
        usage: response.data.usage,
      };
    },
    {
      ...CRITICAL_RETRY_OPTIONS,
      operationName,
      retryOn: (error: Error) => {
        // Retry on rate limits, server errors, network errors
        if (error instanceof AxiosError) {
          const status = error.response?.status;
          // Retry on 429 (rate limit), 5xx (server error), network errors
          if (status === 429 || (status && status >= 500)) {
            return true;
          }
          // Retry on network errors
          if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return true;
          }
        }
        // Retry on timeout
        if (error instanceof TimeoutError) {
          return true;
        }
        return false;
      },
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

  let { content, usage } = result.data;

  // MAJ-1: Parse response with retry logic
  // If parsing fails, retry the API call up to MAX_PARSE_RETRIES times
  const MAX_PARSE_RETRIES = 2;
  let parsedResult: SynthesisResult;
  let parseAttempt = 0;
  let lastParseError: Error | null = null;

  while (parseAttempt <= MAX_PARSE_RETRIES) {
    try {
      if (isMultiPost) {
        const multiPostResult = parseKimiMultiPostResponse(content);
        parsedResult = convertMultiPostToSynthesisResult(multiPostResult, prompt, options);
      } else {
        parsedResult = parseKimiSynthesisResponse(content);
      }
      // Parse succeeded, break out of retry loop
      break;
    } catch (parseError) {
      lastParseError = parseError as Error;
      parseAttempt++;

      if (parseAttempt > MAX_PARSE_RETRIES) {
        // All parse retries exhausted
        logWarning(
          `${operationName}: Parse failed after ${parseAttempt} attempts: ${lastParseError.message}`
        );
        throw new Error(
          `FATAL: ${operationName} - response parsing failed after ${parseAttempt} attempts: ${lastParseError.message}`
        );
      }

      // Log retry attempt and re-request from API
      logWarning(
        `${operationName}: Parse attempt ${parseAttempt} failed, retrying API call...`
      );

      // Re-fetch from API for a fresh response
      const retryResult = await withRetry(
        async () => {
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new TimeoutError(`FATAL: ${operationName} timed out after ${timeout}ms`, timeout)),
              timeout
            );
          });

          const apiPromise = axios.post<OpenRouterResponse>(OPENROUTER_API_URL, requestBody, {
            headers: {
              ...OPENROUTER_HEADERS,
              Authorization: `Bearer ${apiKey}`,
            },
            timeout,
          });

          const response = await Promise.race([apiPromise, timeoutPromise]);
          const respContent = response.data.choices?.[0]?.message?.content;

          if (!respContent || respContent.trim().length === 0) {
            throw new Error('Empty response received from Kimi via OpenRouter');
          }

          return {
            content: respContent.trim(),
            usage: response.data.usage,
          };
        },
        {
          ...CRITICAL_RETRY_OPTIONS,
          operationName: `${operationName} (parse retry ${parseAttempt})`,
        }
      );

      if (!retryResult.success) {
        const failedResult = retryResult as { success: false; error: Error; attempts: number };
        throw new Error(
          `FATAL: ${operationName} - API retry failed during parse recovery: ${failedResult.error.message}`
        );
      }

      // Update content and usage for next parse attempt
      content = retryResult.data.content;
      usage = retryResult.data.usage;
    }
  }

  // TypeScript needs this assertion since it can't track the while loop logic
  parsedResult = parsedResult!;

  // Calculate processing time and cost
  const processingTimeMs = Date.now() - startTime;
  const kimiCost = usage ? calculateKimiSynthesisCost(usage) : 0;

  // Build final result with metadata
  // Note: Kimi costs are tracked under 'openai' field (generic LLM costs)
  // since CostBreakdown doesn't have a dedicated OpenRouter field
  const finalResult: SynthesisResult = {
    ...parsedResult,
    prompt, // Set the original user prompt
    metadata: {
      ...parsedResult.metadata,
      processingTimeMs,
      sourcesUsed: new Set(claims.map(c => c.sourceUrl)).size,
      estimatedCost: {
        ...parsedResult.metadata.estimatedCost,
        openai: kimiCost, // Kimi via OpenRouter costs tracked here
        total: kimiCost,
      },
    },
  };

  // Validate against full schema
  const validated = SynthesisResultSchema.parse(finalResult);

  // Validate output constraints (post length, hashtags, sourceUrls)
  const allowedSourceUrls = new Set(claims.map(c => c.sourceUrl));
  validateOutputConstraints(validated, allowedSourceUrls);

  const postInfo = isMultiPost
    ? `${validated.posts?.length ?? 1} posts (${validated.linkedinPost.length} chars primary)`
    : `${validated.linkedinPost.length} chars`;

  logVerbose(
    `${operationName}: Complete - ${postInfo}, ` +
      `${validated.keyQuotes.length} quotes, ` +
      `${processingTimeMs}ms`
  );

  return validated;
};
