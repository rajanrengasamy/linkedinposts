/**
 * Claim Extraction Module
 *
 * Extracts grounded claims from scored items for synthesis.
 * Only includes claims from items with verification >= SOURCE_CONFIRMED.
 *
 * PROVENANCE RULE: No claim without sourceUrl - this is non-negotiable.
 */

import { z } from 'zod';
import type { ScoredItem, VerificationLevel } from '../types/index.js';
import { VerificationLevelSchema } from '../schemas/validatedItem.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import { sanitizePromptContent } from '../utils/sanitization.js';

// ============================================
// Extraction Threshold Constants (MAJ-13)
// ============================================

/**
 * Minimum word count for a quote to be considered substantive.
 * Filters out trivial quoted phrases like "yes" or "no thanks".
 */
const MIN_QUOTE_WORDS = 3;

/**
 * Minimum character count for a quote to be considered substantive.
 * Ensures quotes have enough content to be meaningful.
 */
const MIN_QUOTE_CHARS = 10;

/**
 * Minimum character count for an insight sentence to be extracted.
 * Short sentences typically lack enough context to be valuable.
 */
const MIN_INSIGHT_LENGTH = 30;

/**
 * Minimum character count for the first meaningful sentence fallback.
 * Used when no quotes, statistics, or insights are found.
 */
const MIN_FIRST_SENTENCE_LENGTH = 20;

/**
 * Minimum word count for the first meaningful sentence.
 * Ensures fallback sentences have enough substance.
 */
const MIN_FIRST_SENTENCE_WORDS = 5;

/**
 * Maximum length for claim text in prompts.
 * Claims are truncated to this length to prevent excessive prompt size.
 */
const MAX_CLAIM_LENGTH = 500;

/**
 * Maximum content length before applying regex patterns.
 * Prevents ReDoS attacks from extremely long content (MAJ-14).
 * Content longer than this is pre-truncated before regex matching.
 */
const MAX_REGEX_CONTENT_LENGTH = 10000;

/**
 * Maximum raw text length before sanitization.
 * Prevents DoS from processing extremely large inputs (MAJ-6).
 * Text longer than this is skipped entirely.
 */
const MAX_RAW_TEXT_LENGTH = 10000;

// ============================================
// Types and Schemas
// ============================================

/**
 * Claim types for categorization
 */
export const ClaimTypeSchema = z.enum(['quote', 'statistic', 'insight']);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

/**
 * A grounded claim extracted from a scored item.
 * Each claim MUST have a sourceUrl for provenance.
 */
export const GroundedClaimSchema = z.object({
  /** The claim text (quote, statistic, or insight) */
  claim: z.string().min(1),

  /** Type of claim for formatting purposes */
  type: ClaimTypeSchema,

  /** Author of the claim if known */
  author: z.string().optional(),

  /** Source URL where claim was found (REQUIRED) */
  sourceUrl: z.string().url(),

  /** Verification level from the source item */
  verificationLevel: VerificationLevelSchema,

  /** ID of the source ScoredItem for traceability */
  sourceItemId: z.string().uuid(),
});

export type GroundedClaim = z.infer<typeof GroundedClaimSchema>;

// ============================================
// Verification Level Helpers
// ============================================

/**
 * Verification levels that are considered sufficient for inclusion.
 * UNVERIFIED items are excluded from claims.
 */
const SUFFICIENT_VERIFICATION_LEVELS: VerificationLevel[] = [
  'SOURCE_CONFIRMED',
  'MULTISOURCE_CONFIRMED',
  'PRIMARY_SOURCE',
];

/**
 * Check if a verification level is sufficient for claim extraction.
 *
 * @param level - The verification level to check
 * @returns true if level is SOURCE_CONFIRMED, MULTISOURCE_CONFIRMED, or PRIMARY_SOURCE
 */
export function isVerificationSufficient(level: VerificationLevel): boolean {
  return SUFFICIENT_VERIFICATION_LEVELS.includes(level);
}

// ============================================
// Extraction Patterns (MIN-5: Inline regex comments)
// ============================================

/**
 * Pattern for extracting quoted text (double quotes)
 * Matches: "quoted text" or "quoted text" (curly quotes)
 *
 * Regex breakdown:
 *   [""]       - Match opening double quote (straight or curly)
 *   ([^""]+)   - Capture group: one or more chars that aren't double quotes
 *   [""]       - Match closing double quote (straight or curly)
 */
const DOUBLE_QUOTE_PATTERN = /[""]([^""]+)[""]/g;

/**
 * Pattern for extracting single-quoted text
 * Matches: 'quoted text' or 'quoted text' (curly quotes)
 *
 * Regex breakdown:
 *   ['']       - Match opening single quote (straight or curly)
 *   ([^'']+)   - Capture group: one or more chars that aren't single quotes
 *   ['']       - Match closing single quote (straight or curly)
 */
const SINGLE_QUOTE_PATTERN = /['']([^'']+)['']/g;

/**
 * Pattern for extracting percentage statistics
 * Matches: 75%, 3.5%, 100%
 *
 * Regex breakdown:
 *   \d+          - One or more digits
 *   (?:\.\d+)?   - Optional: decimal point followed by digits (non-capturing)
 *   %            - Literal percent sign
 */
const PERCENTAGE_PATTERN = /(\d+(?:\.\d+)?%)/g;

/**
 * Pattern for extracting dollar amounts
 * Matches: $1.5 million, $45 billion, $100, $1,234.56
 *
 * Regex breakdown:
 *   \$           - Literal dollar sign
 *   [\d,]+       - One or more digits or commas (e.g., 1,234)
 *   (?:\.\d+)?   - Optional: decimal point followed by digits
 *   (?:\s*(?:million|billion|trillion|M|B|T))?  - Optional: scale suffix with optional whitespace
 */
const DOLLAR_PATTERN = /\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|trillion|M|B|T))?/gi;

/**
 * Pattern for extracting large numbers with qualifiers
 * Matches: 10 million, 5.2 billion, 100 thousand
 *
 * Regex breakdown:
 *   (\d+(?:\.\d+)?)  - Capture group 1: number with optional decimal
 *   \s*              - Optional whitespace
 *   (million|billion|trillion|thousand)  - Capture group 2: scale word
 */
const LARGE_NUMBER_PATTERN = /(\d+(?:\.\d+)?)\s*(million|billion|trillion|thousand)/gi;

/**
 * Patterns for hasStatistic() detection - NO /g flag to avoid lastIndex issues (CODEX-MED-1)
 * These are used with .test() which advances lastIndex on global regexes, causing false negatives.
 */
const PERCENTAGE_TEST_PATTERN = /\d+(?:\.\d+)?%/i;
const DOLLAR_TEST_PATTERN = /\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|trillion|M|B|T))?/i;
const LARGE_NUMBER_TEST_PATTERN = /\d+(?:\.\d+)?\s*(?:million|billion|trillion|thousand)/i;

/**
 * Patterns indicating strong claims/insights.
 * Used to identify sentences that make definitive statements.
 */
const INSIGHT_INDICATORS = [
  /\b(?:research|study|survey|report)\s+(?:shows?|finds?|reveals?|indicates?)/i,
  /\b(?:according\s+to|experts?\s+say|data\s+shows?)/i,
  /\b(?:key\s+(?:finding|insight|takeaway)|important(?:ly)?|notably|significantly)/i,
  /\b(?:the\s+(?:main|primary|key)\s+(?:reason|factor|driver))/i,
  /\b(?:this\s+(?:means|suggests|implies|indicates))/i,
];

// ============================================
// Quote Extraction
// ============================================

/**
 * Extract quotes matching a specific pattern from content.
 *
 * Helper function to avoid code duplication between double-quote and
 * single-quote extraction (MAJ-10).
 *
 * @param content - The text content to search for quotes
 * @param pattern - The regex pattern to match quotes (must have capture group)
 * @param seenQuotes - Set of already-seen quotes (normalized) to avoid duplicates
 * @param item - Source item for building claims
 * @returns Array of grounded claims with type 'quote'
 *
 * @example
 * ```typescript
 * const seen = new Set<string>();
 * const claims = extractQuotesWithPattern(content, DOUBLE_QUOTE_PATTERN, seen, item);
 * ```
 */
function extractQuotesWithPattern(
  content: string,
  pattern: RegExp,
  seenQuotes: Set<string>,
  item: ScoredItem
): GroundedClaim[] {
  const claims: GroundedClaim[] = [];
  const matches = content.matchAll(pattern);

  for (const match of matches) {
    const quote = match[1].trim();

    // MAJ-6: Skip excessively long raw text before sanitization to prevent DoS
    if (quote.length > MAX_RAW_TEXT_LENGTH) {
      logVerbose(`Skipping quote: raw text too long (${quote.length} chars)`);
      continue;
    }

    // Only include substantive quotes (MIN_QUOTE_WORDS and MIN_QUOTE_CHARS)
    if (quote.split(/\s+/).length >= MIN_QUOTE_WORDS && quote.length >= MIN_QUOTE_CHARS) {
      const normalized = quote.toLowerCase();
      if (!seenQuotes.has(normalized)) {
        seenQuotes.add(normalized);
        const sanitized = sanitizePromptContent(quote, MAX_CLAIM_LENGTH);
        const claim = buildClaim(sanitized, 'quote', item);
        if (claim) {
          claims.push(claim);
          logVerbose(`Extracted quote: "${sanitized.slice(0, 50)}..."`);
        }
      }
    }
  }

  return claims;
}

/**
 * Extract quoted statements from a scored item.
 * Handles both double and single quotes.
 *
 * MAJ-14: Content is pre-truncated to MAX_REGEX_CONTENT_LENGTH to prevent ReDoS.
 *
 * @param item - Scored item to extract quotes from
 * @returns Array of grounded claims with type 'quote'
 */
export function extractQuotes(item: ScoredItem): GroundedClaim[] {
  // MAJ-14: Pre-truncate content to prevent ReDoS from long strings
  const content = item.content.length > MAX_REGEX_CONTENT_LENGTH
    ? item.content.slice(0, MAX_REGEX_CONTENT_LENGTH)
    : item.content;

  const seenQuotes = new Set<string>();

  // Extract double-quoted text
  const doubleQuotes = extractQuotesWithPattern(content, DOUBLE_QUOTE_PATTERN, seenQuotes, item);

  // Extract single-quoted text (seenQuotes already contains double-quote matches)
  const singleQuotes = extractQuotesWithPattern(content, SINGLE_QUOTE_PATTERN, seenQuotes, item);

  return [...doubleQuotes, ...singleQuotes];
}

// ============================================
// Statistics Extraction
// ============================================

/**
 * Extract statistical claims from a scored item.
 * Includes percentages, dollar amounts, and large numbers with context.
 *
 * MAJ-14: Content is pre-truncated to MAX_REGEX_CONTENT_LENGTH to prevent ReDoS.
 *
 * @param item - Scored item to extract statistics from
 * @returns Array of grounded claims with type 'statistic'
 */
export function extractStatistics(item: ScoredItem): GroundedClaim[] {
  const claims: GroundedClaim[] = [];
  // MAJ-14: Pre-truncate content to prevent ReDoS from long strings
  const content = item.content.length > MAX_REGEX_CONTENT_LENGTH
    ? item.content.slice(0, MAX_REGEX_CONTENT_LENGTH)
    : item.content;
  const seen = new Set<string>();

  // Extract percentages with surrounding context
  const percentMatches = content.matchAll(PERCENTAGE_PATTERN);
  for (const match of percentMatches) {
    const stat = extractStatContext(content, match.index ?? 0, match[0]);
    if (stat && !seen.has(stat.toLowerCase())) {
      seen.add(stat.toLowerCase());
      const sanitized = sanitizePromptContent(stat, MAX_CLAIM_LENGTH);
      const claim = buildClaim(sanitized, 'statistic', item);
      if (claim) {
        claims.push(claim);
        logVerbose(`Extracted statistic: "${sanitized.slice(0, 50)}..."`);
      }
    }
  }

  // Extract dollar amounts with context
  const dollarMatches = content.matchAll(DOLLAR_PATTERN);
  for (const match of dollarMatches) {
    const stat = extractStatContext(content, match.index ?? 0, match[0]);
    if (stat && !seen.has(stat.toLowerCase())) {
      seen.add(stat.toLowerCase());
      const sanitized = sanitizePromptContent(stat, MAX_CLAIM_LENGTH);
      const claim = buildClaim(sanitized, 'statistic', item);
      if (claim) {
        claims.push(claim);
        logVerbose(`Extracted statistic: "${sanitized.slice(0, 50)}..."`);
      }
    }
  }

  // Extract large numbers (millions/billions/thousands)
  const largeNumberMatches = content.matchAll(LARGE_NUMBER_PATTERN);
  for (const match of largeNumberMatches) {
    const stat = extractStatContext(content, match.index ?? 0, match[0]);
    if (stat && !seen.has(stat.toLowerCase())) {
      seen.add(stat.toLowerCase());
      const sanitized = sanitizePromptContent(stat, MAX_CLAIM_LENGTH);
      const claim = buildClaim(sanitized, 'statistic', item);
      if (claim) {
        claims.push(claim);
        logVerbose(`Extracted statistic: "${sanitized.slice(0, 50)}..."`);
      }
    }
  }

  return claims;
}

/**
 * Extract context around a statistic for a more meaningful claim.
 * Gets the surrounding sentence or phrase.
 */
function extractStatContext(
  content: string,
  matchIndex: number,
  matchText: string
): string | null {
  // Find sentence boundaries
  const sentenceStart = findSentenceStart(content, matchIndex);
  const sentenceEnd = findSentenceEnd(content, matchIndex + matchText.length);

  const sentence = content.slice(sentenceStart, sentenceEnd).trim();

  // MAJ-6: Skip excessively long sentences to prevent DoS
  if (sentence.length > MAX_RAW_TEXT_LENGTH) {
    return null;
  }

  // Only return if sentence is meaningful (not just the stat)
  if (sentence.length > matchText.length + 10) {
    return sentence;
  }

  return null;
}

/**
 * Find the start of a sentence containing the given index.
 */
function findSentenceStart(content: string, index: number): number {
  // Look backwards for sentence end punctuation
  for (let i = index - 1; i >= 0; i--) {
    if (content[i] === '.' || content[i] === '!' || content[i] === '?') {
      // Skip if this is part of a number (e.g., 3.5%)
      if (i > 0 && /\d/.test(content[i - 1]) && /\d/.test(content[i + 1])) {
        continue;
      }
      return i + 1;
    }
    // Also break at newlines
    if (content[i] === '\n') {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Find the end of a sentence containing the given index.
 */
function findSentenceEnd(content: string, index: number): number {
  for (let i = index; i < content.length; i++) {
    if (content[i] === '.' || content[i] === '!' || content[i] === '?') {
      // Skip if this is part of a number
      if (
        i > 0 &&
        /\d/.test(content[i - 1]) &&
        i + 1 < content.length &&
        /\d/.test(content[i + 1])
      ) {
        continue;
      }
      return i + 1;
    }
    if (content[i] === '\n') {
      return i;
    }
  }
  return content.length;
}

// ============================================
// Insight Extraction
// ============================================

/**
 * Extract key insights from a scored item.
 *
 * Finds sentences that make strong claims or present key findings,
 * but are not quotes or statistics.
 *
 * MAJ-14: Content is pre-truncated to MAX_REGEX_CONTENT_LENGTH to prevent ReDoS.
 *
 * @param item - Scored item to extract insights from
 * @returns Array of grounded claims with type 'insight'
 */
export function extractInsights(item: ScoredItem): GroundedClaim[] {
  const claims: GroundedClaim[] = [];
  // MAJ-14: Pre-truncate content to prevent ReDoS from long strings
  const content = item.content.length > MAX_REGEX_CONTENT_LENGTH
    ? item.content.slice(0, MAX_REGEX_CONTENT_LENGTH)
    : item.content;
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();

    // Skip short sentences (MIN_INSIGHT_LENGTH threshold)
    if (trimmedSentence.length < MIN_INSIGHT_LENGTH) {
      continue;
    }

    // MAJ-6: Skip excessively long sentences to prevent DoS
    if (trimmedSentence.length > MAX_RAW_TEXT_LENGTH) {
      continue;
    }

    // Skip if it looks like a quote (starts with quote marks)
    if (/^["'"']/.test(trimmedSentence)) {
      continue;
    }

    // Skip if it contains statistics (already captured by extractStatistics)
    if (hasStatistic(trimmedSentence)) {
      continue;
    }

    // Check if sentence contains insight indicators
    let isInsight = false;
    for (const indicator of INSIGHT_INDICATORS) {
      if (indicator.test(trimmedSentence)) {
        isInsight = true;
        break;
      }
    }

    if (!isInsight) {
      continue;
    }

    const sanitized = sanitizePromptContent(trimmedSentence, MAX_CLAIM_LENGTH);
    const claim = buildClaim(sanitized, 'insight', item);
    if (claim) {
      claims.push(claim);
      logVerbose(`Extracted insight: "${sanitized.slice(0, 50)}..."`);
    }
  }

  return claims;
}

/**
 * Check if a sentence contains statistical patterns.
 *
 * Uses non-global regex patterns to avoid stateful .test() behavior.
 * Global regexes with .test() advance lastIndex, causing false negatives
 * on subsequent calls (CODEX-MED-1).
 *
 * @param sentence - The sentence to check for statistics
 * @returns true if the sentence contains percentage, dollar, or large number patterns
 */
function hasStatistic(sentence: string): boolean {
  return (
    PERCENTAGE_TEST_PATTERN.test(sentence) ||
    DOLLAR_TEST_PATTERN.test(sentence) ||
    LARGE_NUMBER_TEST_PATTERN.test(sentence)
  );
}

/**
 * Patterns indicating Call-To-Action sentences that should be skipped.
 * CTAs are not substantive content suitable for claims.
 */
const CTA_PATTERNS = [
  /\b(?:click|subscribe|sign\s*up|follow|share|like|comment)\b/i,
  /\b(?:learn\s+more|read\s+more|find\s+out|check\s+out)\b/i,
  /\b(?:don'?t\s+miss|join\s+us|get\s+started)\b/i,
];

/**
 * Check if a sentence is a Call-To-Action that should be skipped.
 *
 * @param sentence - The sentence to check
 * @returns true if the sentence matches CTA patterns
 */
function isCallToAction(sentence: string): boolean {
  return CTA_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Extract the first meaningful sentence from content.
 * Used as fallback when no quotes, statistics, or insights found.
 *
 * Quality checks (MIN-1):
 * - Skips sentences that are CTAs (e.g., "Click here to learn more")
 * - Requires minimum word count for substance
 * - Requires minimum character length
 *
 * @param content - The content to extract from
 * @returns The first meaningful sentence, or null if none found
 *
 * @example
 * ```typescript
 * const sentence = extractFirstMeaningfulSentence(article.content);
 * if (sentence) {
 *   // Use as fallback insight
 * }
 * ```
 */
function extractFirstMeaningfulSentence(content: string): string | null {
  // Split on sentence boundaries, filter by minimum length
  const sentences = content
    .split(/[.!?]+/)
    .filter((s) => s.trim().length >= MIN_FIRST_SENTENCE_LENGTH);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    // Skip CTAs - they don't provide substantive content
    if (isCallToAction(trimmed)) {
      continue;
    }

    // Check minimum word count for substance
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount < MIN_FIRST_SENTENCE_WORDS) {
      continue;
    }

    // Found a valid sentence - limit length for readability
    if (trimmed.length > 200) {
      return trimmed.slice(0, 200) + '...';
    }
    return trimmed;
  }

  return null;
}

// ============================================
// Claim Building Helper
// ============================================

/**
 * Build and validate a grounded claim.
 *
 * @param claimText - The claim text
 * @param type - Type of claim
 * @param item - Source item
 * @returns Validated GroundedClaim or null if validation fails
 */
function buildClaim(
  claimText: string,
  type: ClaimType,
  item: ScoredItem
): GroundedClaim | null {
  const claim: GroundedClaim = {
    claim: claimText,
    type,
    author: item.author,
    sourceUrl: item.sourceUrl,
    verificationLevel: item.validation.level,
    sourceItemId: item.id,
  };

  const result = GroundedClaimSchema.safeParse(claim);
  if (result.success) {
    return result.data;
  }

  // MAJ-4: Log validation failures for debugging
  const errorMessages = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join(', ');
  logWarning(
    `buildClaim validation failed for item ${item.id}: ${errorMessages}. ` +
      `Claim text: "${claimText.slice(0, 50)}..."`
  );

  return null;
}

// ============================================
// Main Extraction Function
// ============================================

/**
 * Extract grounded claims from scored items.
 *
 * Filters items by verification level, then extracts:
 * - Quoted statements (type: 'quote')
 * - Statistics and data points (type: 'statistic')
 * - Key insights from content (type: 'insight')
 *
 * PROVENANCE RULE: Every claim includes sourceUrl from the source item.
 * Items without sourceUrl or with UNVERIFIED level are skipped.
 *
 * @param items - Scored items to extract claims from
 * @returns Array of grounded claims with provenance
 */
export function extractGroundedClaims(items: ScoredItem[]): GroundedClaim[] {
  // Handle empty input
  if (items.length === 0) {
    logWarning('extractGroundedClaims: Empty items array provided');
    return [];
  }

  const claims: GroundedClaim[] = [];
  let skippedNoUrl = 0;
  let skippedUnverified = 0;

  for (const item of items) {
    // Filter: only items with sufficient verification
    if (!isVerificationSufficient(item.validation.level)) {
      skippedUnverified++;
      logVerbose(
        `Skipping item ${item.id}: verification level ${item.validation.level} insufficient`
      );
      continue;
    }

    // Must have sourceUrl - REQUIRED
    if (!item.sourceUrl) {
      skippedNoUrl++;
      logWarning(`Skipping item ${item.id}: missing required sourceUrl`);
      continue;
    }

    // Extract quotes
    const quotes = extractQuotes(item);
    claims.push(...quotes);

    // Extract statistics
    const statistics = extractStatistics(item);
    claims.push(...statistics);

    // Extract insights (sentences with strong claims)
    const insights = extractInsights(item);
    claims.push(...insights);

    // Fallback: if nothing extracted, use first meaningful sentence
    if (quotes.length === 0 && statistics.length === 0 && insights.length === 0) {
      const firstSentence = extractFirstMeaningfulSentence(item.content);
      if (firstSentence) {
        const sanitized = sanitizePromptContent(firstSentence, MAX_CLAIM_LENGTH);
        const claim = buildClaim(sanitized, 'insight', item);
        if (claim) {
          claims.push(claim);
          logVerbose(`Extracted fallback insight: "${sanitized.slice(0, 50)}..."`);
        }
      }
    }
  }

  // Log summary
  logVerbose(
    `extractGroundedClaims: extracted ${claims.length} claims from ${items.length} items`
  );
  if (skippedNoUrl > 0) {
    logWarning(`Skipped ${skippedNoUrl} items without sourceUrl`);
  }
  if (skippedUnverified > 0) {
    logVerbose(`Skipped ${skippedUnverified} items with insufficient verification`);
  }

  return claims;
}

/**
 * Extract grounded claims with validation that results are non-empty.
 *
 * Wraps extractGroundedClaims with validation to ensure claims were extracted.
 * Use this when empty results should be treated as an error condition.
 *
 * @param items - Scored items to extract claims from
 * @param minClaims - Minimum required claims (default: 1)
 * @returns Array of grounded claims
 * @throws Error if fewer than minClaims are extracted (MAJ-3)
 */
export function extractGroundedClaimsOrThrow(
  items: ScoredItem[],
  minClaims: number = 1
): GroundedClaim[] {
  const claims = extractGroundedClaims(items);

  if (claims.length < minClaims) {
    const verifiedCount = items.filter(
      (item) => isVerificationSufficient(item.validation.level) && item.sourceUrl
    ).length;

    throw new Error(
      `FATAL: Insufficient claims extracted. Got ${claims.length}, need ${minClaims}. ` +
        `Input: ${items.length} items, ${verifiedCount} verified with URLs. ` +
        `Check that items have sufficient content for claim extraction.`
    );
  }

  return claims;
}

// ============================================
// Utility Functions (MAJ-9: Complete JSDoc)
// ============================================

/**
 * Group claims by their type for synthesis processing.
 *
 * Creates a record mapping each claim type to an array of claims of that type.
 * Useful for processing different claim types separately during synthesis.
 *
 * @param claims - Array of grounded claims to group
 * @returns Record mapping each ClaimType to its claims array
 *
 * @example
 * ```typescript
 * const grouped = groupClaimsByType(claims);
 * console.log(`Quotes: ${grouped.quote.length}`);
 * console.log(`Statistics: ${grouped.statistic.length}`);
 * console.log(`Insights: ${grouped.insight.length}`);
 * ```
 */
export function groupClaimsByType(
  claims: GroundedClaim[]
): Record<ClaimType, GroundedClaim[]> {
  return {
    quote: claims.filter((c) => c.type === 'quote'),
    statistic: claims.filter((c) => c.type === 'statistic'),
    insight: claims.filter((c) => c.type === 'insight'),
  };
}

/**
 * Filter claims to only include those of a specific type.
 *
 * @param claims - Array of grounded claims to filter
 * @param type - The claim type to filter by ('quote', 'statistic', or 'insight')
 * @returns Array containing only claims of the specified type
 *
 * @example
 * ```typescript
 * const quotes = filterClaimsByType(claims, 'quote');
 * const stats = filterClaimsByType(claims, 'statistic');
 * ```
 */
export function filterClaimsByType(
  claims: GroundedClaim[],
  type: ClaimType
): GroundedClaim[] {
  return claims.filter((c) => c.type === type);
}

/**
 * Extract unique source URLs from a collection of claims.
 *
 * Deduplicates URLs to get a list of all unique sources referenced.
 * Useful for counting sources or building source attribution lists.
 *
 * @param claims - Array of grounded claims
 * @returns Array of unique source URLs (no duplicates)
 *
 * @example
 * ```typescript
 * const urls = getUniqueSourceUrls(claims);
 * console.log(`Claims reference ${urls.length} unique sources`);
 * ```
 */
export function getUniqueSourceUrls(claims: GroundedClaim[]): string[] {
  return [...new Set(claims.map((c) => c.sourceUrl))];
}

/**
 * Count claims grouped by their verification level.
 *
 * Provides a breakdown of how many claims exist at each verification level.
 * Useful for quality assessment and trust metrics.
 *
 * @param claims - Array of grounded claims to count
 * @returns Record mapping each VerificationLevel to its count
 *
 * @example
 * ```typescript
 * const counts = countByVerificationLevel(claims);
 * console.log(`Primary sources: ${counts.PRIMARY_SOURCE}`);
 * console.log(`Multi-source confirmed: ${counts.MULTISOURCE_CONFIRMED}`);
 * ```
 */
export function countByVerificationLevel(
  claims: GroundedClaim[]
): Record<VerificationLevel, number> {
  const counts: Record<VerificationLevel, number> = {
    UNVERIFIED: 0,
    SOURCE_CONFIRMED: 0,
    MULTISOURCE_CONFIRMED: 0,
    PRIMARY_SOURCE: 0,
  };

  for (const claim of claims) {
    counts[claim.verificationLevel]++;
  }

  return counts;
}

/**
 * Group claims by their verification level.
 *
 * Creates a record mapping each verification level to an array of claims
 * at that level. Useful for prioritizing claims by trust level during synthesis.
 *
 * @param claims - Array of grounded claims to group
 * @returns Record mapping each VerificationLevel to its claims array
 *
 * @example
 * ```typescript
 * const byLevel = groupClaimsByVerificationLevel(claims);
 * // Prioritize primary sources
 * const primaryClaims = byLevel.PRIMARY_SOURCE;
 * const confirmedClaims = byLevel.MULTISOURCE_CONFIRMED;
 * ```
 */
export function groupClaimsByVerificationLevel(
  claims: GroundedClaim[]
): Record<VerificationLevel, GroundedClaim[]> {
  const grouped: Record<VerificationLevel, GroundedClaim[]> = {
    UNVERIFIED: [],
    SOURCE_CONFIRMED: [],
    MULTISOURCE_CONFIRMED: [],
    PRIMARY_SOURCE: [],
  };

  for (const claim of claims) {
    grouped[claim.verificationLevel].push(claim);
  }

  return grouped;
}
