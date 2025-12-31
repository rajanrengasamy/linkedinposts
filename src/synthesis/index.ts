/**
 * Synthesis Engine - Main Orchestrator
 *
 * This module provides LinkedIn post generation functionality with model selection.
 * Routes synthesis requests to the appropriate model implementation based on config.
 *
 * Pipeline flow:
 * 1. Extract grounded claims from scored items (claims.ts)
 * 2. Select synthesis model based on config (index.ts)
 * 3. Build synthesis prompt with claims (prompts.ts)
 * 4. Generate LinkedIn post via selected model (gpt.ts/gemini-synthesis.ts/etc.)
 * 5. Build source references for provenance
 *
 * @see docs/PRD-v2.md Section 15
 */

// ============================================
// Re-export Synthesis Types (Section 19.1)
// ============================================

export * from './types.js';

// ============================================
// Claim Extraction (Section 10.1)
// ============================================

export {
  // Types and schemas
  GroundedClaimSchema,
  ClaimTypeSchema,
  type GroundedClaim,
  type ClaimType,

  // Main extraction functions
  extractGroundedClaims,
  extractGroundedClaimsOrThrow,

  // Verification helpers
  isVerificationSufficient,

  // Individual extractors (for testing/advanced use)
  extractQuotes,
  extractStatistics,
  extractInsights,

  // Utility functions
  groupClaimsByType,
  filterClaimsByType,
  getUniqueSourceUrls,
  countByVerificationLevel,
  groupClaimsByVerificationLevel,
} from './claims.js';

// ============================================
// Shared Prompts (Section 19.5)
// ============================================

export {
  // Prompt constants
  SYSTEM_PROMPT,
  DELIMITERS,
  MAX_PROMPT_LENGTH,
  MAX_CLAIM_LENGTH,

  // Prompt building functions
  buildSynthesisPrompt,
  buildMultiPostPrompt,
  formatClaimsForPrompt,
  estimatePromptTokens,

  // Response parsing
  parseSynthesisResponse,
  parseMultiPostResponse,
  validateOutputConstraints,
  convertMultiPostToSynthesisResult,
} from './prompts.js';

// ============================================
// GPT-Specific Exports (backward compatibility)
// ============================================
// MAJ-11: These exports are maintained for backward compatibility.
// Prefer using the main `synthesize()` function and `selectSynthesizer()` for new code.
// Internal functions (getOpenAIClient, resetOpenAIClient, makeGPTRequest) are
// exported for testing purposes only and may change without notice.

export {
  // Source reference building (public utility)
  buildSourceReferences,

  // Cost calculation (public)
  calculateGPTCost,

  // Types (public)
  type GPTRequestOptions,
  type GPTResponse,
  type ReasoningEffort,

  // Constants (public)
  GPT_MODEL,
  GPT_PRICING,
  REASONING_EFFORT,
  MAX_TOKENS,
  TEMPERATURE,
} from './gpt.js';

// Internal exports for testing only - not part of public API
export {
  makeGPTRequest,
  getOpenAIClient,
  resetOpenAIClient,
} from './gpt.js';

// ============================================
// Model-Specific Synthesizers
// ============================================

// GPT synthesizer - standardized SynthesizerFn wrapper
export { synthesizeWithGPT, calculateGPTCost as calculateGPTSynthesisCost } from './gpt.js';

// Gemini synthesizer
export { synthesizeWithGemini, calculateGeminiSynthesisCost } from './gemini-synthesis.js';

// Claude synthesizer
export { synthesizeWithClaude, calculateClaudeSynthesisCost } from './claude-synthesis.js';

// Kimi synthesizer
export { synthesizeWithKimi, calculateKimiSynthesisCost } from './kimi-synthesis.js';

// ============================================
// Model Selection Orchestrator (Section 19.6)
// ============================================

import type { SynthesisModel, SynthesizerFn, SynthesisOptions } from './types.js';
import type { PipelineConfig } from '../types/index.js';
import type { SynthesisResult } from '../schemas/index.js';
import type { GroundedClaim } from './claims.js';
// Import standardized SynthesizerFn implementations
import { synthesizeWithGPT } from './gpt.js';
import { synthesizeWithGemini } from './gemini-synthesis.js';
import { synthesizeWithClaude } from './claude-synthesis.js';
import { synthesizeWithKimi } from './kimi-synthesis.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';

/**
 * Select the appropriate synthesizer function based on model.
 *
 * CRIT-5/CRIT-6: All synthesizers now conform to SynthesizerFn signature directly.
 * MAJ-8: Removed unused 'available' field - was always true and never used for actual availability checking.
 *
 * @param model - The synthesis model to use
 * @returns Object with synthesizer function and model name
 */
export function selectSynthesizer(model: SynthesisModel): {
  synthesizer: SynthesizerFn;
  modelName: string;
} {
  switch (model) {
    case 'gpt':
      return { synthesizer: synthesizeWithGPT, modelName: 'GPT-5.2' };
    case 'gemini':
      return { synthesizer: synthesizeWithGemini, modelName: 'Gemini 3 Flash' };
    case 'claude':
      return { synthesizer: synthesizeWithClaude, modelName: 'Claude Sonnet 4.5' };
    case 'kimi2':
      return { synthesizer: synthesizeWithKimi, modelName: 'Kimi K2' };
    default:
      // MAJ-3: Warn that fallback to GPT may fail if OPENAI_API_KEY is not set
      logWarning(`Unknown synthesis model '${model}', falling back to GPT`);
      if (!process.env.OPENAI_API_KEY) {
        logWarning('OPENAI_API_KEY not set - GPT fallback may fail');
      }
      return { synthesizer: synthesizeWithGPT, modelName: 'GPT-5.2' };
  }
}

/**
 * Main synthesis function with model selection.
 *
 * Orchestrates LinkedIn post generation using the model specified in config.
 * Falls back to GPT if the selected model is not available.
 *
 * This is the main entry point for the pipeline. It:
 * 1. Selects the appropriate synthesizer based on config.synthesisModel
 * 2. Calls the synthesizer with the claims and prompt
 * 3. Returns the synthesis result
 *
 * @param claims - Grounded claims from scoring phase
 * @param prompt - User's original prompt/topic
 * @param config - Pipeline configuration including synthesisModel
 * @returns SynthesisResult with generated post
 *
 * @example
 * ```typescript
 * const result = await synthesize(claims, 'AI trends', config);
 * console.log(result.linkedinPost);
 * ```
 */
export async function synthesize(
  claims: GroundedClaim[],
  prompt: string,
  config: PipelineConfig
): Promise<SynthesisResult> {
  // Get the model from config, defaulting to 'gpt'
  const model: SynthesisModel = config.synthesisModel ?? 'gpt';

  // Select synthesizer (MAJ-8: removed unused 'available' field)
  const { synthesizer, modelName } = selectSynthesizer(model);

  logInfo(`Synthesis: Using ${modelName} model`);

  // MIN-3: Validate postCount range (1-3)
  const postCount = config.postCount ?? 1;
  if (postCount < 1 || postCount > 3) {
    throw new Error(`FATAL: Invalid postCount ${postCount}, must be 1-3`);
  }

  // Build synthesis options from config
  const options: SynthesisOptions = {
    postCount,
    postStyle: config.postStyle ?? 'variations',
    verbose: config.verbose,
    timeoutMs: config.timeoutSeconds ? config.timeoutSeconds * 1000 : undefined,
  };

  // CRIT-5/CRIT-6: All synthesizers now use unified SynthesizerFn interface
  const result = await synthesizer(prompt, claims, options);

  logVerbose(`Synthesis complete: ${result.linkedinPost.length} chars, ${result.keyQuotes.length} quotes`);

  return result;
}
