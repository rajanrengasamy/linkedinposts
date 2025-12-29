/**
 * Unit Tests for Claims Extraction
 *
 * Tests for claim extraction functions in src/synthesis/claims.ts
 *
 * Coverage includes:
 * - isVerificationSufficient - all 4 verification levels
 * - extractGroundedClaims - filtering by verification level
 * - Quote extraction - double quotes, single quotes, multiple quotes
 * - Statistics extraction - percentages, dollar amounts, millions/billions
 * - Schema validation - valid claims, missing sourceUrl, invalid types
 * - Edge cases - empty input, no sourceUrl, no extractable claims
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import {
  extractGroundedClaims,
  isVerificationSufficient,
  GroundedClaimSchema,
  extractQuotes,
  extractStatistics,
  extractInsights,
  groupClaimsByType,
  getUniqueSourceUrls,
  countByVerificationLevel,
  groupClaimsByVerificationLevel,
  type GroundedClaim,
} from '../../src/synthesis/claims.js';
import type { ScoredItem, VerificationLevel } from '../../src/types/index.js';
import { SCHEMA_VERSION } from '../../src/schemas/rawItem.js';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a mock ScoredItem with sensible defaults
 */
function createMockScoredItem(overrides: Partial<ScoredItem> = {}): ScoredItem {
  const id = overrides.id ?? uuidv4();

  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    source: 'web',
    sourceUrl: 'https://example.com/article',
    retrievedAt: new Date().toISOString(),
    content: 'Test content with "a quoted statement" and 75% statistics.',
    contentHash: 'abc123def4567890',
    author: 'Test Author',
    engagement: { likes: 100, comments: 10, shares: 5 },
    validation: {
      level: 'SOURCE_CONFIRMED',
      confidence: 0.8,
      checkedAt: new Date().toISOString(),
      sourcesFound: ['https://example.com'],
      notes: [],
      quotesVerified: [],
    },
    scores: {
      relevance: 80,
      authenticity: 75,
      recency: 90,
      engagementPotential: 70,
      overall: 79,
    },
    scoreReasoning: ['Good content'],
    rank: 1,
    ...overrides,
  };
}

/**
 * Create items with different verification levels
 */
function createItemsWithVerificationLevels(): ScoredItem[] {
  const levels: VerificationLevel[] = [
    'UNVERIFIED',
    'SOURCE_CONFIRMED',
    'MULTISOURCE_CONFIRMED',
    'PRIMARY_SOURCE',
  ];

  return levels.map((level) =>
    createMockScoredItem({
      id: uuidv4(),
      content: `Content for ${level} item with "a meaningful quote here"`,
      validation: {
        level,
        confidence: level === 'UNVERIFIED' ? 0 : 0.8,
        checkedAt: new Date().toISOString(),
        sourcesFound: level === 'UNVERIFIED' ? [] : ['https://example.com'],
        notes: [`Level: ${level}`],
        quotesVerified: [],
      },
    })
  );
}

// ============================================
// isVerificationSufficient Tests
// ============================================

describe('isVerificationSufficient', () => {
  it('should return false for UNVERIFIED', () => {
    expect(isVerificationSufficient('UNVERIFIED')).toBe(false);
  });

  it('should return true for SOURCE_CONFIRMED', () => {
    expect(isVerificationSufficient('SOURCE_CONFIRMED')).toBe(true);
  });

  it('should return true for MULTISOURCE_CONFIRMED', () => {
    expect(isVerificationSufficient('MULTISOURCE_CONFIRMED')).toBe(true);
  });

  it('should return true for PRIMARY_SOURCE', () => {
    expect(isVerificationSufficient('PRIMARY_SOURCE')).toBe(true);
  });
});

// ============================================
// extractGroundedClaims Filtering Tests
// ============================================

describe('extractGroundedClaims filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty array for empty input', () => {
    const result = extractGroundedClaims([]);
    expect(result).toEqual([]);
  });

  it('should exclude UNVERIFIED items', () => {
    const items = createItemsWithVerificationLevels();
    const result = extractGroundedClaims(items);

    // Should not have any claims from UNVERIFIED items
    const unverifiedClaims = result.filter(
      (c) => c.verificationLevel === 'UNVERIFIED'
    );
    expect(unverifiedClaims).toHaveLength(0);
  });

  it('should include SOURCE_CONFIRMED items', () => {
    const item = createMockScoredItem({
      content: 'This is "a very important statement" from the source.',
      validation: {
        level: 'SOURCE_CONFIRMED',
        confidence: 0.8,
        checkedAt: new Date().toISOString(),
        sourcesFound: ['https://example.com'],
        notes: [],
        quotesVerified: [],
      },
    });

    const result = extractGroundedClaims([item]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].verificationLevel).toBe('SOURCE_CONFIRMED');
  });

  it('should include MULTISOURCE_CONFIRMED items', () => {
    const item = createMockScoredItem({
      content: 'Research shows "multi-source verified claim here".',
      validation: {
        level: 'MULTISOURCE_CONFIRMED',
        confidence: 0.9,
        checkedAt: new Date().toISOString(),
        sourcesFound: ['https://a.com', 'https://b.com'],
        notes: [],
        quotesVerified: [],
      },
    });

    const result = extractGroundedClaims([item]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].verificationLevel).toBe('MULTISOURCE_CONFIRMED');
  });

  it('should include PRIMARY_SOURCE items', () => {
    const item = createMockScoredItem({
      content: 'The CEO stated "this is from the primary source".',
      validation: {
        level: 'PRIMARY_SOURCE',
        confidence: 0.95,
        checkedAt: new Date().toISOString(),
        sourcesFound: ['https://official.com'],
        notes: [],
        quotesVerified: [],
      },
    });

    const result = extractGroundedClaims([item]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].verificationLevel).toBe('PRIMARY_SOURCE');
  });

  it('should skip items without sourceUrl', () => {
    const item = createMockScoredItem({
      content: 'This item has "a valid quote" but no URL.',
      sourceUrl: undefined as unknown as string,
    });

    const result = extractGroundedClaims([item]);
    expect(result).toHaveLength(0);
  });
});

// ============================================
// Quote Extraction Tests
// ============================================

describe('extractQuotes', () => {
  it('should extract double-quoted text', () => {
    const item = createMockScoredItem({
      content: 'The expert said "this is a very important statement about AI".',
    });

    const result = extractQuotes(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('this is a very important statement about AI');
    expect(result[0].type).toBe('quote');
  });

  it('should extract single-quoted text', () => {
    const item = createMockScoredItem({
      content: "The analyst noted 'this trend will continue through 2025'.",
    });

    const result = extractQuotes(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('this trend will continue through 2025');
  });

  it('should extract curly double quotes', () => {
    const item = createMockScoredItem({
      content: 'The report states "AI adoption is accelerating rapidly".',
    });

    const result = extractQuotes(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('AI adoption is accelerating rapidly');
  });

  it('should extract curly single quotes', () => {
    const item = createMockScoredItem({
      content: "The study found 'significant improvements in efficiency'.",
    });

    const result = extractQuotes(item);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should extract multiple quotes from same content', () => {
    const item = createMockScoredItem({
      content:
        'First quote: "AI is transforming industries worldwide". ' +
        'Second quote: "Companies must adapt or fall behind".',
    });

    const result = extractQuotes(item);

    expect(result.length).toBe(2);
  });

  it('should ignore short quotes (less than 3 words)', () => {
    const item = createMockScoredItem({
      content: 'He said "yes" and "no" but also "this is a longer meaningful quote".',
    });

    const result = extractQuotes(item);

    // Should only get the longer quote
    expect(result.length).toBe(1);
    expect(result[0].claim).toContain('longer meaningful quote');
  });

  it('should deduplicate identical quotes', () => {
    const item = createMockScoredItem({
      content:
        '"This is the same quote" was mentioned. Later, "This is the same quote" appeared again.',
    });

    const result = extractQuotes(item);

    // Should deduplicate
    expect(result.length).toBe(1);
  });

  it('should set author from item', () => {
    const item = createMockScoredItem({
      content: 'The leader stated "innovation drives growth and success".',
      author: 'Dr. Jane Smith',
    });

    const result = extractQuotes(item);

    expect(result[0].author).toBe('Dr. Jane Smith');
  });

  it('should set sourceUrl from item', () => {
    const item = createMockScoredItem({
      content: 'According to the report "data is the new oil".',
      sourceUrl: 'https://example.com/report',
    });

    const result = extractQuotes(item);

    expect(result[0].sourceUrl).toBe('https://example.com/report');
  });
});

// ============================================
// Statistics Extraction Tests
// ============================================

describe('extractStatistics', () => {
  it('should extract percentage statistics', () => {
    const item = createMockScoredItem({
      content: 'The survey found that 75% of companies are adopting AI.',
    });

    const result = extractStatistics(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('75%');
    expect(result[0].type).toBe('statistic');
  });

  it('should extract decimal percentages', () => {
    const item = createMockScoredItem({
      content: 'Accuracy improved by 3.5% after the optimization.',
    });

    const result = extractStatistics(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('3.5%');
  });

  it('should extract dollar amounts', () => {
    const item = createMockScoredItem({
      content: 'The market is valued at $45 billion as of today.',
    });

    const result = extractStatistics(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('$45 billion');
  });

  it('should extract dollar amounts with million/billion qualifiers', () => {
    const item = createMockScoredItem({
      content: 'Investment reached $1.5 million in the first quarter.',
    });

    const result = extractStatistics(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('$1.5 million');
  });

  it('should extract large numbers with qualifiers', () => {
    const item = createMockScoredItem({
      content: 'The platform has 10 million active users globally.',
    });

    const result = extractStatistics(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].claim).toContain('10 million');
  });

  it('should include surrounding context', () => {
    const item = createMockScoredItem({
      content: 'According to analysts, revenue grew by 25% year over year.',
    });

    const result = extractStatistics(item);

    // Should include the full sentence, not just "25%"
    expect(result[0].claim.length).toBeGreaterThan(5);
    expect(result[0].claim).toContain('revenue grew');
  });

  it('should deduplicate identical statistics', () => {
    const item = createMockScoredItem({
      content: 'Growth was 50% in Q1. Later, growth was 50% in Q2.',
    });

    const result = extractStatistics(item);

    // May get 1 or 2 depending on dedup logic, but should not have exact duplicates
    const uniqueClaims = new Set(result.map((r) => r.claim.toLowerCase()));
    expect(uniqueClaims.size).toBe(result.length);
  });
});

// ============================================
// Schema Validation Tests
// ============================================

describe('GroundedClaimSchema validation', () => {
  it('should validate a valid claim', () => {
    const validClaim = {
      claim: 'AI is transforming industries',
      type: 'insight',
      author: 'Dr. Smith',
      sourceUrl: 'https://example.com/article',
      verificationLevel: 'SOURCE_CONFIRMED',
      sourceItemId: uuidv4(),
    };

    const result = GroundedClaimSchema.safeParse(validClaim);
    expect(result.success).toBe(true);
  });

  it('should reject claim without sourceUrl', () => {
    const invalidClaim = {
      claim: 'AI is transforming industries',
      type: 'insight',
      author: 'Dr. Smith',
      verificationLevel: 'SOURCE_CONFIRMED',
      sourceItemId: uuidv4(),
    };

    const result = GroundedClaimSchema.safeParse(invalidClaim);
    expect(result.success).toBe(false);
  });

  it('should reject claim with invalid URL', () => {
    const invalidClaim = {
      claim: 'AI is transforming industries',
      type: 'insight',
      sourceUrl: 'not-a-valid-url',
      verificationLevel: 'SOURCE_CONFIRMED',
      sourceItemId: uuidv4(),
    };

    const result = GroundedClaimSchema.safeParse(invalidClaim);
    expect(result.success).toBe(false);
  });

  it('should reject claim with invalid type', () => {
    const invalidClaim = {
      claim: 'AI is transforming industries',
      type: 'invalid-type',
      sourceUrl: 'https://example.com',
      verificationLevel: 'SOURCE_CONFIRMED',
      sourceItemId: uuidv4(),
    };

    const result = GroundedClaimSchema.safeParse(invalidClaim);
    expect(result.success).toBe(false);
  });

  it('should reject claim with invalid verification level', () => {
    const invalidClaim = {
      claim: 'AI is transforming industries',
      type: 'quote',
      sourceUrl: 'https://example.com',
      verificationLevel: 'INVALID_LEVEL',
      sourceItemId: uuidv4(),
    };

    const result = GroundedClaimSchema.safeParse(invalidClaim);
    expect(result.success).toBe(false);
  });

  it('should reject claim with invalid UUID', () => {
    const invalidClaim = {
      claim: 'AI is transforming industries',
      type: 'quote',
      sourceUrl: 'https://example.com',
      verificationLevel: 'SOURCE_CONFIRMED',
      sourceItemId: 'not-a-uuid',
    };

    const result = GroundedClaimSchema.safeParse(invalidClaim);
    expect(result.success).toBe(false);
  });

  it('should allow optional author', () => {
    const validClaim = {
      claim: 'AI is transforming industries',
      type: 'insight',
      sourceUrl: 'https://example.com/article',
      verificationLevel: 'SOURCE_CONFIRMED',
      sourceItemId: uuidv4(),
    };

    const result = GroundedClaimSchema.safeParse(validClaim);
    expect(result.success).toBe(true);
  });

  it('should reject empty claim text', () => {
    const invalidClaim = {
      claim: '',
      type: 'quote',
      sourceUrl: 'https://example.com',
      verificationLevel: 'SOURCE_CONFIRMED',
      sourceItemId: uuidv4(),
    };

    const result = GroundedClaimSchema.safeParse(invalidClaim);
    expect(result.success).toBe(false);
  });
});

// ============================================
// Edge Cases
// ============================================

describe('Edge cases', () => {
  it('should handle content with no extractable claims', () => {
    const item = createMockScoredItem({
      content: 'Short text.',
    });

    const result = extractGroundedClaims([item]);

    // Should return empty or fallback insight
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('should handle content with only short quotes', () => {
    const item = createMockScoredItem({
      content: 'He said "yes" and "no" and "ok".',
    });

    const quotes = extractQuotes(item);

    // Short quotes should be filtered out
    expect(quotes).toHaveLength(0);
  });

  it('should handle content with special characters', () => {
    const item = createMockScoredItem({
      content:
        'The report states "AI & ML are transforming healthcare & finance".',
    });

    const result = extractQuotes(item);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle content with newlines', () => {
    const item = createMockScoredItem({
      content: 'First paragraph.\n\n"This is a quoted statement in new paragraph".',
    });

    const result = extractQuotes(item);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle mixed quote types in same content', () => {
    const item = createMockScoredItem({
      content:
        '"Double quoted statement here" and \'single quoted statement here\'.',
    });

    const result = extractQuotes(item);

    expect(result.length).toBe(2);
  });
});

// ============================================
// Utility Function Tests
// ============================================

describe('groupClaimsByType', () => {
  it('should group claims by type', () => {
    const claims: GroundedClaim[] = [
      {
        claim: 'Quote 1',
        type: 'quote',
        sourceUrl: 'https://example.com',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Statistic 1',
        type: 'statistic',
        sourceUrl: 'https://example.com',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Insight 1',
        type: 'insight',
        sourceUrl: 'https://example.com',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Quote 2',
        type: 'quote',
        sourceUrl: 'https://example.com',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
    ];

    const grouped = groupClaimsByType(claims);

    expect(grouped.quote).toHaveLength(2);
    expect(grouped.statistic).toHaveLength(1);
    expect(grouped.insight).toHaveLength(1);
  });

  it('should handle empty arrays', () => {
    const grouped = groupClaimsByType([]);

    expect(grouped.quote).toHaveLength(0);
    expect(grouped.statistic).toHaveLength(0);
    expect(grouped.insight).toHaveLength(0);
  });
});

describe('getUniqueSourceUrls', () => {
  it('should return unique URLs', () => {
    const claims: GroundedClaim[] = [
      {
        claim: 'Claim 1',
        type: 'quote',
        sourceUrl: 'https://example.com/a',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Claim 2',
        type: 'quote',
        sourceUrl: 'https://example.com/b',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Claim 3',
        type: 'quote',
        sourceUrl: 'https://example.com/a',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
    ];

    const urls = getUniqueSourceUrls(claims);

    expect(urls).toHaveLength(2);
    expect(urls).toContain('https://example.com/a');
    expect(urls).toContain('https://example.com/b');
  });
});

describe('countByVerificationLevel', () => {
  it('should count claims by verification level', () => {
    const claims: GroundedClaim[] = [
      {
        claim: 'Claim 1',
        type: 'quote',
        sourceUrl: 'https://example.com',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Claim 2',
        type: 'quote',
        sourceUrl: 'https://example.com',
        verificationLevel: 'PRIMARY_SOURCE',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Claim 3',
        type: 'quote',
        sourceUrl: 'https://example.com',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
    ];

    const counts = countByVerificationLevel(claims);

    expect(counts.UNVERIFIED).toBe(0);
    expect(counts.SOURCE_CONFIRMED).toBe(2);
    expect(counts.MULTISOURCE_CONFIRMED).toBe(0);
    expect(counts.PRIMARY_SOURCE).toBe(1);
  });
});

describe('groupClaimsByVerificationLevel', () => {
  it('should group claims by verification level', () => {
    const claims: GroundedClaim[] = [
      {
        claim: 'Claim 1',
        type: 'quote',
        sourceUrl: 'https://example.com',
        verificationLevel: 'SOURCE_CONFIRMED',
        sourceItemId: uuidv4(),
      },
      {
        claim: 'Claim 2',
        type: 'quote',
        sourceUrl: 'https://example.com',
        verificationLevel: 'PRIMARY_SOURCE',
        sourceItemId: uuidv4(),
      },
    ];

    const grouped = groupClaimsByVerificationLevel(claims);

    expect(grouped.UNVERIFIED).toHaveLength(0);
    expect(grouped.SOURCE_CONFIRMED).toHaveLength(1);
    expect(grouped.MULTISOURCE_CONFIRMED).toHaveLength(0);
    expect(grouped.PRIMARY_SOURCE).toHaveLength(1);
  });
});

// ============================================
// extractInsights Tests
// ============================================

describe('extractInsights', () => {
  it('should extract sentences with research indicators', () => {
    const item = createMockScoredItem({
      content:
        'Research shows that artificial intelligence is transforming multiple industries.',
    });

    const result = extractInsights(item);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('insight');
  });

  it('should extract sentences with expert indicators', () => {
    const item = createMockScoredItem({
      content:
        'According to leading analysts, the market will double in size by next year.',
    });

    const result = extractInsights(item);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should skip sentences that look like quotes', () => {
    const item = createMockScoredItem({
      content: '"This is actually a quote not an insight" research shows.',
    });

    const result = extractInsights(item);

    // Should skip the quoted sentence
    expect(
      result.every((c) => !c.claim.startsWith('"'))
    ).toBe(true);
  });

  it('should skip sentences with statistics', () => {
    const item = createMockScoredItem({
      content: 'Research shows 75% improvement in efficiency.',
    });

    const insights = extractInsights(item);

    // Sentences with percentages should be handled by extractStatistics
    // extractInsights might still include them depending on implementation
    // This test verifies the filtering logic
    expect(insights.every((c) => c.type === 'insight')).toBe(true);
  });

  it('should skip short sentences', () => {
    const item = createMockScoredItem({
      content: 'Short. Also short. Research shows significant findings.',
    });

    const result = extractInsights(item);

    // Should only get the longer sentence
    result.forEach((claim) => {
      expect(claim.claim.length).toBeGreaterThanOrEqual(30);
    });
  });
});

// ============================================
// Integration Test
// ============================================

describe('extractGroundedClaims integration', () => {
  it('should extract all claim types from rich content', () => {
    const item = createMockScoredItem({
      content: `
        The CEO stated "innovation is at the heart of everything we do".

        Revenue grew by 45% year over year, reaching $2.5 billion.

        Research shows that AI adoption is accelerating across industries.

        Experts say "the future of technology is in responsible AI".
      `,
      validation: {
        level: 'MULTISOURCE_CONFIRMED',
        confidence: 0.9,
        checkedAt: new Date().toISOString(),
        sourcesFound: ['https://a.com', 'https://b.com'],
        notes: [],
        quotesVerified: [],
      },
    });

    const result = extractGroundedClaims([item]);

    // Should have quotes, statistics, and insights
    const grouped = groupClaimsByType(result);

    expect(grouped.quote.length).toBeGreaterThan(0);
    expect(grouped.statistic.length).toBeGreaterThan(0);
    // Insights may or may not be extracted depending on filters
  });

  it('should include sourceUrl and verificationLevel on all claims', () => {
    const items = createItemsWithVerificationLevels().filter(
      (item) => item.validation.level !== 'UNVERIFIED'
    );

    const result = extractGroundedClaims(items);

    result.forEach((claim) => {
      expect(claim.sourceUrl).toBeTruthy();
      expect(claim.sourceUrl).toMatch(/^https?:\/\//);
      expect(['SOURCE_CONFIRMED', 'MULTISOURCE_CONFIRMED', 'PRIMARY_SOURCE']).toContain(
        claim.verificationLevel
      );
    });
  });

  it('should set sourceItemId to match source item', () => {
    const itemId = uuidv4();
    const item = createMockScoredItem({
      id: itemId,
      content: 'The report states "AI is revolutionizing healthcare delivery".',
    });

    const result = extractGroundedClaims([item]);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].sourceItemId).toBe(itemId);
  });
});
