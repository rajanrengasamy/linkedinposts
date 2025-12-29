/**
 * Scoring Engine Exports
 *
 * This module provides content scoring functionality using Gemini 3 Flash
 * with fallback to heuristic scoring when LLM is unavailable.
 */

// Main scoring functions
export { scoreItems } from './gemini.js';
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
