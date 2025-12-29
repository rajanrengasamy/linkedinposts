/**
 * Fallback Scoring - Heuristic-based
 *
 * Used when Gemini scoring is skipped or fails.
 * Provides deterministic scoring based on recency and engagement.
 *
 * Per PRD Section 9.3:
 * - overall = (recencyScore * 0.5) + (engagementScore * 0.5)
 * - No LLM calls required
 * - Must still apply verification boost to authenticity
 */

import {
  calculateRecencyScore,
  calculateEngagementScore,
  ScoredItemSchema,
  type ScoredItem,
} from '../schemas/scoredItem.js';
import {
  VERIFICATION_BOOSTS,
  type ValidatedItem,
} from '../schemas/validatedItem.js';
import { logVerbose, logWarning } from '../utils/logger.js';

/**
 * Base authenticity score for fallback scoring.
 *
 * Intentionally conservative (25) compared to Gemini's dynamic scoring because:
 * 1. Without LLM analysis, we cannot assess content quality
 * 2. Verification boost still applies (UNVERIFIED +0, PRIMARY +75)
 * 3. This ensures fallback-scored items rank lower than LLM-scored items
 *    with similar verification levels, which is desirable behavior.
 *
 * Combined with verification boosts, final authenticity ranges:
 * - UNVERIFIED: 25 (base only)
 * - SOURCE_CONFIRMED: 50 (25 + 25)
 * - MULTISOURCE_CONFIRMED: 75 (25 + 50)
 * - PRIMARY_SOURCE: 100 (25 + 75, capped)
 */
const BASE_AUTHENTICITY = 25;

/**
 * Default relevance score when LLM is unavailable.
 * Set to 50 (neutral) since we cannot determine relevance without LLM.
 */
const DEFAULT_RELEVANCE = 50;

/**
 * Score items using heuristics when Gemini is unavailable.
 *
 * Heuristic scoring (per PRD Section 9.3):
 * - relevance: Set to 50 (cannot determine without LLM)
 * - authenticity: Based on verification level boost
 * - recency: From calculateRecencyScore()
 * - engagementPotential: From calculateEngagementScore()
 * - overall: (recency * 0.5) + (engagement * 0.5) per PRD fallback formula
 *
 * Note: Fallback overall differs from normal weighted average used in Gemini scoring.
 * The normal weights are: relevance(0.35) + authenticity(0.30) + recency(0.20) + engagement(0.15)
 * Fallback uses: recency(0.5) + engagement(0.5) since relevance is unknown.
 *
 * @param items - Validated items to score
 * @returns Scored items sorted by overall score descending, with ranks assigned
 */
export function fallbackScore(items: ValidatedItem[]): ScoredItem[] {
  // Handle empty input
  if (items.length === 0) {
    logVerbose('Fallback scoring: no items to score');
    return [];
  }

  logVerbose(`Fallback scoring: processing ${items.length} items`);

  // Score each item
  const scoredItems: ScoredItem[] = [];

  for (const item of items) {
    // Calculate individual scores
    const relevance = DEFAULT_RELEVANCE;

    // Authenticity: base + verification boost, capped at 100
    const verificationBoost = VERIFICATION_BOOSTS[item.validation.level];
    const authenticity = Math.min(100, BASE_AUTHENTICITY + verificationBoost);

    // Recency: calculated from publishedAt (handles missing dates)
    const recency = calculateRecencyScore(item.publishedAt);

    // Engagement: calculated from engagement metrics (handles zero engagement)
    const engagementPotential = calculateEngagementScore(
      item.engagement.likes,
      item.engagement.comments,
      item.engagement.shares
    );

    // Fallback overall formula: 50% recency + 50% engagement
    const overall = Math.round((recency * 0.5 + engagementPotential * 0.5) * 100) / 100;

    // Build scored item with placeholder rank (will be reassigned after sorting)
    // Note: Use rank: 1 as placeholder to pass schema validation, then reassign
    const scoredItem: ScoredItem = {
      ...item,
      scores: {
        relevance,
        authenticity,
        recency,
        engagementPotential,
        overall,
      },
      scoreReasoning: ['Scored using fallback heuristics'],
      rank: 1, // Placeholder - actual rank assigned after sorting
    };

    // Validate against schema
    const parseResult = ScoredItemSchema.safeParse(scoredItem);
    if (!parseResult.success) {
      logWarning(
        `Fallback scoring: item ${item.id} failed validation: ${parseResult.error.message}`
      );
      continue; // Skip invalid items
    }

    scoredItems.push(parseResult.data);
  }

  // MAJ-2 Fix: Error if all items failed validation
  if (scoredItems.length === 0 && items.length > 0) {
    throw new Error(
      `Fallback scoring: all ${items.length} items failed schema validation. ` +
        'Check item data for invalid fields.'
    );
  }

  // Sort by overall score descending
  scoredItems.sort((a, b) => b.scores.overall - a.scores.overall);

  // Assign ranks starting at 1
  for (let i = 0; i < scoredItems.length; i++) {
    scoredItems[i].rank = i + 1;
  }

  logVerbose(
    `Fallback scoring: scored ${scoredItems.length} items, ` +
      `top score: ${scoredItems[0]?.scores.overall ?? 'N/A'}`
  );

  return scoredItems;
}
