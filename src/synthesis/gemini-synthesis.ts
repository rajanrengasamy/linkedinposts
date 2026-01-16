/**
 * Gemini Synthesis
 *
 * Implements LinkedIn post synthesis using Gemini 3 Flash.
 * Fast, cost-effective option for synthesis.
 *
 * This module provides:
 * - LinkedIn post generation using Gemini 3 Flash with thinking
 * - Multi-post generation (variations and series modes)
 * - Timeout and retry handling for resilience
 * - Token usage tracking for cost estimation
 *
 * @see docs/PRD-v2.md Section 15
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getApiKey, getCLITimeoutMs, getOpenCodeModel } from '../config.js';
import { withRetry, CRITICAL_RETRY_OPTIONS, TimeoutError } from '../utils/retry.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';
import { createSafeError, sanitizeErrorMessage } from '../utils/sanitization.js';
import { STAGE_TIMEOUT_MS } from '../types/index.js';
import type { SynthesisResult } from '../schemas/index.js';
import type { GroundedClaim } from './claims.js';
import type { PipelineConfig, PostStyle } from '../types/index.js';
import type { SynthesizerFn, SynthesisOptions } from './types.js';
import { routeLLMRequest } from '../llm/fallback-router.js';
import { getGeminiCLIClient } from '../llm/gemini-cli-wrapper.js';
import { getOpenCodeGoogleClient } from '../llm/opencode-wrapper.js';
import {
  SYSTEM_PROMPT,
  buildSynthesisPrompt,
  buildMultiPostPrompt,
  parseSynthesisResponse,
  parseMultiPostResponse,
  convertMultiPostToSynthesisResult,
  validateOutputConstraints,
  parseWithRetry,
  MIN_USER_PROMPT_LENGTH,
} from './prompts.js';

// ============================================
// Constants
// ============================================

/**
 * Gemini model for synthesis.
 * Using Gemini 3 Flash for balance of speed and quality.
 * @see https://ai.google.dev/gemini-api/docs/gemini-3
 */
const GEMINI_MODEL = 'gemini-3-flash-preview';

/**
 * Thinking level for Gemini 3 Flash synthesis.
 * HIGH for thorough reasoning during content generation.
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */
const THINKING_LEVEL = ThinkingLevel.HIGH;

/**
 * Pricing for Gemini 3 Flash (used for cost tracking)
 * Rates are per million tokens
 * @see https://ai.google.dev/gemini-api/docs/pricing
 */
export const GEMINI_SYNTHESIS_PRICING = {
  inputPerMillion: 0.10,   // $0.10/1M input tokens
  outputPerMillion: 0.40,  // $0.40/1M output tokens (non-thinking)
};

// ============================================
// Types
// ============================================

/**
 * Options for Gemini synthesis configuration
 */
export interface GeminiSynthesisOptions {
  /** Request timeout in milliseconds (default: STAGE_TIMEOUT_MS) */
  timeoutMs?: number;

  /** Number of posts to generate (1-3, default: 1) */
  postCount?: number;

  /** Post style: 'variations' for A/B testing, 'series' for connected multi-part */
  postStyle?: PostStyle;

  /** Operation name for logging */
  operationName?: string;
}

/**
 * Response from Gemini synthesis including usage statistics
 */
export interface GeminiSynthesisResponse {
  /** The synthesis result with LinkedIn post(s) */
  result: SynthesisResult;

  /** Token usage for cost tracking (estimated) */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ============================================
// Raw Request Functions (for Fallback Router)
// ============================================

/**
 * Response structure for raw Gemini requests.
 * Contains just the text response, used by fallback router.
 */
interface GeminiRawResponse {
  text: string;
}

/**
 * Make raw Gemini request via Google GenAI API.
 *
 * This is the low-level API request used as Tier 3 (API fallback) in the router.
 *
 * @param fullPrompt - Complete prompt including system prompt
 * @param timeoutMs - Request timeout in milliseconds
 * @returns Promise resolving to raw text response
 * @throws Error if API key is missing or request fails
 */
async function makeGeminiRequestViaAPI(
  fullPrompt: string,
  timeoutMs: number
): Promise<GeminiRawResponse> {
  const operationName = 'Gemini API synthesis';

  // Get API key (validates it exists)
  const apiKey = getApiKey('GOOGLE_AI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'FATAL: GOOGLE_AI_API_KEY is required for Gemini synthesis. ' +
        'Please set it in your .env file or environment.'
    );
  }

  // Initialize Gemini client
  const client = new GoogleGenAI({ apiKey });

  // Make API request with retry logic and timeout enforcement
  const result = await withRetry(
    async () => {
      // Create timeout promise for enforcement
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TimeoutError(`FATAL: ${operationName} timed out after ${timeoutMs}ms`, timeoutMs)),
          timeoutMs
        );
      });

      // Build the API request with thinking config
      const apiPromise = client.models.generateContent({
        model: GEMINI_MODEL,
        contents: fullPrompt,
        config: {
          thinkingConfig: {
            thinkingLevel: THINKING_LEVEL,
          },
        },
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      // Extract text from response
      const text = response.text;
      if (!text || text.trim().length === 0) {
        throw new Error('FATAL: Empty response from Gemini synthesis');
      }

      return { text };
    },
    {
      ...CRITICAL_RETRY_OPTIONS,
      operationName,
    }
  );

  // Handle retry result
  if (!result.success) {
    logWarning(`${operationName}: Failed after ${result.attempts} attempts`);
    const safeError = createSafeError(
      `${operationName} (after ${result.attempts} attempts)`,
      result.error
    );
    throw safeError;
  }

  return result.data;
}

/**
 * Make Gemini request via Gemini CLI (Gemini Ultra subscription).
 *
 * Uses the Gemini CLI wrapper which provides a Google GenAI SDK-compatible
 * interface but routes through the CLI to use subscription authentication.
 *
 * @param fullPrompt - Complete prompt including system prompt
 * @param timeoutMs - Request timeout in milliseconds
 * @returns Promise resolving to raw text response
 * @throws CLIError if CLI is not available or request fails
 */
async function makeGeminiRequestViaCLI(
  fullPrompt: string,
  timeoutMs: number
): Promise<GeminiRawResponse> {
  const client = getGeminiCLIClient({
    model: GEMINI_MODEL,
    timeout: timeoutMs,
  });

  if (!client) {
    throw new Error('Gemini CLI not available');
  }

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: fullPrompt,
  });

  const text = response.text;
  if (!text || text.trim().length === 0) {
    throw new Error('FATAL: Empty response from Gemini CLI synthesis');
  }

  return { text };
}

/**
 * Make Gemini request via OpenCode CLI.
 *
 * Uses the OpenCode CLI wrapper which provides access to Google models
 * through OpenCode's subscription-based authentication via plugins.
 * This is the highest priority tier in the fallback chain.
 *
 * @param fullPrompt - Complete prompt including system prompt
 * @param timeoutMs - Request timeout in milliseconds
 * @returns Promise resolving to raw text response
 * @throws CLIError if CLI is not available or request fails
 */
async function makeGeminiRequestViaOpenCode(
  fullPrompt: string,
  timeoutMs: number
): Promise<GeminiRawResponse> {
  const client = getOpenCodeGoogleClient({
    model: getOpenCodeModel('gemini'),
    timeout: timeoutMs,
  });

  if (!client) {
    throw new Error('OpenCode CLI not available');
  }

  const response = await client.models.generateContent({
    model: getOpenCodeModel('gemini'),
    contents: fullPrompt,
  });

  const text = response.text;
  if (!text || text.trim().length === 0) {
    throw new Error('FATAL: Empty response from OpenCode Gemini synthesis');
  }

  return { text };
}

/**
 * Make Gemini request with fallback routing (OpenCode -> CLI -> API).
 *
 * Routes the request through the multi-tier fallback system:
 * - Tier 1: OpenCode CLI (if enabled and available)
 * - Tier 2: Gemini CLI (if enabled and available)
 * - Tier 3: Direct Google AI API (fallback, per-token billing)
 *
 * @param fullPrompt - Complete prompt including system prompt
 * @param timeoutMs - Request timeout in milliseconds
 * @returns Promise resolving to raw text response
 * @throws Error if all tiers fail
 */
async function makeGeminiRequestWithFallback(
  fullPrompt: string,
  timeoutMs: number
): Promise<GeminiRawResponse> {
  const cliTimeout = getCLITimeoutMs();
  const effectiveTimeout = Math.max(timeoutMs, cliTimeout);

  const result = await routeLLMRequest<GeminiRawResponse>(
    () => makeGeminiRequestViaAPI(fullPrompt, timeoutMs),           // Tier 3: API
    () => makeGeminiRequestViaCLI(fullPrompt, effectiveTimeout),    // Tier 2: CLI
    () => makeGeminiRequestViaOpenCode(fullPrompt, effectiveTimeout), // Tier 1: OpenCode
    { provider: 'gemini' }
  );

  logInfo(`Gemini synthesis routed via ${result.tier} (attempted: ${result.tiersAttempted.join(' -> ')})`);
  return result.result;
}

// ============================================
// Main Synthesizer
// ============================================

/**
 * Synthesize LinkedIn post using Gemini 3 Flash.
 *
 * Uses Gemini 3 Flash with HIGH thinking level to generate high-quality
 * LinkedIn posts from grounded claims. Supports both single post and
 * multi-post generation modes.
 *
 * Features:
 * - Gemini 3 Flash with thinking for quality reasoning
 * - Multi-tier fallback (OpenCode -> CLI -> API)
 * - Timeout enforcement with Promise.race pattern
 * - Retry with CRITICAL_RETRY_OPTIONS for resilience
 * - Error sanitization to prevent API key exposure
 * - Multi-post support (variations and series modes)
 *
 * Conforms to the SynthesizerFn interface for standardized synthesizer signatures.
 *
 * @param prompt - The user's original topic/prompt
 * @param claims - Array of grounded claims with source URLs
 * @param options - Synthesis configuration options (SynthesisOptions)
 * @returns Promise resolving to SynthesisResult with LinkedIn post
 * @throws Error if API key is missing or all retries fail
 *
 * @example
 * ```typescript
 * const claims = extractGroundedClaims(scoredItems);
 * const result = await synthesizeWithGemini('AI trends 2025', claims, {
 *   postCount: 1,
 *   postStyle: 'variations',
 * });
 * console.log(result.linkedinPost);
 * ```
 */
export const synthesizeWithGemini: SynthesizerFn = async (
  prompt: string,
  claims: GroundedClaim[],
  options: SynthesisOptions
): Promise<SynthesisResult> => {
  // CRIT-2: Validate claims are provided before proceeding
  if (!claims || claims.length === 0) {
    throw new Error('FATAL: No claims provided - cannot generate post without verified source material');
  }

  // MIN-5: Validate prompt meets minimum length requirement
  if (!prompt || prompt.trim().length < MIN_USER_PROMPT_LENGTH) {
    throw new Error(`FATAL: User prompt too short - minimum ${MIN_USER_PROMPT_LENGTH} characters required`);
  }

  const {
    timeoutMs = STAGE_TIMEOUT_MS,
    postCount,
    postStyle,
  } = options;
  const operationName = 'Gemini synthesis';

  logInfo(`${operationName}: Generating post with ${claims.length} claims`);

  // Build prompt based on post count
  const isMultiPost = postCount > 1;
  const synthesisPrompt = isMultiPost
    ? buildMultiPostPrompt(claims, prompt, postCount, postStyle)
    : buildSynthesisPrompt(claims, prompt);

  // Build full prompt with system prompt prepended
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${synthesisPrompt}`;

  // Estimate input tokens (rough estimate: ~4 chars per token)
  const estimatedInputTokens = Math.ceil(synthesisPrompt.length / 4);

  // Make request with fallback routing
  let rawResponse: GeminiRawResponse;
  try {
    rawResponse = await makeGeminiRequestWithFallback(fullPrompt, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('FATAL:')) {
      throw new Error(`FATAL: ${operationName} failed - ${sanitizeErrorMessage(message)}`);
    }
    throw error;
  }

  // Parse response based on mode
  // MAJ-1: Use parseWithRetry for single-post mode to enable retry on fixable errors
  // MAJ-2: Use sanitizeErrorMessage to prevent API key exposure in error messages
  let parsedResult: SynthesisResult;
  try {
    if (isMultiPost) {
      // Parse multi-post response, then convert to SynthesisResult
      const multiPost = parseMultiPostResponse(rawResponse.text);
      // Create minimal config for conversion
      const minimalConfig = { postStyle, postCount } as PipelineConfig;
      parsedResult = convertMultiPostToSynthesisResult(multiPost, prompt, minimalConfig);
    } else {
      // Use parseWithRetry which handles fixable vs unfixable errors
      parsedResult = await parseWithRetry(rawResponse.text);
      // Update with actual prompt (parser returns placeholder)
      parsedResult = { ...parsedResult, prompt };
    }
  } catch (parseError) {
    // MAJ-2: Sanitize error message to prevent API key/sensitive data exposure
    const rawMessage = parseError instanceof Error ? parseError.message : String(parseError);
    const errorMessage = sanitizeErrorMessage(rawMessage);
    throw new Error(`FATAL: ${operationName}: Failed to parse response - ${errorMessage}`);
  }

  // Validate output constraints
  const allowedSourceUrls = new Set(claims.map(c => c.sourceUrl));
  validateOutputConstraints(parsedResult, allowedSourceUrls);

  // Estimate output tokens
  const estimatedOutputTokens = Math.ceil(rawResponse.text.length / 4);
  const totalTokens = estimatedInputTokens + estimatedOutputTokens;

  // Log usage data for cost tracking (instead of returning it)
  logVerbose(
    `${operationName}: Generated ${parsedResult.linkedinPost.length} char post, ` +
      `~${totalTokens} tokens (${estimatedInputTokens} in, ${estimatedOutputTokens} out)`
  );

  // Return SynthesisResult directly (conforms to SynthesizerFn interface)
  return parsedResult;
};

// ============================================
// Cost Calculation
// ============================================

/**
 * Token usage for cost calculation
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
}

/**
 * Calculate estimated cost for a Gemini synthesis request based on token usage.
 *
 * @param usage - Token usage statistics
 * @returns Estimated cost in USD
 *
 * @example
 * ```typescript
 * const cost = calculateGeminiSynthesisCost({
 *   promptTokens: 1000,
 *   completionTokens: 500,
 * });
 * console.log(`Request cost: $${cost.toFixed(4)}`);
 * ```
 */
export function calculateGeminiSynthesisCost(usage: TokenUsage): number {
  const inputCost = (usage.promptTokens / 1_000_000) * GEMINI_SYNTHESIS_PRICING.inputPerMillion;
  const outputCost = (usage.completionTokens / 1_000_000) * GEMINI_SYNTHESIS_PRICING.outputPerMillion;
  return inputCost + outputCost;
}

// ============================================
// Exports
// ============================================

export {
  GEMINI_MODEL,
  THINKING_LEVEL,
};
