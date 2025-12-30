/**
 * OpenRouter KIMI 2 Scoring Engine
 *
 * Alternative scoring implementation using OpenRouter's KIMI K2 Thinking model.
 * Provides the same interface as Gemini scoring for easy swapping.
 *
 * KIMI K2 Thinking features:
 * - 1T total params, 32B active per forward pass
 * - 256k context window with extended reasoning
 * - Strong performance on code, reasoning, and tool-use benchmarks
 *
 * @see https://openrouter.ai/moonshotai/kimi-k2-thinking
 */

import axios, { AxiosError } from 'axios';
import { getApiKey } from '../config.js';
import { withRetry, CRITICAL_RETRY_OPTIONS, TimeoutError } from '../utils/retry.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import { STAGE_TIMEOUT_MS, type PipelineConfig } from '../types/index.js';
import type { ValidatedItem } from '../schemas/validatedItem.js';
import {
  parseAndValidate,
  retryWithFixPrompt,
  type ParseRetryResult,
  type ScoredItem,
} from '../schemas/index.js';
import { fallbackScore } from './fallback.js';
import {
  buildScoringPrompt,
  GeminiScoreResponseSchema,
  processScoredItems,
  type GeminiScoreResponse,
} from './gemini.js';

// ============================================
// OpenRouter API Configuration
// ============================================

/** OpenRouter API endpoint */
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * KIMI K2 Thinking model ID.
 * Extended reasoning model with 256k context window.
 * @see https://openrouter.ai/moonshotai/kimi-k2-thinking
 */
const KIMI_MODEL = 'moonshotai/kimi-k2-thinking';

/** Maximum prompt length to prevent excessive API costs */
const MAX_PROMPT_LENGTH = 100000;

/** HTTP headers required by OpenRouter */
const OPENROUTER_HEADERS = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://github.com/linkedin-quotes-cli',
  'X-Title': 'LinkedIn Quotes CLI',
} as const;

// ============================================
// Types
// ============================================

/**
 * Options for OpenRouter scoring requests
 */
export interface OpenRouterScoringOptions {
  /** Request timeout in milliseconds (default: STAGE_TIMEOUT_MS) */
  timeoutMs?: number;
  /** Operation name for logging */
  operationName?: string;
}

/**
 * OpenRouter chat completion request body
 */
interface OpenRouterRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
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
// Error Handling
// ============================================

/**
 * Patterns that indicate sensitive data in error messages.
 */
const SENSITIVE_ERROR_PATTERNS = [
  /sk-or-v1-[a-zA-Z0-9]{48,}/gi, // OpenRouter API keys
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
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized;
}

/**
 * Create a sanitized error without exposing sensitive data.
 *
 * @param operationName - Name of the operation for context
 * @param originalError - The original error (may contain sensitive data)
 * @returns A new, sanitized Error object safe for logging/throwing
 */
function createSanitizedError(operationName: string, originalError: unknown): Error {
  let message: string;
  if (originalError instanceof Error) {
    message = sanitizeString(originalError.message);
  } else {
    message = sanitizeString(String(originalError));
  }

  const safeError = new Error(`${operationName} failed: ${message}`);

  if (originalError instanceof TimeoutError) {
    safeError.name = 'TimeoutError';
  }

  return safeError;
}

/**
 * Extract error message from axios error response
 */
function extractAxiosErrorMessage(error: AxiosError): string {
  if (error.response?.data) {
    const data = error.response.data as Record<string, unknown>;
    if (typeof data.error === 'object' && data.error !== null) {
      const errObj = data.error as Record<string, unknown>;
      if (typeof errObj.message === 'string') {
        return errObj.message;
      }
    }
    if (typeof data.message === 'string') {
      return data.message;
    }
  }
  return error.message;
}

// ============================================
// Client Initialization
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
    throw new Error(
      'OPENROUTER_API_KEY is required for KIMI 2 scoring. ' +
        'Please set it in your .env file or environment.'
    );
  }
  return apiKey;
}

// ============================================
// Main API Request Function
// ============================================

/**
 * Make a request to OpenRouter API for scoring.
 *
 * Sends a prompt to KIMI K2 Thinking with reasoning enabled and returns
 * the text response. Uses retry logic with exponential backoff.
 *
 * @param prompt - The scoring prompt to send
 * @param options - Optional request configuration
 * @returns Promise resolving to the text response
 * @throws Error if API key is missing, prompt is too long, or all retries fail
 */
export async function makeOpenRouterRequest(
  prompt: string,
  options?: OpenRouterScoringOptions
): Promise<string> {
  const { timeoutMs = STAGE_TIMEOUT_MS, operationName = 'OpenRouter KIMI 2 scoring request' } =
    options ?? {};

  // Validate prompt length
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `Prompt exceeds maximum length (${prompt.length} > ${MAX_PROMPT_LENGTH}). ` +
        'Consider reducing batch size or content length.'
    );
  }

  logVerbose(`${operationName}: Sending request (${prompt.length} chars)`);

  // Get API key
  const apiKey = getOpenRouterApiKey();

  // Build request body
  const requestBody: OpenRouterRequest = {
    model: KIMI_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are a content scoring assistant. Always respond with valid JSON only. ' +
          'Do not include any explanatory text outside the JSON structure.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    reasoning: { effort: 'high' }, // Enable extended thinking for better analysis
  };

  // Make API request with retry logic
  const result = await withRetry(
    async () => {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TimeoutError(`OpenRouter request timed out after ${timeoutMs}ms`, timeoutMs)),
          timeoutMs
        );
      });

      const apiPromise = axios.post<OpenRouterResponse>(OPENROUTER_API_URL, requestBody, {
        headers: {
          ...OPENROUTER_HEADERS,
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: timeoutMs,
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      // Extract content from response
      const content = response.data.choices?.[0]?.message?.content;

      if (!content || content.trim().length === 0) {
        throw new Error('Empty response received from OpenRouter API');
      }

      // Log token usage if available
      if (response.data.usage) {
        logVerbose(
          `${operationName}: Used ${response.data.usage.prompt_tokens} input + ` +
            `${response.data.usage.completion_tokens} output tokens`
        );
      }

      return content;
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
// Response Parsing
// ============================================

/**
 * Parse OpenRouter's scoring response text into validated data.
 * Reuses the same schema as Gemini for compatibility.
 *
 * @param responseText - Raw text response from OpenRouter API
 * @returns ParseResult with validated GeminiScoreResponse or error message
 */
export function parseOpenRouterScoringResponse(
  responseText: string
): ReturnType<typeof parseAndValidate<GeminiScoreResponse>> {
  return parseAndValidate(GeminiScoreResponseSchema, responseText);
}

// ============================================
// Fix Prompt Retry Helper
// ============================================

/**
 * Attempt to fix a failed response using a retry prompt.
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
      return await makeOpenRouterRequest(fixPrompt, {
        operationName: 'OpenRouter KIMI 2 scoring fix retry',
      });
    },
    GeminiScoreResponseSchema,
    originalResponse,
    originalPrompt
  );
}

// ============================================
// Main Orchestrator
// ============================================

/**
 * Score validated items using OpenRouter's KIMI K2 Thinking model.
 *
 * This function has the same signature as scoreItems in gemini.ts,
 * allowing it to be used as a drop-in replacement.
 *
 * Process:
 * 1. Skip Check: If config.skipScoring, use fallback heuristics
 * 2. Batching: Split items into batches of config.scoringBatchSize
 * 3. Sequential Processing: Process batches one at a time
 * 4. Per-Batch Flow:
 *    a. Build prompt with buildScoringPrompt()
 *    b. Call makeOpenRouterRequest() with retry logic
 *    c. Parse response with parseOpenRouterScoringResponse()
 *    d. On parse failure: attempt fix with retryWithFixPrompt()
 *    e. On complete failure: use fallbackScore() for this batch
 *    f. Process scores with processScoredItems()
 * 5. Final Processing: Merge, re-sort, re-rank all items
 *
 * @param items - Validated items to score
 * @param userPrompt - Original user prompt for relevance scoring
 * @param config - Pipeline configuration
 * @returns Scored items sorted by overall score, with ranks assigned
 */
export async function scoreItemsWithKimi2(
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
  logVerbose(`Scoring ${items.length} items in ${totalBatches} batch(es) with KIMI K2 Thinking`);

  const allScoredItems: ScoredItem[] = [];
  let successfulBatches = 0;

  // 3. Process batches sequentially
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchNum = batchIndex + 1;

    logVerbose(`Scoring batch ${batchNum}/${totalBatches} with KIMI K2...`);

    try {
      // 4a. Build prompt (reuse from gemini.ts)
      const prompt = buildScoringPrompt(batch, userPrompt);

      // 4b. Call OpenRouter with retry
      const responseText = await makeOpenRouterRequest(prompt, {
        operationName: `OpenRouter KIMI 2 scoring batch ${batchNum}`,
      });

      // 4c. Parse response
      const parseResult = parseOpenRouterScoringResponse(responseText);

      let scores: GeminiScoreResponse;

      if (parseResult.success) {
        scores = parseResult.data;
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

        scores = fixResult.data;
        logVerbose(`Batch ${batchNum} fixed successfully (retried: ${fixResult.retried})`);
      }

      // 4f. Process scores (reuse from gemini.ts)
      const batchScoredItems = processScoredItems(batch, scores);
      allScoredItems.push(...batchScoredItems);
      successfulBatches++;
    } catch (error) {
      // API error - use fallback for entire batch
      const errorMessage = error instanceof Error ? error.message : String(error);
      logWarning(`Batch ${batchNum} KIMI 2 error: ${errorMessage}, using fallback`);

      const fallbackItems = fallbackScore(batch);
      allScoredItems.push(...fallbackItems);
    }
  }

  // Log summary
  if (successfulBatches === 0) {
    logWarning('All batches used fallback scoring');
  } else if (successfulBatches < totalBatches) {
    logVerbose(`${successfulBatches}/${totalBatches} batches scored with KIMI K2`);
  } else {
    logVerbose(`All ${totalBatches} batches scored successfully with KIMI K2`);
  }

  // Handle case where all processing failed
  if (allScoredItems.length === 0) {
    logWarning('No items were scored, returning empty result');
    return [];
  }

  // 5. Final processing: re-sort and re-rank all items together
  allScoredItems.sort((a, b) => b.scores.overall - a.scores.overall);

  // Truncate to top N items (PRD specifies N=50)
  const topN = config.topScored ?? 50;
  const topItems = allScoredItems.slice(0, topN);

  // Re-rank only the top items (1-indexed)
  topItems.forEach((item, index) => {
    item.rank = index + 1;
  });

  logVerbose(
    `Returning top ${topItems.length} of ${allScoredItems.length} scored items, ` +
      `top score: ${topItems[0]?.scores.overall ?? 'N/A'}`
  );

  return topItems;
}

// ============================================
// Exports
// ============================================

export { KIMI_MODEL, OPENROUTER_API_URL };
