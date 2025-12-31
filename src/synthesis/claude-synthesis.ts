/**
 * Claude Synthesis
 *
 * Implements LinkedIn post synthesis using Claude Sonnet 4.5.
 * Balanced quality and cost option for synthesis.
 *
 * This module provides:
 * - LinkedIn post generation using Claude Sonnet 4.5
 * - Singleton client pattern for efficient connection reuse
 * - Multi-post generation (variations and series modes)
 * - Timeout and retry handling for resilience
 * - Token usage tracking for cost estimation
 *
 * @see docs/PRD-v2.md Section 15
 */

import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from '../config.js';
import { withRetry, CRITICAL_RETRY_OPTIONS, TimeoutError } from '../utils/retry.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';
import { createSafeError, sanitizeErrorMessage } from '../utils/sanitization.js';
import { STAGE_TIMEOUT_MS } from '../types/index.js';
import type { SynthesisResult } from '../schemas/index.js';
import {
  isFixableParseError,
  retryWithFixPrompt,
  SynthesisResultSchema,
} from '../schemas/index.js';
import type { GroundedClaim } from './claims.js';
import type { PostStyle } from '../types/index.js';
import type { PipelineConfig } from '../types/index.js';
import type { SynthesizerFn, SynthesisOptions } from './types.js';
import {
  SYSTEM_PROMPT,
  buildSynthesisPrompt,
  buildMultiPostPrompt,
  parseSynthesisResponse,
  parseMultiPostResponse,
  convertMultiPostToSynthesisResult,
  validateOutputConstraints,
} from './prompts.js';

// ============================================
// Constants
// ============================================

/**
 * Claude model for synthesis.
 * Using Claude Sonnet 4.5 for balanced reasoning and quality.
 */
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/**
 * Maximum tokens for response.
 * 8192 is sufficient for LinkedIn post plus metadata.
 */
const MAX_TOKENS = 8192;

/**
 * Pricing for Claude Sonnet 4.5 (used for cost tracking)
 * Rates are per million tokens
 * @see https://www.anthropic.com/pricing
 */
export const CLAUDE_SYNTHESIS_PRICING = {
  inputPerMillion: 3.00,   // $3.00/1M input tokens
  outputPerMillion: 15.00, // $15.00/1M output tokens
};

// ============================================
// Client Initialization (singleton pattern)
// ============================================

/**
 * Singleton Anthropic client instance.
 * Initialized lazily on first use.
 */
let anthropicClient: Anthropic | null = null;

/**
 * Lock flag to prevent race condition during client initialization.
 * While Node.js is single-threaded, async operations can interleave.
 */
let clientInitializing = false;

/**
 * Get or create the Anthropic client singleton for synthesis.
 *
 * Lazily initializes the Anthropic client on first call.
 * Validates that ANTHROPIC_API_KEY is set before creating client.
 * Uses a lock flag to prevent race conditions during initialization.
 *
 * @returns Initialized Anthropic client
 * @throws Error if ANTHROPIC_API_KEY is not configured or initialization race detected
 */
export function getAnthropicSynthesisClient(): Anthropic {
  // Fast path: client already exists
  if (anthropicClient !== null) {
    return anthropicClient;
  }

  // Prevent race condition: if already initializing, throw
  if (clientInitializing) {
    throw new Error(
      'Anthropic synthesis client initialization in progress. This indicates a race condition.'
    );
  }

  clientInitializing = true;
  try {
    // Double-check after acquiring lock
    if (anthropicClient !== null) {
      return anthropicClient;
    }

    // MAJ-4: Use centralized getApiKey() instead of direct process.env access
    // CRIT-3: Include FATAL prefix for API key errors
    const apiKey = getApiKey('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error(
        'FATAL: ANTHROPIC_API_KEY is required for Claude synthesis. ' +
          'Please set it in your .env file or environment.'
      );
    }

    // Create and cache the client
    anthropicClient = new Anthropic({ apiKey });
    logVerbose('Anthropic synthesis client initialized');

    return anthropicClient;
  } finally {
    clientInitializing = false;
  }
}

/**
 * Reset the client singleton (primarily for testing).
 */
export function resetAnthropicSynthesisClient(): void {
  anthropicClient = null;
  clientInitializing = false;
}

// ============================================
// Types
// ============================================

/**
 * Options for Claude synthesis configuration
 */
export interface ClaudeSynthesisOptions {
  /** Request timeout in milliseconds (default: STAGE_TIMEOUT_MS) */
  timeoutMs?: number;

  /** Maximum tokens in response (default: 8192) */
  maxTokens?: number;

  /** Number of posts to generate (1-3, default: 1) */
  postCount?: number;

  /** Post style: 'variations' for A/B testing, 'series' for connected multi-part */
  postStyle?: PostStyle;

  /** Operation name for logging */
  operationName?: string;
}

/**
 * Response from Claude synthesis including usage statistics
 */
export interface ClaudeSynthesisResponse {
  /** The synthesis result with LinkedIn post(s) */
  result: SynthesisResult;

  /** Token usage for cost tracking */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ============================================
// Main Synthesizer
// ============================================

/**
 * Synthesize LinkedIn post using Claude Sonnet 4.5.
 *
 * Uses Claude Sonnet 4.5 for balanced quality and cost. Supports both
 * single post and multi-post generation modes.
 *
 * Features:
 * - Claude Sonnet 4.5 for high-quality content generation
 * - Singleton client pattern for efficient connection reuse
 * - Timeout enforcement with Promise.race pattern
 * - Retry with CRITICAL_RETRY_OPTIONS for resilience
 * - Error sanitization to prevent API key exposure
 * - Multi-post support (variations and series modes)
 *
 * @param prompt - The user's original topic/prompt
 * @param claims - Array of grounded claims with source URLs
 * @param options - Synthesis configuration options
 * @returns Promise resolving to SynthesisResult
 * @throws Error if API key is missing or all retries fail
 *
 * @example
 * ```typescript
 * const claims = extractGroundedClaims(scoredItems);
 * const result = await synthesizeWithClaude('AI trends 2025', claims, {
 *   postCount: 1,
 *   postStyle: 'variations',
 * });
 * console.log(result.linkedinPost);
 * ```
 */
export const synthesizeWithClaude: SynthesizerFn = async (
  prompt: string,
  claims: GroundedClaim[],
  options: SynthesisOptions
): Promise<SynthesisResult> => {
  const {
    timeoutMs = STAGE_TIMEOUT_MS,
    postCount = 1,
    postStyle = 'variations',
  } = options;
  const maxTokens = MAX_TOKENS;
  const operationName = 'Claude synthesis';

  // CRIT-2: Validate claims are provided
  if (!claims || claims.length === 0) {
    throw new Error('FATAL: No claims provided - cannot generate post without verified source material');
  }

  // MIN-5: Validate prompt length
  if (!prompt || prompt.trim().length < 10) {
    throw new Error('FATAL: User prompt too short - minimum 10 characters required');
  }

  logInfo(`${operationName}: Generating post with ${claims.length} claims`);

  // Get client (validates API key)
  const client = getAnthropicSynthesisClient();

  // Build prompt based on post count
  const isMultiPost = postCount > 1;
  const synthesisPrompt = isMultiPost
    ? buildMultiPostPrompt(claims, prompt, postCount, postStyle)
    : buildSynthesisPrompt(claims, prompt);

  // Make API request with retry logic and timeout enforcement
  const result = await withRetry(
    async () => {
      // Create timeout promise for enforcement
      // MAJ-9: Include FATAL prefix on timeout errors
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TimeoutError(`FATAL: ${operationName} timed out after ${timeoutMs}ms`, timeoutMs)),
          timeoutMs
        );
      });

      // Build the API request using Messages API
      const apiPromise = client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: synthesisPrompt,
          },
        ],
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      // Extract text from Claude response
      // Claude returns an array of content blocks
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude synthesis response has no text content');
      }

      const content = textBlock.text;
      // MIN-4: Include FATAL prefix on empty response
      if (!content || content.trim().length === 0) {
        throw new Error('FATAL: Claude synthesis response has empty text');
      }

      // Return content with usage data
      return {
        text: content.trim(),
        usage: response.usage,
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
    const safeError = createSafeError(
      `${operationName} (after ${result.attempts} attempts)`,
      result.error
    );
    throw safeError;
  }

  // Parse response based on mode
  // MAJ-1: Add parse retry logic similar to GPT implementation
  let parsedResult: SynthesisResult;
  try {
    if (isMultiPost) {
      // Parse multi-post response, then convert to SynthesisResult
      const multiPost = parseMultiPostResponse(result.data.text);
      // Create minimal config for conversion
      const minimalConfig = { postStyle, postCount } as PipelineConfig;
      parsedResult = convertMultiPostToSynthesisResult(multiPost, prompt, minimalConfig);
    } else {
      parsedResult = parseSynthesisResponse(result.data.text);
      // Update with actual prompt (parser returns placeholder)
      parsedResult = { ...parsedResult, prompt };
    }
  } catch (parseError) {
    // MAJ-2: Sanitize error messages to prevent API key exposure
    const errorMessage = sanitizeErrorMessage(parseError instanceof Error ? parseError.message : String(parseError));

    // MAJ-1: Check if error is fixable before attempting retry
    if (!isFixableParseError(parseError)) {
      throw new Error(`FATAL: ${operationName} parse failed - schema validation error, not retryable - ${errorMessage}`);
    }

    // On fixable parse error (JSON syntax): retry once with fix prompt
    logWarning(`${operationName}: Initial parse failed (JSON error), attempting fix with retry...`);

    const fixResult = await retryWithFixPrompt(
      async (fixPrompt: string) => {
        // Make another Claude API call with the fix prompt
        const fixResponse = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: maxTokens,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: fixPrompt }],
        });

        const textBlock = fixResponse.content.find((block) => block.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('FATAL: Claude fix response has no text content');
        }
        return textBlock.text;
      },
      SynthesisResultSchema,
      result.data.text,
      synthesisPrompt
    );

    if (!fixResult.success) {
      throw new Error(
        `FATAL: ${operationName} parse failed after retry - original: ${errorMessage}, retry: ${sanitizeErrorMessage(fixResult.error)}`
      );
    }

    logVerbose(`${operationName}: Parse fix successful (retried: ${fixResult.retried})`);
    parsedResult = { ...fixResult.data, prompt };
  }

  // Validate output constraints
  const allowedSourceUrls = new Set(claims.map(c => c.sourceUrl));
  validateOutputConstraints(parsedResult, allowedSourceUrls);

  // Extract usage from response and log it (no longer returned)
  const usage = {
    promptTokens: result.data.usage.input_tokens,
    completionTokens: result.data.usage.output_tokens,
    totalTokens: result.data.usage.input_tokens + result.data.usage.output_tokens,
  };

  // Calculate and log cost for transparency
  const cost = calculateClaudeSynthesisCost(usage);
  logVerbose(
    `${operationName}: Generated ${parsedResult.linkedinPost.length} char post, ` +
      `${usage.totalTokens} tokens (cost: $${cost.toFixed(4)}), ${result.attempts} attempt(s)`
  );

  // Return SynthesisResult directly per SynthesizerFn interface
  return parsedResult;
};

// ============================================
// Cost Calculation
// ============================================

/**
 * Token usage for cost calculation
 */
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Calculate estimated cost for a Claude synthesis request based on token usage.
 *
 * @param usage - Token usage statistics
 * @returns Estimated cost in USD
 *
 * @example
 * ```typescript
 * const cost = calculateClaudeSynthesisCost({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
 * console.log(`Request cost: $${cost.toFixed(4)}`);
 * ```
 */
export function calculateClaudeSynthesisCost(usage: TokenUsage): number {
  const inputCost = (usage.promptTokens / 1_000_000) * CLAUDE_SYNTHESIS_PRICING.inputPerMillion;
  const outputCost = (usage.completionTokens / 1_000_000) * CLAUDE_SYNTHESIS_PRICING.outputPerMillion;
  return inputCost + outputCost;
}

// ============================================
// Exports
// ============================================

export {
  CLAUDE_MODEL,
  MAX_TOKENS,
};
