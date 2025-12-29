/**
 * Synthesis Engine Exports
 *
 * This module provides LinkedIn post generation functionality using GPT-5.2
 * with grounded claims extracted from verified source material.
 *
 * Pipeline flow:
 * 1. Extract grounded claims from scored items (claims.ts)
 * 2. Build synthesis prompt with claims (gpt.ts)
 * 3. Generate LinkedIn post via GPT-5.2 (gpt.ts)
 * 4. Build source references for provenance (gpt.ts)
 */

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
// GPT Synthesis (Section 10.2-10.4)
// ============================================

export {
  // Main synthesis function
  synthesize,

  // Source reference building
  buildSourceReferences,

  // Prompt building
  buildSynthesisPrompt,
  formatClaimsForPrompt,
  estimatePromptTokens,
  DELIMITERS,

  // Response parsing
  parseSynthesisResponse,
  validateOutputConstraints,

  // API client functions
  makeGPTRequest,
  getOpenAIClient,
  resetOpenAIClient,
  calculateGPTCost,

  // Types
  type GPTRequestOptions,
  type GPTResponse,
  type ReasoningEffort,

  // Constants
  GPT_MODEL,
  GPT_PRICING,
  REASONING_EFFORT,
  MAX_TOKENS,
  TEMPERATURE,
  SYSTEM_PROMPT,
} from './gpt.js';
