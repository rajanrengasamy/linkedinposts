import { z } from 'zod';
import { RawItemSchema } from './rawItem.js';

/**
 * Verification levels for content validation
 *
 * Levels indicate how thoroughly a quote/claim has been verified:
 * - UNVERIFIED: Could not find corroborating sources
 * - SOURCE_CONFIRMED: Found in 1 web source
 * - MULTISOURCE_CONFIRMED: Found in 2+ independent sources
 * - PRIMARY_SOURCE: Confirmed from original author/publication
 */
export const VerificationLevelSchema = z.enum([
  'UNVERIFIED',
  'SOURCE_CONFIRMED',
  'MULTISOURCE_CONFIRMED',
  'PRIMARY_SOURCE',
]);
export type VerificationLevel = z.infer<typeof VerificationLevelSchema>;

/**
 * Verification level score boosts for authenticity scoring
 * Used in scoring engine (Section 9)
 */
export const VERIFICATION_BOOSTS: Record<VerificationLevel, number> = {
  UNVERIFIED: 0,
  SOURCE_CONFIRMED: 25,
  MULTISOURCE_CONFIRMED: 50,
  PRIMARY_SOURCE: 75,
};

/**
 * Individual quote verification result
 */
export const QuoteVerifiedSchema = z.object({
  /** The exact quote text that was verified */
  quote: z.string().min(1),

  /** Whether the quote was successfully verified */
  verified: z.boolean(),

  /** Source URL where quote was found (if verified) */
  sourceUrl: z.string().url().optional(),
});
export type QuoteVerified = z.infer<typeof QuoteVerifiedSchema>;

/**
 * Validation metadata attached to each item after verification
 */
export const ValidationSchema = z.object({
  /** Overall verification level for this item */
  level: VerificationLevelSchema,

  /** Confidence score from 0.0 to 1.0 */
  confidence: z.number().min(0).max(1),

  /** When validation was performed (ISO 8601) */
  checkedAt: z.string().datetime(),

  /** URLs where content was found/verified */
  sourcesFound: z.array(z.string().url()),

  /** Brief bullet-point notes about verification (not full CoT) */
  notes: z.array(z.string()),

  /** Individual quote verification results */
  quotesVerified: z.array(QuoteVerifiedSchema),
});
export type Validation = z.infer<typeof ValidationSchema>;

/**
 * ValidatedItem Schema - RawItem with validation metadata
 *
 * Extends RawItem with verification results from the validation engine.
 * Items that fail validation are marked UNVERIFIED but still included.
 */
export const ValidatedItemSchema = RawItemSchema.extend({
  /** Validation results from verification engine */
  validation: ValidationSchema,
});

export type ValidatedItem = z.infer<typeof ValidatedItemSchema>;

/**
 * Helper to create an unverified validation object
 * Used when validation is skipped or fails
 */
export function createUnverifiedValidation(): Validation {
  return {
    level: 'UNVERIFIED',
    confidence: 0,
    checkedAt: new Date().toISOString(),
    sourcesFound: [],
    notes: ['Validation skipped or failed'],
    quotesVerified: [],
  };
}

/**
 * Determine verification level based on sources found
 */
export function assignVerificationLevel(
  sourcesFound: string[],
  isPrimarySource: boolean
): VerificationLevel {
  if (isPrimarySource) {
    return 'PRIMARY_SOURCE';
  }
  if (sourcesFound.length >= 2) {
    return 'MULTISOURCE_CONFIRMED';
  }
  if (sourcesFound.length === 1) {
    return 'SOURCE_CONFIRMED';
  }
  return 'UNVERIFIED';
}
