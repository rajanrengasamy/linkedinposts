/**
 * GPT Prompt Analysis
 *
 * Implements prompt refinement using GPT-5.2 for Stage 0.
 * Analyzes user prompts to determine if clarification is needed.
 *
 * This module provides:
 * - Prompt analysis to detect ambiguity or complexity
 * - Clarifying question generation when needed
 * - Refined prompt suggestions for clearer inputs
 *
 * Pattern follows: src/synthesis/gpt.ts (Responses API)
 */

import OpenAI from 'openai';
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
 * GPT model for prompt analysis.
 * Using GPT-5.2 with low reasoning effort for fast analysis.
 */
const GPT_MODEL = 'gpt-5.2';

/**
 * Reasoning effort level for prompt analysis.
 * 'low' provides fast analysis without complex reasoning overhead.
 */
const REASONING_EFFORT = 'low' as const;

/**
 * Maximum tokens for response.
 * 2048 is sufficient for analysis response with questions.
 */
const MAX_TOKENS = 2048;

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

/**
 * Get or create the OpenAI client singleton.
 *
 * Lazily initializes the OpenAI client on first call.
 * Validates that OPENAI_API_KEY is set before creating client.
 * Uses a lock flag to prevent race conditions during initialization.
 *
 * @returns Initialized OpenAI client
 * @throws Error if OPENAI_API_KEY is not configured or initialization race detected
 */
function getOpenAIClient(): OpenAI {
  // Fast path: client already exists
  if (openaiClient !== null) {
    return openaiClient;
  }

  // Prevent race condition: if already initializing, throw
  if (clientInitializing) {
    throw new Error(
      'OpenAI client initialization in progress. This indicates a race condition.'
    );
  }

  clientInitializing = true;
  try {
    // Double-check after acquiring lock
    if (openaiClient !== null) {
      return openaiClient;
    }

    const apiKey = getApiKey('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for prompt refinement. ' +
          'Please set it in your .env file or environment.'
      );
    }

    // Create and cache the client
    openaiClient = new OpenAI({ apiKey });
    logVerbose('OpenAI client initialized for prompt refinement');

    return openaiClient;
  } finally {
    clientInitializing = false;
  }
}

/**
 * Reset the client singleton (primarily for testing).
 */
export function resetOpenAIClient(): void {
  openaiClient = null;
  clientInitializing = false;
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse and validate GPT's response against PromptAnalysisSchema.
 *
 * Handles common LLM output patterns:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing whitespace
 * - Validates structure with Zod
 *
 * @param responseText - Raw text response from GPT
 * @returns Parsed PromptAnalysis or null if parsing fails
 */
function parseGPTResponse(responseText: string): PromptAnalysis | null {
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
    logVerbose(`Failed to parse GPT prompt analysis response: ${error}`);
    return null;
  }
}

// ============================================
// Main Analysis Function
// ============================================

/**
 * Analyze a prompt using GPT-5.2 to determine if it needs clarification.
 *
 * Uses GPT-5.2 with low reasoning effort to quickly assess the user's prompt:
 * - Whether the prompt is clear and actionable (isClear = true)
 * - If clarification is needed, generates clarifying questions
 * - If clear, provides a suggested refinement for better results
 *
 * Features:
 * - Uses Responses API (recommended for GPT-5.2)
 * - Timeout enforcement with Promise.race pattern
 * - Retry with CRITICAL_RETRY_OPTIONS for resilience
 * - Error sanitization to prevent API key exposure
 * - Zod validation for structured response
 * - JSON output format enforcement
 *
 * @param prompt - The user's original prompt to analyze
 * @param config - Refinement configuration options
 * @returns PromptAnalysis with either clarifying questions or suggested refinement
 * @throws Error if API call fails after retries
 *
 * @example
 * ```typescript
 * const analysis = await analyzeWithGPT('AI trends', {
 *   interactive: true,
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
export async function analyzeWithGPT(
  prompt: string,
  config: RefinementConfig
): Promise<PromptAnalysis> {
  const timeout = config.timeoutMs ?? STAGE_TIMEOUT_MS;
  const operationName = 'GPT prompt analysis';

  logVerbose(`${operationName}: Analyzing prompt (${prompt.length} chars)`);

  // Get client (validates API key)
  const client = getOpenAIClient();

  // Build the analysis prompt (function only needs the prompt)
  const analysisPrompt = buildAnalysisPrompt(prompt);

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

      // Build the API request using Responses API
      // Responses API is recommended for GPT-5.2 - better reasoning, caching, performance
      const apiPromise = client.responses.create({
        model: GPT_MODEL,
        instructions: ANALYSIS_SYSTEM_PROMPT,
        input: [{ role: 'user' as const, content: analysisPrompt }],
        reasoning: { effort: REASONING_EFFORT },
        text: { format: { type: 'json_object' as const } },
        max_output_tokens: MAX_TOKENS,
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      // Extract content from Responses API structure
      const content = response.output_text;
      if (!content || content.trim().length === 0) {
        throw new Error('GPT prompt analysis response has empty output_text');
      }

      return content.trim();
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

  // Parse and validate response
  const analysis = parseGPTResponse(result.data);
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
