/**
 * Claude Prompt Analysis
 *
 * Implements prompt refinement using Claude Sonnet 4.5 for Stage 0.
 * Analyzes user prompts to determine if clarification is needed.
 *
 * This module provides:
 * - Prompt analysis to detect ambiguity or complexity
 * - Clarifying question generation when needed
 * - Refined prompt suggestions for clearer inputs
 *
 * This is a NEW provider integration using @anthropic-ai/sdk.
 */

import Anthropic from '@anthropic-ai/sdk';
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
 * Claude model for prompt analysis.
 * Using Claude Sonnet 4.5 for balanced reasoning and speed.
 */
const CLAUDE_MODEL = 'claude-sonnet-4-5-20241022';

/**
 * Maximum tokens for response.
 * 2048 is sufficient for analysis response with questions.
 */
const MAX_TOKENS = 2048;

// ============================================
// Client Initialization
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
 * Get or create the Anthropic client singleton.
 *
 * Lazily initializes the Anthropic client on first call.
 * Validates that ANTHROPIC_API_KEY is set before creating client.
 * Uses a lock flag to prevent race conditions during initialization.
 *
 * @returns Initialized Anthropic client
 * @throws Error if ANTHROPIC_API_KEY is not configured or initialization race detected
 */
export function getAnthropicClient(): Anthropic {
  // Fast path: client already exists
  if (anthropicClient !== null) {
    return anthropicClient;
  }

  // Prevent race condition: if already initializing, throw
  if (clientInitializing) {
    throw new Error(
      'Anthropic client initialization in progress. This indicates a race condition.'
    );
  }

  clientInitializing = true;
  try {
    // Double-check after acquiring lock
    if (anthropicClient !== null) {
      return anthropicClient;
    }

    // Check for ANTHROPIC_API_KEY in environment
    // Note: getApiKey expects a key from ENV_KEYS, but ANTHROPIC_API_KEY may not be there yet
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for Claude prompt refinement. ' +
          'Please set it in your .env file or environment.'
      );
    }

    // Create and cache the client
    anthropicClient = new Anthropic({ apiKey });
    logVerbose('Anthropic client initialized for prompt refinement');

    return anthropicClient;
  } finally {
    clientInitializing = false;
  }
}

/**
 * Reset the client singleton (primarily for testing).
 */
export function resetAnthropicClient(): void {
  anthropicClient = null;
  clientInitializing = false;
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse and validate Claude's response against PromptAnalysisSchema.
 *
 * Handles common LLM output patterns:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing whitespace
 * - Validates structure with Zod
 *
 * @param responseText - Raw text response from Claude
 * @returns Parsed PromptAnalysis or null if parsing fails
 */
function parseClaudeResponse(responseText: string): PromptAnalysis | null {
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
    logVerbose(`Failed to parse Claude prompt analysis response: ${error}`);
    return null;
  }
}

// ============================================
// Main Analysis Function
// ============================================

/**
 * Analyze a prompt using Claude Sonnet 4.5 to determine if it needs clarification.
 *
 * Uses Claude Sonnet 4.5 for balanced reasoning to assess the user's prompt:
 * - Whether the prompt is clear and actionable (isClear = true)
 * - If clarification is needed, generates clarifying questions
 * - If ready, may suggest refinements for better results
 *
 * Features:
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
 * const analysis = await analyzeWithClaude('AI trends', {
 *   skip: false,
 *   model: 'claude',
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
export async function analyzeWithClaude(
  prompt: string,
  config: RefinementConfig
): Promise<PromptAnalysis> {
  const timeout = config.timeoutMs ?? STAGE_TIMEOUT_MS;
  const operationName = 'Claude prompt analysis';

  logVerbose(`${operationName}: Analyzing prompt (${prompt.length} chars)`);

  // Get client (validates API key)
  const client = getAnthropicClient();

  // Build the analysis prompt
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

      // Build the API request using Messages API
      const apiPromise = client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: analysisPrompt,
          },
        ],
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      // Extract content from Claude response
      // Claude returns an array of content blocks
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude prompt analysis response has no text content');
      }

      const content = textBlock.text;
      if (!content || content.trim().length === 0) {
        throw new Error('Claude prompt analysis response has empty text');
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
  const analysis = parseClaudeResponse(result.data);
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
