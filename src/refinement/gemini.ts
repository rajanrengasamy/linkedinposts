/**
 * Gemini Prompt Analysis
 *
 * Implements prompt refinement using Gemini 3 Flash for Stage 0.
 * Analyzes user prompts to determine if clarification is needed.
 *
 * This module provides:
 * - Prompt analysis to detect ambiguity or complexity
 * - Clarifying question generation when needed
 * - Refined prompt suggestions for clearer inputs
 *
 * Pattern follows: src/prompts/breakdown.ts
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getApiKey, isCLIModeEnabled, getCLITimeoutMs, getOpenCodeModel } from '../config.js';
import { withRetry, QUICK_RETRY_OPTIONS, TimeoutError } from '../utils/retry.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';
import { createSafeError } from '../utils/sanitization.js';
import { STAGE_TIMEOUT_MS } from '../types/index.js';
import { PromptAnalysisSchema } from './schemas.js';
import { buildAnalysisPrompt, ANALYSIS_SYSTEM_PROMPT } from './prompts.js';
import type { PromptAnalysis, RefinementConfig } from './types.js';
import { routeLLMRequest } from '../llm/fallback-router.js';
import { getGeminiCLIClient } from '../llm/gemini-cli-wrapper.js';
import { getOpenCodeGoogleClient } from '../llm/opencode-wrapper.js';

// ============================================
// Constants
// ============================================

/**
 * Gemini model for prompt analysis.
 * Using Gemini 3 Flash for speed since this is a pre-pipeline analysis step.
 * @see https://ai.google.dev/gemini-api/docs/gemini-3
 */
const REFINEMENT_MODEL = 'gemini-3-flash-preview';

/**
 * Thinking level for Gemini 3 Flash prompt analysis.
 * MEDIUM balances speed and reasoning quality for prompt refinement.
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */
const REFINEMENT_THINKING_LEVEL = ThinkingLevel.MEDIUM;

// ============================================
// Response Parsing
// ============================================

/**
 * Parse and validate Gemini's response against PromptAnalysisSchema.
 *
 * Handles common LLM output patterns:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing whitespace
 * - Validates structure with Zod
 *
 * @param responseText - Raw text response from Gemini
 * @returns Parsed PromptAnalysis or null if parsing fails
 */
function parseGeminiResponse(responseText: string): PromptAnalysis | null {
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
    logVerbose(`Failed to parse Gemini prompt analysis response: ${error}`);
    return null;
  }
}

// ============================================
// Main Analysis Function
// ============================================

/**
 * Analyze a prompt using Gemini to determine if it needs clarification.
 *
 * Uses Gemini 3 Flash to quickly assess the user's prompt and determine:
 * - Whether the prompt is clear and actionable (isClear = true)
 * - If clarification is needed, generates clarifying questions
 * - If clear, provides a suggested refinement for better results
 *
 * Features:
 * - Timeout enforcement with Promise.race pattern
 * - Retry with QUICK_RETRY_OPTIONS for resilience
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
 * const analysis = await analyzeWithGemini('AI trends', {
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
export async function analyzeWithGemini(
  prompt: string,
  config: RefinementConfig
): Promise<PromptAnalysis> {
  const timeout = config.timeoutMs ?? STAGE_TIMEOUT_MS;
  const cliTimeout = getCLITimeoutMs();
  const operationName = 'Gemini prompt analysis';

  logVerbose(`${operationName}: Analyzing prompt (${prompt.length} chars)`);

  // Build the analysis prompt (function only needs the prompt)
  const analysisPrompt = buildAnalysisPrompt(prompt);
  const fullPrompt = `${ANALYSIS_SYSTEM_PROMPT}\n\n${analysisPrompt}\n\nRespond with valid JSON only.`;

  // Define API request function (Tier 3: Direct API)
  const apiRequest = async (): Promise<string> => {
    const apiKey = getApiKey('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      throw new Error(
        'GOOGLE_AI_API_KEY is required for prompt refinement. ' +
          'Please set it in your .env file or environment.'
      );
    }

    const client = new GoogleGenAI({ apiKey });

    const result = await withRetry(
      async () => {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new TimeoutError(`${operationName} timed out after ${timeout}ms`, timeout)),
            timeout
          );
        });

        const apiPromise = client.models.generateContent({
          model: REFINEMENT_MODEL,
          contents: fullPrompt,
          config: {
            thinkingConfig: {
              thinkingLevel: REFINEMENT_THINKING_LEVEL,
            },
          },
        });

        const response = await Promise.race([apiPromise, timeoutPromise]);
        const text = response.text;
        if (!text || text.trim().length === 0) {
          throw new Error('Empty response from Gemini prompt analysis');
        }
        return text;
      },
      { ...QUICK_RETRY_OPTIONS, operationName }
    );

    if (!result.success) {
      throw createSafeError(`${operationName} (after ${result.attempts} attempts)`, result.error);
    }
    return result.data;
  };

  // Define CLI request function (Tier 2: Gemini CLI)
  const cliRequest = async (): Promise<string> => {
    const cliClient = getGeminiCLIClient({ timeout: cliTimeout });
    if (!cliClient) {
      throw new Error('Gemini CLI not available');
    }

    const response = await cliClient.models.generateContent({
      model: REFINEMENT_MODEL,
      contents: fullPrompt,
    });

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new Error('Gemini CLI response has empty content');
    }
    return text;
  };

  // Define OpenCode request function (Tier 1: OpenCode CLI)
  const opencodeRequest = async (): Promise<string> => {
    const ocClient = getOpenCodeGoogleClient({
      model: getOpenCodeModel('gemini'),
      timeout: cliTimeout,
    });
    if (!ocClient) {
      throw new Error('OpenCode CLI not available');
    }

    const response = await ocClient.models.generateContent({
      model: getOpenCodeModel('gemini'),
      contents: fullPrompt,
    });

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new Error('OpenCode CLI response has empty content');
    }
    return text;
  };

  // Route through fallback system
  const routeResult = await routeLLMRequest(
    apiRequest,
    cliRequest,
    opencodeRequest,
    { provider: 'gemini' }
  );

  logInfo(`${operationName}: Routed via ${routeResult.tier} (attempted: ${routeResult.tiersAttempted.join(', ')})`);

  // Parse and validate response
  const analysis = parseGeminiResponse(routeResult.result);
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
