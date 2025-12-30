/**
 * Unit Tests for Evaluation Harness
 *
 * Tests for evaluation functions in tests/evaluate.ts
 *
 * Coverage includes:
 * - Quote extraction from posts
 * - Quote-source matching
 * - All 6 evaluation checks with mock data
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

import {
  extractQuotesFromPost,
  quoteHasSource,
  checkNoQuotesWithoutSources,
  checkPostLengthConstraints,
  checkAllFilesWritten,
  checkSourcesJsonValid,
  checkIdReferences,
  checkVerificationLevels,
  evaluate,
} from '../evaluate.js';
import { SCHEMA_VERSION } from '../../src/schemas/rawItem.js';

// ============================================
// Test Helpers
// ============================================

const TEST_OUTPUT_DIR = join(process.cwd(), 'tests', '.test-output');

/**
 * Create a test output directory with specified files
 */
function setupTestOutput(files: Record<string, unknown>): string {
  // Clean up any previous test output
  if (existsSync(TEST_OUTPUT_DIR)) {
    rmSync(TEST_OUTPUT_DIR, { recursive: true });
  }

  mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(TEST_OUTPUT_DIR, filename);
    if (typeof content === 'string') {
      writeFileSync(filePath, content, 'utf-8');
    } else {
      writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
    }
  }

  return TEST_OUTPUT_DIR;
}

/**
 * Clean up test output directory
 */
function cleanupTestOutput(): void {
  if (existsSync(TEST_OUTPUT_DIR)) {
    rmSync(TEST_OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Generate a valid UUID for testing
 */
function testUuid(seed: string): string {
  // Generate deterministic UUIDs for testing
  const seedMap: Record<string, string> = {
    'item-1': '11111111-1111-4111-a111-111111111111',
    'item-2': '22222222-2222-4222-a222-222222222222',
    'item-3': '33333333-3333-4333-a333-333333333333',
    'item-4': '44444444-4444-4444-a444-444444444444',
    'item-5': '55555555-5555-4555-a555-555555555555',
    'orphan': 'ffffffff-ffff-4fff-afff-ffffffffffff',
  };
  return seedMap[seed] ?? uuidv4();
}

/**
 * Create a minimal valid ValidatedItem for testing
 */
function createValidatedItem(overrides?: {
  id?: string;
  level?: string;
}): Record<string, unknown> {
  const id = overrides?.id ? testUuid(overrides.id) : uuidv4();
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    source: 'web',
    sourceUrl: `https://example.com/${id}`,
    retrievedAt: new Date().toISOString(),
    content: 'Test content about AI trends and technology',
    contentHash: 'abc123def456',
    engagement: { likes: 100, comments: 10, shares: 5 },
    validation: {
      level: overrides?.level ?? 'SOURCE_CONFIRMED',
      confidence: 0.85,
      checkedAt: new Date().toISOString(),
      sourcesFound: ['https://example.com/source1'],
      notes: ['Verified from web source'],
      quotesVerified: [],
    },
  };
}

/**
 * Create a minimal valid ScoredItem for testing
 */
function createScoredItem(overrides?: {
  id?: string;
  level?: string;
  rank?: number;
}): Record<string, unknown> {
  const base = createValidatedItem(overrides);
  return {
    ...base,
    scores: {
      relevance: 80,
      authenticity: 75,
      recency: 90,
      engagementPotential: 70,
      overall: 78.25,
    },
    scoreReasoning: ['High relevance to topic', 'Recent publication'],
    rank: overrides?.rank ?? 1,
  };
}

/**
 * Create a minimal valid SourceReference for testing
 */
function createSourceReference(overrides?: {
  id?: string;
  usedInPost?: boolean;
}): Record<string, unknown> {
  const id = overrides?.id ? testUuid(overrides.id) : uuidv4();
  return {
    id,
    url: `https://example.com/${id}`,
    title: 'Test Source Title',
    author: 'Test Author',
    retrievedAt: new Date().toISOString(),
    verificationLevel: 'SOURCE_CONFIRMED',
    usedInPost: overrides?.usedInPost ?? false,
  };
}

/**
 * Create a minimal valid SynthesisResult for testing
 */
function createSynthesisResult(overrides?: {
  keyQuotes?: Array<{
    quote: string;
    author: string;
    sourceUrl: string;
    verificationLevel: string;
  }>;
}): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    prompt: 'AI trends in 2025',
    linkedinPost:
      'Exploring the latest AI trends in healthcare. "AI will transform diagnostics in 2025" says Dr. Smith.\n\n#AI #Healthcare',
    keyQuotes: overrides?.keyQuotes ?? [
      {
        quote: 'AI will transform diagnostics in 2025',
        author: 'Dr. Smith',
        sourceUrl: 'https://example.com/ai-healthcare',
        verificationLevel: 'SOURCE_CONFIRMED',
      },
    ],
    infographicBrief: {
      title: 'AI in Healthcare 2025',
      keyPoints: ['Improved diagnostics', 'Faster treatments'],
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
      processingTimeMs: 15000,
      estimatedCost: {
        perplexity: 0.05,
        gemini: 0.02,
        openai: 0.15,
        nanoBanana: 0.14,
        total: 0.36,
      },
    },
  };
}

/**
 * Create a valid SourcesFile for testing
 */
function createSourcesFile(sources?: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totalSources: sources?.length ?? 3,
    sources: sources ?? [
      createSourceReference({ id: 'item-1' }),
      createSourceReference({ id: 'item-2' }),
      createSourceReference({ id: 'item-3' }),
    ],
  };
}

// ============================================
// extractQuotesFromPost Tests
// ============================================

describe('extractQuotesFromPost', () => {
  it('should extract quotes with regular double quotes', () => {
    const post = 'This is a post with "this is a quote that is long enough to count" inside it.';
    const quotes = extractQuotesFromPost(post);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toBe('this is a quote that is long enough to count');
  });

  it('should extract quotes with smart quotes', () => {
    const post = 'Here is a post with "smart quotes that are long enough to matter" in it.';
    const quotes = extractQuotesFromPost(post);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toBe('smart quotes that are long enough to matter');
  });

  it('should ignore short phrases (< 20 chars)', () => {
    const post = 'Short "phrase" and "another short one" here.';
    const quotes = extractQuotesFromPost(post);

    expect(quotes).toHaveLength(0);
  });

  it('should extract multiple quotes', () => {
    const post = `First: "This is a long enough first quote to extract" and
    second: "This is another sufficiently long quote to extract too"`;
    const quotes = extractQuotesFromPost(post);

    expect(quotes).toHaveLength(2);
  });

  it('should handle posts without quotes', () => {
    const post = 'This is a post with no quotes at all.';
    const quotes = extractQuotesFromPost(post);

    expect(quotes).toHaveLength(0);
  });

  it('should handle empty post', () => {
    const quotes = extractQuotesFromPost('');
    expect(quotes).toHaveLength(0);
  });
});

// ============================================
// quoteHasSource Tests
// ============================================

describe('quoteHasSource', () => {
  const keyQuotes = [
    { quote: 'AI will transform diagnostics in 2025', sourceUrl: 'https://example.com/1' },
    { quote: 'Machine learning is revolutionizing healthcare', sourceUrl: 'https://example.com/2' },
  ];

  it('should match exact quote', () => {
    const result = quoteHasSource('AI will transform diagnostics in 2025', keyQuotes);
    expect(result).toBe(true);
  });

  it('should match partial quote (prefix)', () => {
    const result = quoteHasSource('AI will transform diagnostics', keyQuotes);
    expect(result).toBe(true);
  });

  it('should return false for non-matching quote', () => {
    const result = quoteHasSource('This quote does not exist in the key quotes list', keyQuotes);
    expect(result).toBe(false);
  });

  it('should return false for quote without sourceUrl', () => {
    const quotesNoUrl = [{ quote: 'No source URL here', sourceUrl: '' }];
    const result = quoteHasSource('No source URL here', quotesNoUrl);
    expect(result).toBe(false);
  });

  it('should handle empty keyQuotes array', () => {
    const result = quoteHasSource('Any quote here', []);
    expect(result).toBe(false);
  });
});

// ============================================
// checkNoQuotesWithoutSources Tests
// ============================================

describe('checkNoQuotesWithoutSources', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should pass when all quotes have sources', () => {
    const synthesis = createSynthesisResult({
      keyQuotes: [
        {
          quote: 'AI will transform diagnostics in 2025',
          author: 'Dr. Smith',
          sourceUrl: 'https://example.com/ai',
          verificationLevel: 'SOURCE_CONFIRMED',
        },
      ],
    });

    setupTestOutput({
      'linkedin_post.md':
        'Check this out: "AI will transform diagnostics in 2025" says Dr. Smith.',
      'synthesis.json': synthesis,
    });

    const result = checkNoQuotesWithoutSources(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
  });

  it('should fail when quote has no source', () => {
    const synthesis = createSynthesisResult({
      keyQuotes: [], // No key quotes
    });

    setupTestOutput({
      'linkedin_post.md':
        'Check this out: "This is a quote without any source attribution" by someone.',
      'synthesis.json': synthesis,
    });

    const result = checkNoQuotesWithoutSources(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('without sources');
  });

  it('should pass when post has no quotes', () => {
    setupTestOutput({
      'linkedin_post.md': 'This is a post with no quotes at all.',
      'synthesis.json': createSynthesisResult(),
    });

    const result = checkNoQuotesWithoutSources(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('No quotes found');
  });

  it('should fail when linkedin_post.md is missing', () => {
    setupTestOutput({
      'synthesis.json': createSynthesisResult(),
    });

    const result = checkNoQuotesWithoutSources(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ============================================
// checkPostLengthConstraints Tests
// ============================================

describe('checkPostLengthConstraints', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should pass for valid length post', () => {
    setupTestOutput({
      'linkedin_post.md': 'This is a valid length post about AI trends.',
    });

    const result = checkPostLengthConstraints(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
  });

  it('should fail for empty post', () => {
    setupTestOutput({
      'linkedin_post.md': '   ',
    });

    const result = checkPostLengthConstraints(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('should fail for oversized post', () => {
    const longPost = 'A'.repeat(3500); // Exceeds 3000 char limit

    setupTestOutput({
      'linkedin_post.md': longPost,
    });

    const result = checkPostLengthConstraints(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('too long');
  });

  it('should pass for exactly max length post', () => {
    const maxPost = 'A'.repeat(3000);

    setupTestOutput({
      'linkedin_post.md': maxPost,
    });

    const result = checkPostLengthConstraints(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
  });

  it('should fail when file is missing', () => {
    setupTestOutput({});

    const result = checkPostLengthConstraints(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ============================================
// checkAllFilesWritten Tests
// ============================================

describe('checkAllFilesWritten', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should pass when all required files exist', () => {
    setupTestOutput({
      'validated_data.json': [],
      'scored_data.json': [],
      'top_50.json': [],
      'synthesis.json': createSynthesisResult(),
      'linkedin_post.md': 'Post content',
      'sources.json': createSourcesFile(),
      'sources.md': '# Sources',
      'pipeline_status.json': { success: true },
    });

    const result = checkAllFilesWritten(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('8 required files');
  });

  it('should fail when files are missing', () => {
    setupTestOutput({
      'validated_data.json': [],
      'scored_data.json': [],
      // Missing top_50.json and others
    });

    const result = checkAllFilesWritten(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.details).toBeDefined();
    expect(result.details).toContain('top_50.json');
  });

  it('should list all missing files in details', () => {
    setupTestOutput({}); // No files

    const result = checkAllFilesWritten(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.details?.length).toBe(8);
  });
});

// ============================================
// checkSourcesJsonValid Tests
// ============================================

describe('checkSourcesJsonValid', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should pass for valid sources.json', () => {
    setupTestOutput({
      'sources.json': createSourcesFile(),
    });

    const result = checkSourcesJsonValid(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('Valid schema');
  });

  it('should fail for invalid JSON', () => {
    setupTestOutput({
      'sources.json': 'not valid json{',
    });

    const result = checkSourcesJsonValid(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Invalid JSON');
  });

  it('should fail for schema violations', () => {
    setupTestOutput({
      'sources.json': {
        // Missing required fields
        sources: [{ id: 'test' }],
      },
    });

    const result = checkSourcesJsonValid(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Schema validation failed');
  });

  it('should fail when sources have missing URLs', () => {
    // Create a sources file with a source missing URL (would fail schema)
    setupTestOutput({
      'sources.json': {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        totalSources: 1,
        sources: [
          {
            id: '11111111-1111-4111-a111-111111111111',
            url: '', // Empty URL - should fail schema
            title: 'Test',
            retrievedAt: new Date().toISOString(),
            verificationLevel: 'SOURCE_CONFIRMED',
            usedInPost: false,
          },
        ],
      },
    });

    const result = checkSourcesJsonValid(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
  });

  it('should fail when file is missing', () => {
    setupTestOutput({});

    const result = checkSourcesJsonValid(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ============================================
// checkIdReferences Tests
// ============================================

describe('checkIdReferences', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should pass when all IDs are valid', () => {
    const items = [
      createValidatedItem({ id: 'item-1' }),
      createValidatedItem({ id: 'item-2' }),
      createValidatedItem({ id: 'item-3' }),
    ];

    const scoredItems = [
      createScoredItem({ id: 'item-1', rank: 1 }),
      createScoredItem({ id: 'item-2', rank: 2 }),
    ];

    const sources = createSourcesFile([
      createSourceReference({ id: 'item-1' }),
      createSourceReference({ id: 'item-2' }),
      createSourceReference({ id: 'item-3' }),
    ]);

    setupTestOutput({
      'validated_data.json': items,
      'top_50.json': scoredItems,
      'sources.json': sources,
    });

    const result = checkIdReferences(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
  });

  it('should fail when top_50 has orphan IDs', () => {
    const items = [createValidatedItem({ id: 'item-1' })];

    const scoredItems = [
      createScoredItem({ id: 'item-1', rank: 1 }),
      createScoredItem({ id: 'orphan', rank: 2 }), // Not in validated_data
    ];

    setupTestOutput({
      'validated_data.json': items,
      'top_50.json': scoredItems,
    });

    const result = checkIdReferences(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found in validated_data.json');
  });

  it('should fail when top_50 IDs missing from sources', () => {
    const items = [
      createValidatedItem({ id: 'item-1' }),
      createValidatedItem({ id: 'item-2' }),
    ];

    const scoredItems = [
      createScoredItem({ id: 'item-1', rank: 1 }),
      createScoredItem({ id: 'item-2', rank: 2 }),
    ];

    // Sources only has item-1
    const sources = createSourcesFile([createSourceReference({ id: 'item-1' })]);

    setupTestOutput({
      'validated_data.json': items,
      'top_50.json': scoredItems,
      'sources.json': sources,
    });

    const result = checkIdReferences(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('missing from sources.json');
  });

  it('should fail when required files are missing', () => {
    setupTestOutput({
      'validated_data.json': [],
      // Missing top_50.json
    });

    const result = checkIdReferences(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ============================================
// checkVerificationLevels Tests
// ============================================

describe('checkVerificationLevels', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should pass for valid verification levels', () => {
    const items = [
      createValidatedItem({ id: 'item-1', level: 'UNVERIFIED' }),
      createValidatedItem({ id: 'item-2', level: 'SOURCE_CONFIRMED' }),
      createValidatedItem({ id: 'item-3', level: 'MULTISOURCE_CONFIRMED' }),
      createValidatedItem({ id: 'item-4', level: 'PRIMARY_SOURCE' }),
    ];

    setupTestOutput({
      'validated_data.json': items,
    });

    const result = checkVerificationLevels(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
    expect(result.details).toBeDefined();
    // Should show level counts
    expect(result.details![0]).toContain('UNVERIFIED');
  });

  it('should fail for invalid verification level', () => {
    const items = [
      createValidatedItem({ id: 'item-1', level: 'INVALID_LEVEL' }),
    ];

    setupTestOutput({
      'validated_data.json': items,
    });

    const result = checkVerificationLevels(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('invalid verification levels');
  });

  it('should fail for missing verification level', () => {
    const item = createValidatedItem({ id: 'item-1' });
    // Remove the level
    (item.validation as Record<string, unknown>).level = undefined;

    setupTestOutput({
      'validated_data.json': [item],
    });

    const result = checkVerificationLevels(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('invalid verification levels');
  });

  it('should fail when file is missing', () => {
    setupTestOutput({});

    const result = checkVerificationLevels(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ============================================
// evaluate (Full Runner) Tests
// ============================================

describe('evaluate', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should return all check results', async () => {
    // Setup minimal valid output
    const items = [
      createValidatedItem({ id: 'item-1' }),
      createValidatedItem({ id: 'item-2' }),
    ];

    const scoredItems = [
      createScoredItem({ id: 'item-1', rank: 1 }),
      createScoredItem({ id: 'item-2', rank: 2 }),
    ];

    const synthesis = createSynthesisResult();

    setupTestOutput({
      'validated_data.json': items,
      'scored_data.json': scoredItems,
      'top_50.json': scoredItems,
      'synthesis.json': synthesis,
      'linkedin_post.md':
        'Check this out: "AI will transform diagnostics in 2025" says Dr. Smith.',
      'sources.json': createSourcesFile([
        createSourceReference({ id: 'item-1' }),
        createSourceReference({ id: 'item-2' }),
      ]),
      'sources.md': '# Sources\n\n1. Source 1\n2. Source 2',
      'pipeline_status.json': { success: true },
    });

    const results = await evaluate(TEST_OUTPUT_DIR);

    expect(results).toHaveLength(6);
    // All checks should have passed with valid data
    const passedCount = results.filter((r) => r.passed).length;
    expect(passedCount).toBe(6);
  });

  it('should include failed checks in results', async () => {
    // Setup output with missing files
    setupTestOutput({
      'validated_data.json': [],
      // Missing most required files
    });

    const results = await evaluate(TEST_OUTPUT_DIR);

    expect(results).toHaveLength(6);
    const failedCount = results.filter((r) => !r.passed).length;
    expect(failedCount).toBeGreaterThan(0);
  });
});

// ============================================
// Edge Cases
// ============================================

describe('Edge Cases', () => {
  afterEach(() => {
    cleanupTestOutput();
  });

  it('should handle empty arrays gracefully', () => {
    setupTestOutput({
      'validated_data.json': [],
      'scored_data.json': [],
      'top_50.json': [],
      'synthesis.json': createSynthesisResult({ keyQuotes: [] }),
      'linkedin_post.md': 'A simple post without quotes.',
      'sources.json': createSourcesFile([]),
      'sources.md': '# Sources\n\nNo sources.',
      'pipeline_status.json': { success: true },
    });

    const quotesResult = checkNoQuotesWithoutSources(TEST_OUTPUT_DIR);
    expect(quotesResult.passed).toBe(true);

    const refsResult = checkIdReferences(TEST_OUTPUT_DIR);
    expect(refsResult.passed).toBe(true);

    const levelsResult = checkVerificationLevels(TEST_OUTPUT_DIR);
    expect(levelsResult.passed).toBe(true);
  });

  it('should handle large datasets', () => {
    // Create 100 items with real UUIDs
    const itemIds = Array.from({ length: 100 }, () => uuidv4());

    const items = itemIds.map((id) => ({
      id,
      schemaVersion: SCHEMA_VERSION,
      source: 'web',
      sourceUrl: `https://example.com/${id}`,
      retrievedAt: new Date().toISOString(),
      content: 'Test content about AI trends',
      contentHash: `hash-${id.slice(0, 8)}`,
      engagement: { likes: 100, comments: 10, shares: 5 },
      validation: {
        level: 'SOURCE_CONFIRMED',
        confidence: 0.85,
        checkedAt: new Date().toISOString(),
        sourcesFound: ['https://example.com/source1'],
        notes: ['Verified'],
        quotesVerified: [],
      },
    }));

    const scoredItems = items.slice(0, 50).map((item, i) => ({
      ...item,
      scores: {
        relevance: 80,
        authenticity: 75,
        recency: 90,
        engagementPotential: 70,
        overall: 78.25,
      },
      scoreReasoning: ['Good content'],
      rank: i + 1,
    }));

    const sources = items.map((item) => ({
      id: item.id,
      url: item.sourceUrl,
      title: 'Test Source',
      retrievedAt: item.retrievedAt,
      verificationLevel: 'SOURCE_CONFIRMED',
      usedInPost: false,
    }));

    setupTestOutput({
      'validated_data.json': items,
      'top_50.json': scoredItems,
      'sources.json': {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        totalSources: sources.length,
        sources,
      },
    });

    const result = checkIdReferences(TEST_OUTPUT_DIR);
    expect(result.passed).toBe(true);
    expect(result.message).toContain('50 IDs verified');
  });
});
