/**
 * Unit Tests for Zod Schemas
 *
 * Comprehensive tests for all schema definitions in src/schemas/:
 * - RawItemSchema (src/schemas/rawItem.ts)
 * - ValidatedItemSchema (src/schemas/validatedItem.ts)
 * - ScoredItemSchema (src/schemas/scoredItem.ts)
 * - SynthesisResultSchema (src/schemas/synthesisResult.ts)
 * - Validation helpers (src/schemas/index.ts)
 */

import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import {
  // RawItem exports
  SCHEMA_VERSION,
  SourceTypeSchema,
  EngagementSchema,
  RawItemSchema,
  createDefaultEngagement,
  type RawItem,
  type Engagement,

  // ValidatedItem exports
  VerificationLevelSchema,
  VERIFICATION_BOOSTS,
  QuoteVerifiedSchema,
  ValidationSchema,
  ValidatedItemSchema,
  createUnverifiedValidation,
  assignVerificationLevel,
  type VerificationLevel,
  type Validation,
  type ValidatedItem,

  // ScoredItem exports
  SCORING_WEIGHTS,
  ScoresSchema,
  ScoredItemSchema,
  calculateOverallScore,
  calculateRecencyScore,
  calculateEngagementScore,
  type ScoredItem,

  // SynthesisResult exports
  LINKEDIN_POST_MAX_LENGTH,
  LINKEDIN_HASHTAGS_MIN,
  LINKEDIN_HASHTAGS_MAX,
  InfographicStyleSchema,
  KeyQuoteSchema,
  InfographicBriefSchema,
  FactCheckSummarySchema,
  CostBreakdownSchema,
  SynthesisMetadataSchema,
  SynthesisResultSchema,
  GPTSynthesisResponseSchema,
  createEmptyCostBreakdown,
  calculateTotalCost,
  type SynthesisResult,

  // Validation helpers
  parseModelResponse,
  validateOrThrow,
  tryValidate,
  parseAndValidate,
  formatZodError,
  JsonParseError,
  SchemaValidationError,
  isFixableParseError,
} from '../../src/schemas/index.js';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a valid RawItem for testing
 */
function createValidRawItem(overrides?: Partial<RawItem>): RawItem {
  return {
    id: uuidv4(),
    schemaVersion: SCHEMA_VERSION,
    source: 'web',
    sourceUrl: 'https://example.com/article',
    retrievedAt: new Date().toISOString(),
    content: 'Test content about AI and technology trends',
    contentHash: 'a1b2c3d4e5f67890',
    engagement: { likes: 100, comments: 10, shares: 5 },
    ...overrides,
  };
}

/**
 * Create a valid ValidatedItem for testing
 */
function createValidValidatedItem(overrides?: Partial<ValidatedItem>): ValidatedItem {
  return {
    ...createValidRawItem(),
    validation: {
      level: 'SOURCE_CONFIRMED',
      confidence: 0.85,
      checkedAt: new Date().toISOString(),
      sourcesFound: ['https://example.com/source1'],
      notes: ['Verified from web source'],
      quotesVerified: [],
    },
    ...overrides,
  };
}

/**
 * Create a valid ScoredItem for testing
 */
function createValidScoredItem(overrides?: Partial<ScoredItem>): ScoredItem {
  return {
    ...createValidValidatedItem(),
    scores: {
      relevance: 80,
      authenticity: 75,
      recency: 90,
      engagementPotential: 70,
      overall: 79.25,
    },
    scoreReasoning: ['High relevance to topic', 'Recent content'],
    rank: 1,
    ...overrides,
  };
}

/**
 * Create a valid SynthesisResult for testing
 */
function createValidSynthesisResult(overrides?: Partial<SynthesisResult>): SynthesisResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    prompt: 'AI leadership quotes for 2025',
    linkedinPost: 'Here is a great LinkedIn post about AI trends in 2025...',
    keyQuotes: [
      {
        quote: 'AI will transform every industry',
        author: 'Satya Nadella',
        sourceUrl: 'https://microsoft.com/blog/ai',
        verificationLevel: 'SOURCE_CONFIRMED',
      },
    ],
    infographicBrief: {
      title: 'AI Trends 2025',
      keyPoints: ['Point 1', 'Point 2', 'Point 3'],
      suggestedStyle: 'minimal',
    },
    factCheckSummary: {
      totalSourcesUsed: 5,
      verifiedQuotes: 3,
      unverifiedClaims: 1,
      primarySources: 2,
      warnings: [],
    },
    metadata: {
      sourcesUsed: 5,
      processingTimeMs: 12500,
      estimatedCost: {
        perplexity: 0.01,
        gemini: 0.005,
        openai: 0.02,
        nanoBanana: 0.05,
        total: 0.085,
      },
    },
    ...overrides,
  };
}

// ============================================
// RawItemSchema Tests
// ============================================

describe('RawItemSchema', () => {
  describe('valid items', () => {
    it('validates correct raw item with all required fields', () => {
      const item = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('validates item with optional fields', () => {
      const item = createValidRawItem({
        author: 'John Doe',
        title: 'Test Article',
        publishedAt: new Date().toISOString(),
        citations: ['https://example.com/cite1', 'https://example.com/cite2'],
        authorHandle: '@johndoe',
        authorUrl: 'https://twitter.com/johndoe',
      });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('validates all source types', () => {
      const sources: Array<'web' | 'linkedin' | 'x'> = ['web', 'linkedin', 'x'];
      for (const source of sources) {
        const item = createValidRawItem({ source });
        expect(RawItemSchema.safeParse(item).success).toBe(true);
      }
    });
  });

  describe('missing required fields', () => {
    it('rejects missing id', () => {
      const { id: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects missing source', () => {
      const { source: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects missing sourceUrl', () => {
      const { sourceUrl: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects missing content', () => {
      const { content: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects missing contentHash', () => {
      const { contentHash: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects missing engagement', () => {
      const { engagement: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects missing retrievedAt', () => {
      const { retrievedAt: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects missing schemaVersion', () => {
      const { schemaVersion: _, ...item } = createValidRawItem();
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('invalid URL formats', () => {
    it('rejects invalid sourceUrl', () => {
      const item = createValidRawItem({ sourceUrl: 'not-a-url' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects sourceUrl without protocol', () => {
      const item = createValidRawItem({ sourceUrl: 'example.com/page' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects empty sourceUrl', () => {
      const item = createValidRawItem({ sourceUrl: '' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects invalid authorUrl', () => {
      const item = createValidRawItem({ authorUrl: 'not-a-url' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects invalid citation URLs', () => {
      const item = createValidRawItem({ citations: ['not-a-url'] });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('invalid UUID formats', () => {
    it('rejects non-UUID id', () => {
      const item = createValidRawItem({ id: 'not-a-uuid' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects empty id', () => {
      const item = createValidRawItem({ id: '' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects malformed UUID', () => {
      const item = createValidRawItem({ id: '12345-abcde-67890' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('accepts valid UUID v4', () => {
      const item = createValidRawItem({ id: '550e8400-e29b-41d4-a716-446655440000' });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe('invalid source types', () => {
    it('rejects unknown source type', () => {
      const item = createValidRawItem({ source: 'facebook' as unknown as 'web' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects numeric source type', () => {
      const item = createValidRawItem({ source: 123 as unknown as 'web' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects empty source type', () => {
      const item = createValidRawItem({ source: '' as unknown as 'web' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('optional fields', () => {
    it('accepts missing author', () => {
      const item = createValidRawItem();
      delete (item as { author?: string }).author;
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts missing title', () => {
      const item = createValidRawItem();
      delete (item as { title?: string }).title;
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts missing publishedAt', () => {
      const item = createValidRawItem();
      delete (item as { publishedAt?: string }).publishedAt;
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts missing citations', () => {
      const item = createValidRawItem();
      delete (item as { citations?: string[] }).citations;
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts empty citations array', () => {
      const item = createValidRawItem({ citations: [] });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe('contentHash validation', () => {
    it('accepts valid 16-char hex hash', () => {
      const item = createValidRawItem({ contentHash: 'a1b2c3d4e5f67890' });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects hash with uppercase letters', () => {
      const item = createValidRawItem({ contentHash: 'A1B2C3D4E5F67890' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects hash with invalid characters', () => {
      const item = createValidRawItem({ contentHash: 'g1h2i3j4k5l67890' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects hash too short', () => {
      const item = createValidRawItem({ contentHash: 'a1b2c3d4' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects hash too long', () => {
      const item = createValidRawItem({ contentHash: 'a1b2c3d4e5f6789012345678' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects empty hash', () => {
      const item = createValidRawItem({ contentHash: '' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('content validation', () => {
    it('rejects empty content', () => {
      const item = createValidRawItem({ content: '' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('accepts content with one character', () => {
      const item = createValidRawItem({ content: 'X' });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts very long content', () => {
      const item = createValidRawItem({ content: 'A'.repeat(100000) });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe('engagement validation', () => {
    it('accepts zero engagement values', () => {
      const item = createValidRawItem({
        engagement: { likes: 0, comments: 0, shares: 0 },
      });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects negative engagement values', () => {
      const item = createValidRawItem({
        engagement: { likes: -1, comments: 0, shares: 0 },
      });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects float engagement values', () => {
      const item = createValidRawItem({
        engagement: { likes: 1.5, comments: 0, shares: 0 },
      });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('accepts optional engagement fields', () => {
      const item = createValidRawItem({
        engagement: {
          likes: 100,
          comments: 10,
          shares: 5,
          retweets: 20,
          impressions: 5000,
        },
      });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe('datetime validation', () => {
    it('accepts valid ISO 8601 retrievedAt', () => {
      const item = createValidRawItem({ retrievedAt: '2025-01-15T10:30:00.000Z' });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects invalid retrievedAt format', () => {
      const item = createValidRawItem({ retrievedAt: '2025-01-15' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });

    it('accepts valid ISO 8601 publishedAt', () => {
      const item = createValidRawItem({ publishedAt: '2025-01-15T10:30:00.000Z' });
      expect(RawItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects invalid publishedAt format', () => {
      const item = createValidRawItem({ publishedAt: 'invalid-date' });
      expect(RawItemSchema.safeParse(item).success).toBe(false);
    });
  });
});

// ============================================
// SourceTypeSchema Tests
// ============================================

describe('SourceTypeSchema', () => {
  it('accepts web source', () => {
    expect(SourceTypeSchema.safeParse('web').success).toBe(true);
  });

  it('accepts linkedin source', () => {
    expect(SourceTypeSchema.safeParse('linkedin').success).toBe(true);
  });

  it('accepts x source', () => {
    expect(SourceTypeSchema.safeParse('x').success).toBe(true);
  });

  it('rejects twitter (use x instead)', () => {
    expect(SourceTypeSchema.safeParse('twitter').success).toBe(false);
  });

  it('rejects unknown sources', () => {
    expect(SourceTypeSchema.safeParse('facebook').success).toBe(false);
    expect(SourceTypeSchema.safeParse('instagram').success).toBe(false);
  });
});

// ============================================
// EngagementSchema Tests
// ============================================

describe('EngagementSchema', () => {
  it('validates minimum engagement', () => {
    const engagement = { likes: 0, comments: 0, shares: 0 };
    expect(EngagementSchema.safeParse(engagement).success).toBe(true);
  });

  it('validates high engagement', () => {
    const engagement = { likes: 1000000, comments: 50000, shares: 25000 };
    expect(EngagementSchema.safeParse(engagement).success).toBe(true);
  });

  it('validates with X-specific fields', () => {
    const engagement = {
      likes: 100,
      comments: 10,
      shares: 5,
      retweets: 20,
      quotes: 3,
      replies: 15,
      impressions: 10000,
    };
    expect(EngagementSchema.safeParse(engagement).success).toBe(true);
  });

  it('validates with LinkedIn-specific fields', () => {
    const engagement = {
      likes: 100,
      comments: 10,
      shares: 5,
      reactions: 150,
    };
    expect(EngagementSchema.safeParse(engagement).success).toBe(true);
  });

  it('rejects missing required field', () => {
    const engagement = { likes: 100, comments: 10 }; // missing shares
    expect(EngagementSchema.safeParse(engagement).success).toBe(false);
  });

  it('rejects negative optional fields', () => {
    const engagement = {
      likes: 100,
      comments: 10,
      shares: 5,
      impressions: -100,
    };
    expect(EngagementSchema.safeParse(engagement).success).toBe(false);
  });
});

// ============================================
// createDefaultEngagement Tests
// ============================================

describe('createDefaultEngagement', () => {
  it('creates valid engagement with zeros', () => {
    const engagement = createDefaultEngagement();
    expect(EngagementSchema.safeParse(engagement).success).toBe(true);
  });

  it('has all required fields set to zero', () => {
    const engagement = createDefaultEngagement();
    expect(engagement.likes).toBe(0);
    expect(engagement.comments).toBe(0);
    expect(engagement.shares).toBe(0);
  });
});

// ============================================
// ValidatedItemSchema Tests
// ============================================

describe('ValidatedItemSchema', () => {
  describe('extends RawItem correctly', () => {
    it('validates item with validation field added', () => {
      const item = createValidValidatedItem();
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects item missing validation field', () => {
      const rawItem = createValidRawItem();
      expect(ValidatedItemSchema.safeParse(rawItem).success).toBe(false);
    });

    it('preserves all RawItem fields', () => {
      const item = createValidValidatedItem({
        author: 'Jane Doe',
        title: 'Important Article',
        citations: ['https://cite.com/1'],
      });
      const result = ValidatedItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.author).toBe('Jane Doe');
        expect(result.data.title).toBe('Important Article');
        expect(result.data.citations).toHaveLength(1);
      }
    });
  });

  describe('verification levels', () => {
    it('validates UNVERIFIED level', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'UNVERIFIED',
          confidence: 0,
          checkedAt: new Date().toISOString(),
          sourcesFound: [],
          notes: ['Could not verify'],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('validates SOURCE_CONFIRMED level', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.7,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source1.com'],
          notes: ['Found in one source'],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('validates MULTISOURCE_CONFIRMED level', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'MULTISOURCE_CONFIRMED',
          confidence: 0.9,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source1.com', 'https://source2.com'],
          notes: ['Found in multiple sources'],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('validates PRIMARY_SOURCE level', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'PRIMARY_SOURCE',
          confidence: 0.95,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://original-author.com'],
          notes: ['Confirmed from original source'],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects invalid verification level', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SUPER_VERIFIED' as VerificationLevel,
          confidence: 0.5,
          checkedAt: new Date().toISOString(),
          sourcesFound: [],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('confidence validation', () => {
    it('accepts confidence of 0.0', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'UNVERIFIED',
          confidence: 0.0,
          checkedAt: new Date().toISOString(),
          sourcesFound: [],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts confidence of 1.0', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'PRIMARY_SOURCE',
          confidence: 1.0,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://primary.com'],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts confidence of 0.5', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.5,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source.com'],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects confidence below 0', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'UNVERIFIED',
          confidence: -0.1,
          checkedAt: new Date().toISOString(),
          sourcesFound: [],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects confidence above 1', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'PRIMARY_SOURCE',
          confidence: 1.1,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://primary.com'],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('quotesVerified structure', () => {
    it('validates empty quotesVerified array', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.8,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source.com'],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('validates verified quote with sourceUrl', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.8,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source.com'],
          notes: [],
          quotesVerified: [
            {
              quote: 'AI is transforming everything',
              verified: true,
              sourceUrl: 'https://source.com/quote',
            },
          ],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('validates unverified quote without sourceUrl', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.8,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source.com'],
          notes: [],
          quotesVerified: [
            {
              quote: 'Could not verify this quote',
              verified: false,
            },
          ],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects verified quote without sourceUrl (provenance rule)', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.8,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source.com'],
          notes: [],
          quotesVerified: [
            {
              quote: 'AI is transforming everything',
              verified: true,
              // Missing sourceUrl - should fail
            },
          ],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(false);
    });

    it('validates multiple quotes', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'MULTISOURCE_CONFIRMED',
          confidence: 0.9,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source1.com', 'https://source2.com'],
          notes: [],
          quotesVerified: [
            { quote: 'Quote 1', verified: true, sourceUrl: 'https://s1.com' },
            { quote: 'Quote 2', verified: true, sourceUrl: 'https://s2.com' },
            { quote: 'Quote 3', verified: false },
          ],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe('sourcesFound validation with verification level', () => {
    it('rejects SOURCE_CONFIRMED with empty sourcesFound', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.8,
          checkedAt: new Date().toISOString(),
          sourcesFound: [], // Should have at least 1
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects MULTISOURCE_CONFIRMED with only 1 source', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'MULTISOURCE_CONFIRMED',
          confidence: 0.9,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://only-one.com'], // Should have at least 2
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects PRIMARY_SOURCE with empty sourcesFound', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'PRIMARY_SOURCE',
          confidence: 0.95,
          checkedAt: new Date().toISOString(),
          sourcesFound: [], // Should have at least 1
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(false);
    });

    it('accepts UNVERIFIED with empty sourcesFound', () => {
      const item = createValidValidatedItem({
        validation: {
          level: 'UNVERIFIED',
          confidence: 0,
          checkedAt: new Date().toISOString(),
          sourcesFound: [],
          notes: [],
          quotesVerified: [],
        },
      });
      expect(ValidatedItemSchema.safeParse(item).success).toBe(true);
    });
  });
});

// ============================================
// VerificationLevelSchema Tests
// ============================================

describe('VerificationLevelSchema', () => {
  it('accepts all valid levels', () => {
    const levels = ['UNVERIFIED', 'SOURCE_CONFIRMED', 'MULTISOURCE_CONFIRMED', 'PRIMARY_SOURCE'];
    for (const level of levels) {
      expect(VerificationLevelSchema.safeParse(level).success).toBe(true);
    }
  });

  it('rejects invalid levels', () => {
    expect(VerificationLevelSchema.safeParse('UNKNOWN').success).toBe(false);
    expect(VerificationLevelSchema.safeParse('verified').success).toBe(false);
    expect(VerificationLevelSchema.safeParse('').success).toBe(false);
  });
});

// ============================================
// VERIFICATION_BOOSTS Tests
// ============================================

describe('VERIFICATION_BOOSTS', () => {
  it('has correct boost values', () => {
    expect(VERIFICATION_BOOSTS.UNVERIFIED).toBe(0);
    expect(VERIFICATION_BOOSTS.SOURCE_CONFIRMED).toBe(25);
    expect(VERIFICATION_BOOSTS.MULTISOURCE_CONFIRMED).toBe(50);
    expect(VERIFICATION_BOOSTS.PRIMARY_SOURCE).toBe(75);
  });

  it('has ascending boost order', () => {
    expect(VERIFICATION_BOOSTS.UNVERIFIED).toBeLessThan(VERIFICATION_BOOSTS.SOURCE_CONFIRMED);
    expect(VERIFICATION_BOOSTS.SOURCE_CONFIRMED).toBeLessThan(VERIFICATION_BOOSTS.MULTISOURCE_CONFIRMED);
    expect(VERIFICATION_BOOSTS.MULTISOURCE_CONFIRMED).toBeLessThan(VERIFICATION_BOOSTS.PRIMARY_SOURCE);
  });
});

// ============================================
// createUnverifiedValidation Tests
// ============================================

describe('createUnverifiedValidation', () => {
  it('creates valid unverified validation', () => {
    const validation = createUnverifiedValidation();
    expect(ValidationSchema.safeParse(validation).success).toBe(true);
  });

  it('sets level to UNVERIFIED', () => {
    const validation = createUnverifiedValidation();
    expect(validation.level).toBe('UNVERIFIED');
  });

  it('sets confidence to 0', () => {
    const validation = createUnverifiedValidation();
    expect(validation.confidence).toBe(0);
  });

  it('has empty sourcesFound', () => {
    const validation = createUnverifiedValidation();
    expect(validation.sourcesFound).toHaveLength(0);
  });
});

// ============================================
// assignVerificationLevel Tests
// ============================================

describe('assignVerificationLevel', () => {
  it('returns PRIMARY_SOURCE when isPrimarySource is true', () => {
    expect(assignVerificationLevel(['https://primary.com'], true)).toBe('PRIMARY_SOURCE');
  });

  it('returns MULTISOURCE_CONFIRMED with 2+ sources', () => {
    expect(assignVerificationLevel(['https://a.com', 'https://b.com'], false)).toBe('MULTISOURCE_CONFIRMED');
  });

  it('returns SOURCE_CONFIRMED with 1 source', () => {
    expect(assignVerificationLevel(['https://source.com'], false)).toBe('SOURCE_CONFIRMED');
  });

  it('returns UNVERIFIED with 0 sources', () => {
    expect(assignVerificationLevel([], false)).toBe('UNVERIFIED');
  });

  it('PRIMARY_SOURCE takes precedence over source count', () => {
    expect(assignVerificationLevel(['https://a.com', 'https://b.com', 'https://c.com'], true)).toBe('PRIMARY_SOURCE');
  });
});

// ============================================
// ScoredItemSchema Tests
// ============================================

describe('ScoredItemSchema', () => {
  describe('extends ValidatedItem correctly', () => {
    it('validates item with scores, scoreReasoning, and rank', () => {
      const item = createValidScoredItem();
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects item missing scores', () => {
      const { scores: _, ...item } = createValidScoredItem();
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects item missing scoreReasoning', () => {
      const { scoreReasoning: _, ...item } = createValidScoredItem();
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects item missing rank', () => {
      const { rank: _, ...item } = createValidScoredItem();
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('score value validation (0-100)', () => {
    it('accepts all scores at 0', () => {
      const item = createValidScoredItem({
        scores: {
          relevance: 0,
          authenticity: 0,
          recency: 0,
          engagementPotential: 0,
          overall: 0,
        },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts all scores at 100', () => {
      const item = createValidScoredItem({
        scores: {
          relevance: 100,
          authenticity: 100,
          recency: 100,
          engagementPotential: 100,
          overall: 100,
        },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts scores at boundary 50', () => {
      const item = createValidScoredItem({
        scores: {
          relevance: 50,
          authenticity: 50,
          recency: 50,
          engagementPotential: 50,
          overall: 50,
        },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects relevance below 0', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, relevance: -1 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects relevance above 100', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, relevance: 101 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects authenticity below 0', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, authenticity: -5 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects authenticity above 100', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, authenticity: 150 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects recency below 0', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, recency: -10 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects engagementPotential above 100', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, engagementPotential: 200 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects overall below 0', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, overall: -0.5 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects overall above 100', () => {
      const item = createValidScoredItem({
        scores: { ...createValidScoredItem().scores, overall: 100.1 },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('accepts decimal scores within range', () => {
      const item = createValidScoredItem({
        scores: {
          relevance: 85.5,
          authenticity: 70.25,
          recency: 99.99,
          engagementPotential: 0.01,
          overall: 65.43,
        },
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });
  });

  describe('rank validation', () => {
    it('accepts rank of 1', () => {
      const item = createValidScoredItem({ rank: 1 });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts high rank', () => {
      const item = createValidScoredItem({ rank: 100 });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('rejects rank of 0', () => {
      const item = createValidScoredItem({ rank: 0 });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects negative rank', () => {
      const item = createValidScoredItem({ rank: -1 });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });

    it('rejects non-integer rank', () => {
      const item = createValidScoredItem({ rank: 1.5 });
      expect(ScoredItemSchema.safeParse(item).success).toBe(false);
    });
  });

  describe('scoreReasoning array', () => {
    it('accepts empty scoreReasoning array', () => {
      const item = createValidScoredItem({ scoreReasoning: [] });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts single reason', () => {
      const item = createValidScoredItem({ scoreReasoning: ['High relevance'] });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });

    it('accepts multiple reasons', () => {
      const item = createValidScoredItem({
        scoreReasoning: ['High relevance', 'Verified sources', 'Recent content', 'Good engagement'],
      });
      expect(ScoredItemSchema.safeParse(item).success).toBe(true);
    });
  });
});

// ============================================
// ScoresSchema Tests
// ============================================

describe('ScoresSchema', () => {
  it('validates complete scores object', () => {
    const scores = {
      relevance: 80,
      authenticity: 75,
      recency: 90,
      engagementPotential: 70,
      overall: 79.25,
    };
    expect(ScoresSchema.safeParse(scores).success).toBe(true);
  });

  it('rejects missing fields', () => {
    const scores = {
      relevance: 80,
      authenticity: 75,
      // missing recency, engagementPotential, overall
    };
    expect(ScoresSchema.safeParse(scores).success).toBe(false);
  });
});

// ============================================
// SCORING_WEIGHTS Tests
// ============================================

describe('SCORING_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const sum =
      SCORING_WEIGHTS.relevance +
      SCORING_WEIGHTS.authenticity +
      SCORING_WEIGHTS.recency +
      SCORING_WEIGHTS.engagementPotential;
    expect(sum).toBeCloseTo(1.0);
  });

  it('has correct individual weights', () => {
    expect(SCORING_WEIGHTS.relevance).toBe(0.35);
    expect(SCORING_WEIGHTS.authenticity).toBe(0.30);
    expect(SCORING_WEIGHTS.recency).toBe(0.20);
    expect(SCORING_WEIGHTS.engagementPotential).toBe(0.15);
  });
});

// ============================================
// calculateOverallScore Tests
// ============================================

describe('calculateOverallScore', () => {
  it('calculates correctly with all 100s', () => {
    const scores = {
      relevance: 100,
      authenticity: 100,
      recency: 100,
      engagementPotential: 100,
    };
    expect(calculateOverallScore(scores)).toBe(100);
  });

  it('calculates correctly with all 0s', () => {
    const scores = {
      relevance: 0,
      authenticity: 0,
      recency: 0,
      engagementPotential: 0,
    };
    expect(calculateOverallScore(scores)).toBe(0);
  });

  it('applies weights correctly', () => {
    const scores = {
      relevance: 100,
      authenticity: 0,
      recency: 0,
      engagementPotential: 0,
    };
    expect(calculateOverallScore(scores)).toBeCloseTo(35);
  });

  it('calculates weighted average correctly', () => {
    const scores = {
      relevance: 80,
      authenticity: 70,
      recency: 90,
      engagementPotential: 60,
    };
    // 80*0.35 + 70*0.30 + 90*0.20 + 60*0.15 = 28 + 21 + 18 + 9 = 76
    expect(calculateOverallScore(scores)).toBeCloseTo(76);
  });
});

// ============================================
// calculateRecencyScore Tests
// ============================================

describe('calculateRecencyScore', () => {
  it('returns 100 for items within 24 hours', () => {
    const now = new Date();
    expect(calculateRecencyScore(now.toISOString())).toBe(100);
  });

  it('returns 10 for items older than 7 days', () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(calculateRecencyScore(oldDate.toISOString())).toBe(10);
  });

  it('returns 50 for undefined dates', () => {
    expect(calculateRecencyScore(undefined)).toBe(50);
  });

  it('returns 50 for invalid date strings', () => {
    expect(calculateRecencyScore('invalid-date')).toBe(50);
    expect(calculateRecencyScore('not-a-date')).toBe(50);
    expect(calculateRecencyScore('')).toBe(50);
  });

  it('decays between 1 and 7 days', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const score = calculateRecencyScore(threeDaysAgo.toISOString());
    expect(score).toBeGreaterThan(10);
    expect(score).toBeLessThan(100);
  });
});

// ============================================
// calculateEngagementScore Tests
// ============================================

describe('calculateEngagementScore', () => {
  it('returns 0 for zero engagement', () => {
    expect(calculateEngagementScore(0, 0, 0)).toBe(0);
  });

  it('caps at 100 for high engagement', () => {
    expect(calculateEngagementScore(1000000, 100000, 50000)).toBeLessThanOrEqual(100);
  });

  it('weights shares more than comments', () => {
    const sharesOnly = calculateEngagementScore(0, 0, 100);
    const commentsOnly = calculateEngagementScore(0, 100, 0);
    expect(sharesOnly).toBeGreaterThan(commentsOnly);
  });

  it('weights comments more than likes', () => {
    const commentsOnly = calculateEngagementScore(0, 100, 0);
    const likesOnly = calculateEngagementScore(100, 0, 0);
    expect(commentsOnly).toBeGreaterThan(likesOnly);
  });

  it('handles negative values gracefully', () => {
    const score = calculateEngagementScore(-5, 10, 2);
    expect(score).not.toBeNaN();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('treats negative values as zero', () => {
    const allNegative = calculateEngagementScore(-10, -5, -3);
    expect(allNegative).toBe(0);
  });
});

// ============================================
// SynthesisResultSchema Tests
// ============================================

describe('SynthesisResultSchema', () => {
  describe('valid synthesis results', () => {
    it('validates complete synthesis result', () => {
      const result = createValidSynthesisResult();
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('validates result with empty keyQuotes array', () => {
      const result = createValidSynthesisResult({ keyQuotes: [] });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('validates result with empty warnings', () => {
      const result = createValidSynthesisResult({
        factCheckSummary: {
          ...createValidSynthesisResult().factCheckSummary,
          warnings: [],
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('linkedinPost validation', () => {
    it('requires non-empty linkedinPost', () => {
      const result = createValidSynthesisResult({ linkedinPost: '' });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('accepts post at max length', () => {
      const result = createValidSynthesisResult({
        linkedinPost: 'A'.repeat(LINKEDIN_POST_MAX_LENGTH),
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('rejects post exceeding max length', () => {
      const result = createValidSynthesisResult({
        linkedinPost: 'A'.repeat(LINKEDIN_POST_MAX_LENGTH + 1),
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });
  });

  describe('keyQuotes structure', () => {
    it('requires sourceUrl for each quote', () => {
      const result = createValidSynthesisResult({
        keyQuotes: [
          {
            quote: 'Test quote',
            author: 'Author',
            sourceUrl: 'https://source.com',
            verificationLevel: 'SOURCE_CONFIRMED',
          },
        ],
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('rejects quote missing sourceUrl', () => {
      const result = createValidSynthesisResult({
        keyQuotes: [
          {
            quote: 'Test quote',
            author: 'Author',
            verificationLevel: 'SOURCE_CONFIRMED',
          } as unknown as { quote: string; author: string; sourceUrl: string; verificationLevel: VerificationLevel },
        ],
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects quote with empty quote text', () => {
      const result = createValidSynthesisResult({
        keyQuotes: [
          {
            quote: '',
            author: 'Author',
            sourceUrl: 'https://source.com',
            verificationLevel: 'SOURCE_CONFIRMED',
          },
        ],
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects quote with empty author', () => {
      const result = createValidSynthesisResult({
        keyQuotes: [
          {
            quote: 'Test quote',
            author: '',
            sourceUrl: 'https://source.com',
            verificationLevel: 'SOURCE_CONFIRMED',
          },
        ],
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects quote with invalid sourceUrl', () => {
      const result = createValidSynthesisResult({
        keyQuotes: [
          {
            quote: 'Test quote',
            author: 'Author',
            sourceUrl: 'not-a-url',
            verificationLevel: 'SOURCE_CONFIRMED',
          },
        ],
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('validates multiple quotes', () => {
      const result = createValidSynthesisResult({
        keyQuotes: [
          { quote: 'Quote 1', author: 'A1', sourceUrl: 'https://a.com', verificationLevel: 'UNVERIFIED' },
          { quote: 'Quote 2', author: 'A2', sourceUrl: 'https://b.com', verificationLevel: 'SOURCE_CONFIRMED' },
          { quote: 'Quote 3', author: 'A3', sourceUrl: 'https://c.com', verificationLevel: 'PRIMARY_SOURCE' },
        ],
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('infographicBrief structure', () => {
    it('validates complete brief', () => {
      const result = createValidSynthesisResult({
        infographicBrief: {
          title: 'AI Trends',
          keyPoints: ['Point 1', 'Point 2', 'Point 3'],
          suggestedStyle: 'data-heavy',
          colorScheme: '#FF5733',
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('rejects empty title', () => {
      const result = createValidSynthesisResult({
        infographicBrief: {
          title: '',
          keyPoints: ['Point 1'],
          suggestedStyle: 'minimal',
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects empty keyPoints', () => {
      const result = createValidSynthesisResult({
        infographicBrief: {
          title: 'Title',
          keyPoints: [],
          suggestedStyle: 'minimal',
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects more than 7 keyPoints', () => {
      const result = createValidSynthesisResult({
        infographicBrief: {
          title: 'Title',
          keyPoints: ['1', '2', '3', '4', '5', '6', '7', '8'],
          suggestedStyle: 'minimal',
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('accepts all infographic styles', () => {
      const styles = ['minimal', 'data-heavy', 'quote-focused'] as const;
      for (const style of styles) {
        const result = createValidSynthesisResult({
          infographicBrief: {
            title: 'Title',
            keyPoints: ['Point 1'],
            suggestedStyle: style,
          },
        });
        expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
      }
    });

    it('rejects invalid infographic style', () => {
      const result = createValidSynthesisResult({
        infographicBrief: {
          title: 'Title',
          keyPoints: ['Point 1'],
          suggestedStyle: 'fancy' as 'minimal',
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });
  });

  describe('factCheckSummary structure', () => {
    it('validates complete factCheckSummary', () => {
      const result = createValidSynthesisResult({
        factCheckSummary: {
          totalSourcesUsed: 10,
          verifiedQuotes: 5,
          unverifiedClaims: 2,
          primarySources: 3,
          warnings: ['Some content could not be verified'],
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('accepts all zeros', () => {
      const result = createValidSynthesisResult({
        factCheckSummary: {
          totalSourcesUsed: 0,
          verifiedQuotes: 0,
          unverifiedClaims: 0,
          primarySources: 0,
          warnings: [],
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('rejects negative values', () => {
      const result = createValidSynthesisResult({
        factCheckSummary: {
          totalSourcesUsed: -1,
          verifiedQuotes: 0,
          unverifiedClaims: 0,
          primarySources: 0,
          warnings: [],
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects non-integer values', () => {
      const result = createValidSynthesisResult({
        factCheckSummary: {
          totalSourcesUsed: 5.5,
          verifiedQuotes: 0,
          unverifiedClaims: 0,
          primarySources: 0,
          warnings: [],
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });
  });

  describe('metadata structure', () => {
    it('validates complete metadata', () => {
      const result = createValidSynthesisResult({
        metadata: {
          sourcesUsed: 5,
          processingTimeMs: 15000,
          estimatedCost: {
            perplexity: 0.01,
            gemini: 0.005,
            openai: 0.02,
            nanoBanana: 0.05,
            total: 0.085,
          },
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
    });

    it('rejects negative processing time', () => {
      const result = createValidSynthesisResult({
        metadata: {
          sourcesUsed: 5,
          processingTimeMs: -100,
          estimatedCost: createEmptyCostBreakdown(),
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects non-integer processing time', () => {
      const result = createValidSynthesisResult({
        metadata: {
          sourcesUsed: 5,
          processingTimeMs: 1000.5,
          estimatedCost: createEmptyCostBreakdown(),
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects negative cost values', () => {
      const result = createValidSynthesisResult({
        metadata: {
          sourcesUsed: 5,
          processingTimeMs: 1000,
          estimatedCost: {
            perplexity: -0.01,
            gemini: 0,
            openai: 0,
            nanoBanana: 0,
            total: -0.01,
          },
        },
      });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });
  });

  describe('required fields', () => {
    it('rejects missing prompt', () => {
      const { prompt: _, ...result } = createValidSynthesisResult();
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects empty prompt', () => {
      const result = createValidSynthesisResult({ prompt: '' });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects missing generatedAt', () => {
      const { generatedAt: _, ...result } = createValidSynthesisResult();
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects invalid generatedAt format', () => {
      const result = createValidSynthesisResult({ generatedAt: 'invalid-date' });
      expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
    });
  });
});

// ============================================
// GPTSynthesisResponseSchema Tests
// ============================================

describe('GPTSynthesisResponseSchema', () => {
  it('validates response without prompt field', () => {
    const response = {
      linkedinPost: 'Test post content',
      keyQuotes: [],
      infographicBrief: {
        title: 'Title',
        keyPoints: ['Point 1'],
        suggestedStyle: 'minimal' as const,
      },
      factCheckSummary: {
        totalSourcesUsed: 0,
        verifiedQuotes: 0,
        unverifiedClaims: 0,
        primarySources: 0,
        warnings: [],
      },
    };
    expect(GPTSynthesisResponseSchema.safeParse(response).success).toBe(true);
  });

  it('does not require prompt field (unlike SynthesisResultSchema)', () => {
    const response = {
      linkedinPost: 'Test post',
      keyQuotes: [],
      infographicBrief: { title: 'T', keyPoints: ['P'], suggestedStyle: 'minimal' as const },
      factCheckSummary: {
        totalSourcesUsed: 0,
        verifiedQuotes: 0,
        unverifiedClaims: 0,
        primarySources: 0,
        warnings: [],
      },
    };
    expect(GPTSynthesisResponseSchema.safeParse(response).success).toBe(true);
  });
});

// ============================================
// InfographicStyleSchema Tests
// ============================================

describe('InfographicStyleSchema', () => {
  it('accepts minimal', () => {
    expect(InfographicStyleSchema.safeParse('minimal').success).toBe(true);
  });

  it('accepts data-heavy', () => {
    expect(InfographicStyleSchema.safeParse('data-heavy').success).toBe(true);
  });

  it('accepts quote-focused', () => {
    expect(InfographicStyleSchema.safeParse('quote-focused').success).toBe(true);
  });

  it('rejects invalid styles', () => {
    expect(InfographicStyleSchema.safeParse('fancy').success).toBe(false);
    expect(InfographicStyleSchema.safeParse('').success).toBe(false);
  });
});

// ============================================
// CostBreakdownSchema Tests
// ============================================

describe('CostBreakdownSchema', () => {
  it('validates complete cost breakdown', () => {
    const costs = {
      perplexity: 0.01,
      gemini: 0.005,
      openai: 0.02,
      nanoBanana: 0.05,
      total: 0.085,
    };
    expect(CostBreakdownSchema.safeParse(costs).success).toBe(true);
  });

  it('accepts all zeros', () => {
    const costs = createEmptyCostBreakdown();
    expect(CostBreakdownSchema.safeParse(costs).success).toBe(true);
  });

  it('rejects negative costs', () => {
    const costs = {
      perplexity: -0.01,
      gemini: 0,
      openai: 0,
      nanoBanana: 0,
      total: -0.01,
    };
    expect(CostBreakdownSchema.safeParse(costs).success).toBe(false);
  });
});

// ============================================
// createEmptyCostBreakdown Tests
// ============================================

describe('createEmptyCostBreakdown', () => {
  it('creates valid cost breakdown', () => {
    const costs = createEmptyCostBreakdown();
    expect(CostBreakdownSchema.safeParse(costs).success).toBe(true);
  });

  it('sets all values to zero', () => {
    const costs = createEmptyCostBreakdown();
    expect(costs.perplexity).toBe(0);
    expect(costs.gemini).toBe(0);
    expect(costs.openai).toBe(0);
    expect(costs.nanoBanana).toBe(0);
    expect(costs.total).toBe(0);
  });
});

// ============================================
// calculateTotalCost Tests
// ============================================

describe('calculateTotalCost', () => {
  it('calculates total from individual costs', () => {
    const result = calculateTotalCost({
      perplexity: 0.01,
      gemini: 0.005,
      openai: 0.02,
      nanoBanana: 0.05,
    });
    expect(result.total).toBeCloseTo(0.085);
  });

  it('rounds to 3 decimal places', () => {
    const result = calculateTotalCost({
      perplexity: 0.0001,
      gemini: 0.0002,
      openai: 0.0003,
      nanoBanana: 0.0004,
    });
    expect(result.total).toBe(0.001);
  });

  it('preserves individual costs', () => {
    const result = calculateTotalCost({
      perplexity: 0.01,
      gemini: 0.02,
      openai: 0.03,
      nanoBanana: 0.04,
    });
    expect(result.perplexity).toBe(0.01);
    expect(result.gemini).toBe(0.02);
    expect(result.openai).toBe(0.03);
    expect(result.nanoBanana).toBe(0.04);
  });
});

// ============================================
// Validation Helpers Tests
// ============================================

describe('parseModelResponse', () => {
  describe('valid JSON handling', () => {
    it('parses raw JSON object', () => {
      const input = '{"key": "value", "number": 42}';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value', number: 42 });
    });

    it('parses raw JSON array', () => {
      const input = '[1, 2, 3, "four"]';
      const result = parseModelResponse(input);
      expect(result).toEqual([1, 2, 3, 'four']);
    });
  });

  describe('markdown code fence handling', () => {
    it('handles ```json code fence', () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('handles ``` code fence without language', () => {
      const input = '```\n{"key": "value"}\n```';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('handles code fence with surrounding text', () => {
      const input = 'Here is the JSON:\n```json\n{"key": "value"}\n```\nThat was the JSON.';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value' });
    });
  });

  describe('trailing text handling', () => {
    it('handles JSON with trailing text', () => {
      const input = '{"key": "value"} and some extra text here';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('handles JSON with trailing whitespace', () => {
      const input = '{"key": "value"}   \n\n  ';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value' });
    });
  });

  describe('leading text handling', () => {
    it('handles JSON with leading text', () => {
      const input = 'Here is the response: {"key": "value"}';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('handles JSON with leading whitespace', () => {
      const input = '   \n\n  {"key": "value"}';
      const result = parseModelResponse(input);
      expect(result).toEqual({ key: 'value' });
    });
  });

  describe('malformed JSON handling', () => {
    it('throws JsonParseError for no JSON found', () => {
      expect(() => parseModelResponse('no json here')).toThrow(JsonParseError);
      expect(() => parseModelResponse('no json here')).toThrow('No JSON object or array found');
    });

    it('throws JsonParseError for unclosed JSON', () => {
      expect(() => parseModelResponse('{"key": "value"')).toThrow(JsonParseError);
      expect(() => parseModelResponse('{"key": "value"')).toThrow('Unclosed JSON structure');
    });

    it('throws JsonParseError for invalid JSON syntax', () => {
      expect(() => parseModelResponse('{"key": value}')).toThrow(JsonParseError);
    });

    it('throws JsonParseError for empty input', () => {
      expect(() => parseModelResponse('')).toThrow(JsonParseError);
    });

    it('throws JsonParseError for whitespace only', () => {
      expect(() => parseModelResponse('   \n\t  ')).toThrow(JsonParseError);
    });
  });

  describe('complex JSON handling', () => {
    it('handles nested objects', () => {
      const input = '{"outer": {"inner": {"deep": "value"}}}';
      const result = parseModelResponse(input);
      expect(result).toEqual({ outer: { inner: { deep: 'value' } } });
    });

    it('handles arrays in objects', () => {
      const input = '{"items": [1, 2, {"nested": true}]}';
      const result = parseModelResponse(input);
      expect(result).toEqual({ items: [1, 2, { nested: true }] });
    });

    it('handles escaped characters in strings', () => {
      const input = '{"text": "Hello \\"World\\"\\nNew line"}';
      const result = parseModelResponse(input);
      expect(result).toEqual({ text: 'Hello "World"\nNew line' });
    });

    it('handles braces in strings correctly', () => {
      const input = '{"code": "function() { return {}; }"}';
      const result = parseModelResponse(input);
      expect(result).toEqual({ code: 'function() { return {}; }' });
    });
  });
});

// ============================================
// validateOrThrow Tests
// ============================================

describe('validateOrThrow', () => {
  it('returns validated data for valid input', () => {
    const schema = ScoresSchema;
    const input = {
      relevance: 80,
      authenticity: 70,
      recency: 90,
      engagementPotential: 60,
      overall: 75,
    };
    const result = validateOrThrow(schema, input);
    expect(result).toEqual(input);
  });

  it('throws ZodError for invalid input', () => {
    const schema = ScoresSchema;
    const input = { relevance: 150 }; // Invalid and incomplete
    expect(() => validateOrThrow(schema, input)).toThrow();
  });
});

// ============================================
// tryValidate Tests
// ============================================

describe('tryValidate', () => {
  it('returns success with data for valid input', () => {
    const schema = ScoresSchema;
    const input = {
      relevance: 80,
      authenticity: 70,
      recency: 90,
      engagementPotential: 60,
      overall: 75,
    };
    const result = tryValidate(schema, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it('returns failure with error for invalid input', () => {
    const schema = ScoresSchema;
    const input = { relevance: 150 };
    const result = tryValidate(schema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

// ============================================
// parseAndValidate Tests
// ============================================

describe('parseAndValidate', () => {
  it('parses and validates valid JSON successfully', () => {
    const schema = ScoresSchema;
    const input = '{"relevance": 80, "authenticity": 70, "recency": 90, "engagementPotential": 60, "overall": 75}';
    const result = parseAndValidate(schema, input);
    expect(result.success).toBe(true);
  });

  it('returns error for valid JSON that fails validation', () => {
    const schema = ScoresSchema;
    const input = '{"relevance": 150}'; // Out of range
    const result = parseAndValidate(schema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Validation failed');
    }
  });

  it('returns error for invalid JSON', () => {
    const schema = ScoresSchema;
    const input = 'not json at all';
    const result = parseAndValidate(schema, input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it('handles JSON in code fences with validation', () => {
    const schema = ScoresSchema;
    const input = '```json\n{"relevance": 80, "authenticity": 70, "recency": 90, "engagementPotential": 60, "overall": 75}\n```';
    const result = parseAndValidate(schema, input);
    expect(result.success).toBe(true);
  });
});

// ============================================
// formatZodError Tests
// ============================================

describe('formatZodError', () => {
  it('formats single error correctly', () => {
    const schema = ScoresSchema;
    const result = schema.safeParse({ relevance: 150 });
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('relevance');
    }
  });

  it('formats multiple errors correctly', () => {
    const schema = ScoresSchema;
    const result = schema.safeParse({ relevance: 150, authenticity: -5 });
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain('relevance');
      expect(formatted).toContain('authenticity');
    }
  });
});

// ============================================
// Parse Error Classes Tests
// ============================================

describe('JsonParseError', () => {
  it('is instanceof ParseError', () => {
    const error = new JsonParseError('test');
    expect(error).toBeInstanceOf(JsonParseError);
    expect(error.name).toBe('JsonParseError');
  });

  it('is marked as fixable', () => {
    const error = new JsonParseError('test');
    expect(error.isFixable).toBe(true);
  });
});

describe('SchemaValidationError', () => {
  it('is instanceof ParseError', () => {
    const schema = ScoresSchema;
    const result = schema.safeParse({});
    if (!result.success) {
      const error = new SchemaValidationError('test', result.error);
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect(error.name).toBe('SchemaValidationError');
    }
  });

  it('is marked as NOT fixable', () => {
    const schema = ScoresSchema;
    const result = schema.safeParse({});
    if (!result.success) {
      const error = new SchemaValidationError('test', result.error);
      expect(error.isFixable).toBe(false);
    }
  });

  it('contains zodError reference', () => {
    const schema = ScoresSchema;
    const result = schema.safeParse({});
    if (!result.success) {
      const error = new SchemaValidationError('test', result.error);
      expect(error.zodError).toBeDefined();
      expect(error.zodError.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('isFixableParseError', () => {
  it('returns true for JsonParseError', () => {
    const error = new JsonParseError('test');
    expect(isFixableParseError(error)).toBe(true);
  });

  it('returns false for SchemaValidationError', () => {
    const schema = ScoresSchema;
    const result = schema.safeParse({});
    if (!result.success) {
      const error = new SchemaValidationError('test', result.error);
      expect(isFixableParseError(error)).toBe(false);
    }
  });

  it('returns false for regular Error', () => {
    const error = new Error('test');
    expect(isFixableParseError(error)).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isFixableParseError('string')).toBe(false);
    expect(isFixableParseError(null)).toBe(false);
    expect(isFixableParseError(undefined)).toBe(false);
  });
});

// ============================================
// Constants Tests
// ============================================

describe('Schema Constants', () => {
  it('SCHEMA_VERSION is defined', () => {
    expect(SCHEMA_VERSION).toBe('1.0.0');
  });

  it('LINKEDIN_POST_MAX_LENGTH is 3000', () => {
    expect(LINKEDIN_POST_MAX_LENGTH).toBe(3000);
  });

  it('LINKEDIN_HASHTAGS_MIN is 3', () => {
    expect(LINKEDIN_HASHTAGS_MIN).toBe(3);
  });

  it('LINKEDIN_HASHTAGS_MAX is 5', () => {
    expect(LINKEDIN_HASHTAGS_MAX).toBe(5);
  });
});
