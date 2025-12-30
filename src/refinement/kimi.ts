/**
 * Kimi 2 Prompt Analysis via OpenRouter
 *
 * Implements prompt refinement using Kimi K2 Thinking for Stage 0.
 * Analyzes user prompts to determine if clarification is needed.
 *
 * This module provides:
 * - Prompt analysis to detect ambiguity or complexity
 * - Clarifying question generation when needed
 * - Refined prompt suggestions for clearer inputs
 *
 * Pattern follows: src/scoring/openrouter.ts
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
import { createSafeError } from '../utils/sanitization.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import { STAGE_TIMEOUT_MS } from '../types/index.js';
import { PromptAnalysisSchema } from './schemas.js';
import { buildAnalysisPrompt, ANALYSIS_SYSTEM_PROMPT } from './prompts.js';
import type { PromptAnalysis, RefinementConfig } from './types.js';

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
 * HTTP headers required by OpenRouter
 */
const OPENROUTER_HEADERS = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://github.com/linkedin-quotes-cli',
  'X-Title': 'LinkedIn Quotes CLI',
} as const;

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
    throw new Error(
      'OPENROUTER_API_KEY is required for Kimi 2 prompt refinement. ' +
        'Please set it in your .env file or environment.'
    );
  }
  return apiKey;
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse and validate Kimi's response against PromptAnalysisSchema.
 *
 * Handles common LLM output patterns:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing whitespace
 * - Validates structure with Zod
 *
 * @param responseText - Raw text response from Kimi
 * @returns Parsed PromptAnalysis or null if parsing fails
 */
function parseKimiResponse(responseText: string): PromptAnalysis | null {
  try {
    // Strip markdown code fences if present
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }

    // Parse JSON
    const parsed = JSON.parse(cleaned);

    // Validate with Zod schema
    const result = PromptAnalysisSchema.safeParse(parsed);
    if (!result.success) {
      logVerbose(`Prompt analysis response validation failed: ${result.error.message}`);
      return null;
    }

    return result.data;
  } catch (error) {
    logVerbose(`Failed to parse Kimi prompt analysis response: ${error}`);
    return null;
  }
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
// Main Analysis Function
// ============================================

/**
 * Analyze a prompt using Kimi 2 via OpenRouter to determine if it needs clarification.
 *
 * Uses Kimi K2 Thinking with low reasoning effort for fast analysis:
 * - Whether the prompt is clear and actionable (isClear = true)
 * - If clarification is needed, generates clarifying questions
 * - If ready, may suggest refinements for better results
 *
 * Features:
 * - OpenRouter API integration following src/scoring/openrouter.ts pattern
 * - Timeout enforcement with Promise.race pattern
 * - Retry with CRITICAL_RETRY_OPTIONS for resilience
 * - Error sanitization to prevent API key exposure
 * - Zod validation for structured response
 *
 * @param prompt - The user's original prompt to analyze
 * @param config - Refinement configuration options
 * @returns PromptAnalysis with either clarifying questions or suggested refinement
 * @throws Error if API call fails after retries
 *
 * @example
 * ```typescript
 * const analysis = await analyzeWithKimi('AI trends', {
 *   skip: false,
 *   model: 'kimi2',
 *   maxIterations: 3,
 *   timeoutMs: 30000
 * });
 *
 * if (!analysis.isClear) {
 *   // Prompt user with analysis.clarifyingQuestions
 * } else {
 *   // Use analysis.suggestedRefinement or original prompt
 * }
 * ```
 */
export async function analyzeWithKimi(
  prompt: string,
  config: RefinementConfig
): Promise<PromptAnalysis> {
  const timeout = config.timeoutMs ?? STAGE_TIMEOUT_MS;
  const operationName = 'Kimi 2 prompt analysis';

  logVerbose(`${operationName}: Analyzing prompt (${prompt.length} chars)`);

  // Get API key (validates it exists)
  const apiKey = getOpenRouterApiKey();

  // Build the analysis prompt
  const analysisPrompt = buildAnalysisPrompt(prompt);

  // Build request body
  const requestBody: OpenRouterRequest = {
    model: KIMI_MODEL,
    messages: [
      {
        role: 'system',
        content: ANALYSIS_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: analysisPrompt,
      },
    ],
    // Use low reasoning effort for speed in prompt analysis
    reasoning: { effort: 'low' },
  };

  // Make API request with retry logic and timeout enforcement
  const result = await withRetry(
    async () => {
      // Create timeout promise for enforcement
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new TimeoutError(`${operationName} timed out after ${timeout}ms`, timeout)),
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

      return content.trim();
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

  // Parse and validate response
  const analysis = parseKimiResponse(result.data);
  if (!analysis) {
    throw new Error(
      `${operationName}: Failed to parse response - invalid JSON or schema mismatch`
    );
  }

  logVerbose(
    `${operationName}: Analysis complete - ` +
      `isClear: ${analysis.isClear}, ` +
      `confidence: ${analysis.confidence}, ` +
      `questions: ${analysis.clarifyingQuestions?.length ?? 0}`
  );

  return analysis;
}
