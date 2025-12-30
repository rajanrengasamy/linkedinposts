import { z } from 'zod';
import { SCHEMA_VERSION } from './rawItem.js';
import { VerificationLevelSchema } from './validatedItem.js';

/**
 * LinkedIn post constraints
 */
export const LINKEDIN_POST_MAX_LENGTH = 3000;
export const LINKEDIN_HASHTAGS_MIN = 3;
export const LINKEDIN_HASHTAGS_MAX = 5;

/**
 * Infographic style options
 */
export const InfographicStyleSchema = z.enum([
  'minimal',
  'data-heavy',
  'quote-focused',
]);
export type InfographicStyle = z.infer<typeof InfographicStyleSchema>;

/**
 * Post style for multi-post generation
 */
export const PostStyleSchema = z.enum(['series', 'variations']);
export type PostStyle = z.infer<typeof PostStyleSchema>;

/**
 * Key quote with required source URL
 * CRITICAL: No quote appears without a verified source
 */
export const KeyQuoteSchema = z.object({
  /** The exact quote text */
  quote: z.string().min(1),

  /** Author of the quote */
  author: z.string().min(1),

  /** Source URL where quote was found (REQUIRED) */
  sourceUrl: z.string().url(),

  /** Verification level of this quote */
  verificationLevel: VerificationLevelSchema,
});
export type KeyQuote = z.infer<typeof KeyQuoteSchema>;

/**
 * Individual LinkedIn post in multi-post generation
 */
export const LinkedInPostSchema = z.object({
  postNumber: z.number().int().min(1).max(3),
  totalPosts: z.number().int().min(1).max(3),
  linkedinPost: z.string().min(1).max(LINKEDIN_POST_MAX_LENGTH),
  keyQuotes: z.array(KeyQuoteSchema),
  infographicBrief: z.lazy(() => InfographicBriefSchema),
  seriesTitle: z.string().optional(),
});
export type LinkedInPost = z.infer<typeof LinkedInPostSchema>;

/**
 * Infographic generation brief
 */
export const InfographicBriefSchema = z.object({
  /** Title for the infographic */
  title: z.string().min(1),

  /** Key points to visualize (3-5 recommended) */
  keyPoints: z.array(z.string()).min(1).max(7),

  /** Suggested visual style */
  suggestedStyle: InfographicStyleSchema,

  /** Optional color scheme suggestion */
  colorScheme: z.string().optional(),
});
export type InfographicBrief = z.infer<typeof InfographicBriefSchema>;

/**
 * Fact-check summary for transparency
 */
export const FactCheckSummarySchema = z.object({
  /** Total number of sources used in synthesis */
  totalSourcesUsed: z.number().int().min(0),

  /** Number of quotes that were verified */
  verifiedQuotes: z.number().int().min(0),

  /** Number of claims that could not be verified */
  unverifiedClaims: z.number().int().min(0),

  /** Number of primary/authoritative sources */
  primarySources: z.number().int().min(0),

  /** Any caveats or warnings about the content */
  warnings: z.array(z.string()),
});
export type FactCheckSummary = z.infer<typeof FactCheckSummarySchema>;

/**
 * Cost breakdown by service
 */
export const CostBreakdownSchema = z.object({
  /** Perplexity API costs */
  perplexity: z.number().min(0),

  /** Gemini API costs */
  gemini: z.number().min(0),

  /** OpenAI API costs */
  openai: z.number().min(0),

  /** Nano Banana Pro image generation costs */
  nanoBanana: z.number().min(0),

  /** Total cost */
  total: z.number().min(0),
});
export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;

/**
 * Pipeline metadata
 */
export const SynthesisMetadataSchema = z.object({
  /** Number of sources used in final output */
  sourcesUsed: z.number().int().min(0),

  /** Total processing time in milliseconds */
  processingTimeMs: z.number().int().min(0),

  /** Estimated cost breakdown */
  estimatedCost: CostBreakdownSchema,
});
export type SynthesisMetadata = z.infer<typeof SynthesisMetadataSchema>;

/**
 * SynthesisResult Schema - Final output from the pipeline
 *
 * Contains the generated LinkedIn post, supporting quotes,
 * infographic brief, fact-check summary, and metadata.
 */
export const SynthesisResultSchema = z.object({
  /** Schema version for backwards compatibility */
  schemaVersion: z.literal(SCHEMA_VERSION),

  /** When the synthesis was generated (ISO 8601) */
  generatedAt: z.string().datetime(),

  /** Original user prompt */
  prompt: z.string().min(1),

  /** Post style used for generation (optional for backward compat) */
  postStyle: PostStyleSchema.optional(),

  /** Array of generated posts for multi-post mode */
  posts: z.array(LinkedInPostSchema).min(1).max(3).optional(),

  /** Generated LinkedIn post (max 3000 chars) */
  linkedinPost: z.string().min(1).max(LINKEDIN_POST_MAX_LENGTH),

  /** Key quotes used in the post, each with source URL */
  keyQuotes: z.array(KeyQuoteSchema),

  /** Brief for infographic generation */
  infographicBrief: InfographicBriefSchema,

  /** Fact-check summary for transparency */
  factCheckSummary: FactCheckSummarySchema,

  /** Pipeline metadata */
  metadata: SynthesisMetadataSchema,
});

export type SynthesisResult = z.infer<typeof SynthesisResultSchema>;

/**
 * GPT Response Schema - Partial schema for validating raw GPT output.
 *
 * CODEX-CRIT-1: The full SynthesisResultSchema requires a non-empty prompt,
 * but GPT doesn't return the prompt - the orchestrator adds it later.
 * This partial schema validates just the GPT response fields.
 */
export const GPTSynthesisResponseSchema = z.object({
  /** Generated LinkedIn post (max 3000 chars) */
  linkedinPost: z.string().min(1).max(LINKEDIN_POST_MAX_LENGTH),

  /** Key quotes used in the post, each with source URL */
  keyQuotes: z.array(KeyQuoteSchema),

  /** Brief for infographic generation */
  infographicBrief: InfographicBriefSchema,

  /** Fact-check summary for transparency */
  factCheckSummary: FactCheckSummarySchema,
});

export type GPTSynthesisResponse = z.infer<typeof GPTSynthesisResponseSchema>;

/**
 * GPT Multi-Post Response Schema - For multi-post generation mode.
 *
 * Validates GPT output when generating multiple posts (postCount > 1).
 * Each post contains its own linkedinPost, keyQuotes, and infographicBrief.
 */
export const GPTMultiPostResponseSchema = z.object({
  /** Array of generated posts */
  posts: z.array(LinkedInPostSchema).min(1).max(3),

  /** Aggregate fact-check summary across all posts */
  factCheckSummary: FactCheckSummarySchema,
});

export type GPTMultiPostResponse = z.infer<typeof GPTMultiPostResponseSchema>;

/**
 * Create an empty cost breakdown
 */
export function createEmptyCostBreakdown(): CostBreakdown {
  return {
    perplexity: 0,
    gemini: 0,
    openai: 0,
    nanoBanana: 0,
    total: 0,
  };
}

/**
 * Calculate total cost from breakdown
 */
export function calculateTotalCost(
  costs: Omit<CostBreakdown, 'total'>
): CostBreakdown {
  const total = costs.perplexity + costs.gemini + costs.openai + costs.nanoBanana;
  return {
    ...costs,
    total: Math.round(total * 1000) / 1000, // Round to 3 decimal places
  };
}
