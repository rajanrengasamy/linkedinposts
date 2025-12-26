import { z } from 'zod';
import { ValidatedItemSchema } from './validatedItem.js';

/**
 * Score range validation (0-100)
 */
const ScoreValue = z.number().min(0).max(100);

/**
 * Scoring weights for calculating overall score
 * Must sum to 1.0
 */
export const SCORING_WEIGHTS = {
  relevance: 0.35,
  authenticity: 0.30,
  recency: 0.20,
  engagementPotential: 0.15,
} as const;

/**
 * Scores schema - individual scoring dimensions
 */
export const ScoresSchema = z.object({
  /** How relevant the content is to the original prompt (0-100) */
  relevance: ScoreValue,

  /** Authenticity based on verification level (0-100) */
  authenticity: ScoreValue,

  /** How recent the content is (0-100, newer = higher) */
  recency: ScoreValue,

  /** Likely engagement/virality potential (0-100) */
  engagementPotential: ScoreValue,

  /** Weighted average of all scores (0-100) */
  overall: ScoreValue,
});
export type Scores = z.infer<typeof ScoresSchema>;

/**
 * ScoredItem Schema - ValidatedItem with scoring metadata
 *
 * Extends ValidatedItem with scores from Gemini scoring engine.
 * Items are ranked by overall score for synthesis selection.
 */
export const ScoredItemSchema = ValidatedItemSchema.extend({
  /** Scoring results from scoring engine */
  scores: ScoresSchema,

  /** Brief bullet-point reasoning for scores */
  scoreReasoning: z.array(z.string()),

  /** Position in sorted list (1 = highest score) */
  rank: z.number().int().min(1),
});

export type ScoredItem = z.infer<typeof ScoredItemSchema>;

/**
 * Calculate weighted overall score from individual scores
 */
export function calculateOverallScore(scores: Omit<Scores, 'overall'>): number {
  const overall =
    scores.relevance * SCORING_WEIGHTS.relevance +
    scores.authenticity * SCORING_WEIGHTS.authenticity +
    scores.recency * SCORING_WEIGHTS.recency +
    scores.engagementPotential * SCORING_WEIGHTS.engagementPotential;

  return Math.round(overall * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate recency score based on publication date
 * Items within 24h get 100, decaying over 7 days to minimum of 10
 */
export function calculateRecencyScore(publishedAt: string | undefined): number {
  if (!publishedAt) {
    return 50; // Default for unknown dates
  }

  const now = Date.now();
  const published = new Date(publishedAt).getTime();
  const ageMs = now - published;
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;

  if (ageDays <= 1) {
    return 100; // Within 24 hours
  }
  if (ageDays >= 7) {
    return 10; // Older than 7 days
  }

  // Linear decay from 100 to 10 over 7 days
  return Math.round(100 - (ageDays - 1) * (90 / 6));
}

/**
 * Calculate engagement score normalized to 0-100
 * Uses log scale to handle viral content without skewing
 */
export function calculateEngagementScore(
  likes: number,
  comments: number,
  shares: number
): number {
  const total = likes + comments * 2 + shares * 3; // Weight interactions

  if (total === 0) {
    return 0;
  }

  // Log scale: 1 interaction = ~10, 100 = ~50, 10000 = ~100
  const score = Math.log10(total + 1) * 25;
  return Math.min(100, Math.round(score));
}
