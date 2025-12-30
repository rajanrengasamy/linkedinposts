/**
 * Scoring Engine Exports
 *
 * This module provides content scoring functionality using Gemini 3 Flash
 * or OpenRouter KIMI 2, with fallback to heuristic scoring when LLM is unavailable.
 *
 * The `score()` function is the main entry point and routes to the appropriate
 * scoring model based on config.scoringModel.
 */

import { scoreItems } from './gemini.js';
import { scoreItemsWithKimi2 } from './openrouter.js';
import { logVerbose } from '../utils/logger.js';
import type { ValidatedItem } from '../schemas/validatedItem.js';
import type { ScoredItem } from '../schemas/scoredItem.js';
import type { PipelineConfig } from '../types/index.js';

// ============================================
// Main Scoring Router (Section 16.2)
// ============================================

/**
 * Score items using the configured scoring model.
 *
 * Routes to either Gemini or KIMI 2 based on config.scoringModel.
 * This is the primary scoring entry point for the pipeline.
 *
 * Model Selection:
 * - 'gemini' (default): Uses Gemini 3 Flash with high thinking mode
 * - 'kimi2': Uses OpenRouter's KIMI K2 thinking model
 *
 * Both models produce the same output format (ScoredItem[]) and support:
 * - Batching via config.scoringBatchSize
 * - Fallback scoring on failure
 * - Skip scoring via config.skipScoring
 *
 * @param items - Validated items to score
 * @param userPrompt - Original user prompt for relevance scoring
 * @param config - Pipeline configuration (includes scoringModel)
 * @returns Scored items sorted by overall score
 */
export async function score(
  items: ValidatedItem[],
  userPrompt: string,
  config: PipelineConfig
): Promise<ScoredItem[]> {
  const model = config.scoringModel ?? 'gemini';

  if (model === 'kimi2') {
    logVerbose('Using OpenRouter KIMI 2 for scoring');
    return scoreItemsWithKimi2(items, userPrompt, config);
  }

  logVerbose('Using Gemini for scoring');
  return scoreItems(items, userPrompt, config);
}

// ============================================
// Re-exports for backward compatibility
// ============================================

// Re-export individual scoring functions (for direct access if needed)
export { scoreItems } from './gemini.js';
export { scoreItemsWithKimi2 } from './openrouter.js';
export { fallbackScore } from './fallback.js';

// Types and schemas for external use
export {
  GeminiScoreResponseSchema,
  type GeminiScoreResponse,
  type GeminiScoreEntry,
  type GeminiScoringOptions,
  type GeminiRequestOptions,
} from './gemini.js';

// Utility functions that may be useful externally
export {
  buildScoringPrompt,
  parseGeminiScoringResponse,
  applyVerificationBoost,
  processScoredItems,
} from './gemini.js';

// OpenRouter types and utilities
export {
  type OpenRouterScoringOptions,
  KIMI_MODEL,
  OPENROUTER_API_URL,
  makeOpenRouterRequest,
  parseOpenRouterScoringResponse,
} from './openrouter.js';
