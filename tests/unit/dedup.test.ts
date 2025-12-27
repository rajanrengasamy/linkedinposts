/**
 * Unit Tests for Deduplication Module
 *
 * Tests the two-phase deduplication strategy:
 * 1. Hash-based deduplication (exact matches)
 * 2. Jaccard similarity-based deduplication (near-duplicates)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { RawItem } from '../../src/schemas/rawItem.js';
import {
  jaccardSimilarity,
  deduplicateByHash,
  deduplicateBySimilarity,
  deduplicate,
} from '../../src/processing/dedup.js';
import { normalizeContent } from '../../src/processing/normalize.js';

// Mock the logger to prevent console output during tests
vi.mock('../../src/utils/logger.js', () => ({
  logVerbose: vi.fn(),
}));

// ============================================
// Test Helpers
// ============================================

/**
 * Create a mock RawItem with sensible defaults.
 * All fields can be overridden via the overrides parameter.
 */
function createMockRawItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: uuidv4(),
    schemaVersion: '1.0.0',
    source: 'web',
    sourceUrl: 'https://example.com/article',
    retrievedAt: new Date().toISOString(),
    content: 'Default test content',
    contentHash: 'a1b2c3d4e5f67890', // 16 hex chars
    engagement: { likes: 0, comments: 0, shares: 0 },
    ...overrides,
  };
}

/**
 * Create a fixed timestamp for deterministic tests.
 * offset is in milliseconds from a base time.
 */
function createTimestamp(offsetMs: number): string {
  const base = new Date('2025-01-01T00:00:00.000Z');
  return new Date(base.getTime() + offsetMs).toISOString();
}

// ============================================
// normalizeContent Tests (imported from normalize.ts, used by dedup)
// ============================================

describe('normalizeContent', () => {
  it('converts to lowercase', () => {
    expect(normalizeContent('HELLO WORLD')).toBe('hello world');
  });

  it('removes URLs', () => {
    const input = 'Check out https://example.com and http://test.org for more';
    expect(normalizeContent(input)).toBe('check out and for more');
  });

  it('removes emoji', () => {
    const input = 'Hello world! Great news today';
    expect(normalizeContent(input)).toBe('hello world great news today');
  });

  it('removes punctuation', () => {
    expect(normalizeContent("Hello, world! How's it going?")).toBe('hello world hows it going');
  });

  it('collapses whitespace', () => {
    expect(normalizeContent('hello    world\n\ttest')).toBe('hello world test');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeContent('  hello world  ')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalizeContent('')).toBe('');
  });

  it('handles string with only special characters', () => {
    expect(normalizeContent('!@#$%^&*()')).toBe('');
  });
});

// ============================================
// jaccardSimilarity Tests
// ============================================

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaccardSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0.0 for completely different strings', () => {
    const result = jaccardSimilarity('apple banana cherry', 'dog elephant fox');
    expect(result).toBe(0);
  });

  it('returns approximately 0.5 for 50% overlap', () => {
    // "hello world" has 2 tokens: {hello, world}
    // "hello there" has 2 tokens: {hello, there}
    // Intersection: {hello} = 1
    // Union: {hello, world, there} = 3
    // Jaccard = 1/3 = 0.333...
    const result = jaccardSimilarity('hello world', 'hello there');
    expect(result).toBeCloseTo(1 / 3, 5);
  });

  it('returns 0.0 for empty string vs non-empty', () => {
    expect(jaccardSimilarity('', 'hello world')).toBe(0);
    expect(jaccardSimilarity('hello world', '')).toBe(0);
  });

  it('returns 0.0 for both empty strings (not NaN)', () => {
    const result = jaccardSimilarity('', '');
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it('returns 1.0 for strings differing only in case', () => {
    expect(jaccardSimilarity('Hello World', 'hello world')).toBe(1);
    expect(jaccardSimilarity('TESTING', 'testing')).toBe(1);
  });

  it('returns 1.0 for strings differing only in punctuation', () => {
    expect(jaccardSimilarity('Hello, world!', 'hello world')).toBe(1);
    expect(jaccardSimilarity("it's great!", 'its great')).toBe(1);
  });

  it('calculates correct ratio for long vs short string with shared words', () => {
    // "the quick brown fox" = 4 tokens
    // "the fox" = 2 tokens
    // Intersection: {the, fox} = 2
    // Union: {the, quick, brown, fox} = 4
    // Jaccard = 2/4 = 0.5
    const result = jaccardSimilarity('the quick brown fox', 'the fox');
    expect(result).toBe(0.5);
  });

  it('handles URLs being stripped before comparison', () => {
    const a = 'Check out this article https://example.com';
    const b = 'Check out this article https://other.com';
    // After normalization: "check out this article" for both
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it('handles repeated words correctly', () => {
    // Sets deduplicate, so "the the the" becomes just {the}
    const a = 'the the the';
    const b = 'the';
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it('handles strings with only special characters', () => {
    expect(jaccardSimilarity('!@#$', '%^&*')).toBe(0);
  });
});

// ============================================
// deduplicateByHash Tests
// ============================================

describe('deduplicateByHash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateByHash([])).toEqual([]);
  });

  it('returns same item for single item input', () => {
    const item = createMockRawItem({ id: 'test-id-1' });
    const result = deduplicateByHash([item]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('test-id-1');
  });

  it('keeps earlier item by retrievedAt when hashes match', () => {
    const earlier = createMockRawItem({
      id: 'earlier-item',
      contentHash: 'abc1234567890def',
      retrievedAt: createTimestamp(0), // Earlier
    });
    const later = createMockRawItem({
      id: 'later-item',
      contentHash: 'abc1234567890def', // Same hash
      retrievedAt: createTimestamp(1000), // Later
    });

    const result = deduplicateByHash([later, earlier]); // Order in array shouldn't matter
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('earlier-item');
  });

  it('keeps both items when hashes are different', () => {
    const item1 = createMockRawItem({
      id: 'item-1',
      contentHash: 'abc1234567890def',
    });
    const item2 = createMockRawItem({
      id: 'item-2',
      contentHash: 'def1234567890abc', // Different hash
    });

    const result = deduplicateByHash([item1, item2]);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toContain('item-1');
    expect(result.map((i) => i.id)).toContain('item-2');
  });

  it('correctly deduplicates multiple items with some duplicates', () => {
    const items = [
      createMockRawItem({
        id: 'a',
        contentHash: 'hash1111111111111',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'b',
        contentHash: 'hash2222222222222',
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'c',
        contentHash: 'hash1111111111111',
        retrievedAt: createTimestamp(200),
      }), // Dup of a
      createMockRawItem({
        id: 'd',
        contentHash: 'hash3333333333333',
        retrievedAt: createTimestamp(300),
      }),
      createMockRawItem({
        id: 'e',
        contentHash: 'hash2222222222222',
        retrievedAt: createTimestamp(400),
      }), // Dup of b
    ];

    const result = deduplicateByHash(items);
    expect(result).toHaveLength(3);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'd']); // Keeps earliest of each hash
  });

  it('preserves order of first occurrences', () => {
    const items = [
      createMockRawItem({
        id: 'first',
        contentHash: 'hash1111111111111',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'second',
        contentHash: 'hash2222222222222',
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'third',
        contentHash: 'hash3333333333333',
        retrievedAt: createTimestamp(200),
      }),
    ];

    const result = deduplicateByHash(items);
    expect(result.map((i) => i.id)).toEqual(['first', 'second', 'third']);
  });

  it('preserves original position of kept items when duplicates are interleaved', () => {
    const items = [
      createMockRawItem({
        id: 'a-late',
        contentHash: 'hash1111111111111',
        retrievedAt: '2024-01-03T00:00:00Z',
        content: 'A',
      }),
      createMockRawItem({
        id: 'b',
        contentHash: 'hash2222222222222',
        retrievedAt: '2024-01-02T00:00:00Z',
        content: 'B',
      }),
      createMockRawItem({
        id: 'a-early',
        contentHash: 'hash1111111111111',
        retrievedAt: '2024-01-01T00:00:00Z',
        content: 'A',
      }),
    ];
    const result = deduplicateByHash(items);
    // Should keep a-early (earlier) at its original position (index 2 -> now index 1 after B)
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('b'); // B stays first
    expect(result[1].id).toBe('a-early'); // a-early stays after B
  });

  it('handles 10 items with 3 duplicate groups correctly', () => {
    const items = [
      // Group 1: hash A (3 items)
      createMockRawItem({
        id: 'a1',
        contentHash: 'hashAAAAAAAAAAAA',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'a2',
        contentHash: 'hashAAAAAAAAAAAA',
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'a3',
        contentHash: 'hashAAAAAAAAAAAA',
        retrievedAt: createTimestamp(200),
      }),
      // Group 2: hash B (4 items)
      createMockRawItem({
        id: 'b1',
        contentHash: 'hashBBBBBBBBBBBB',
        retrievedAt: createTimestamp(50),
      }),
      createMockRawItem({
        id: 'b2',
        contentHash: 'hashBBBBBBBBBBBB',
        retrievedAt: createTimestamp(150),
      }),
      createMockRawItem({
        id: 'b3',
        contentHash: 'hashBBBBBBBBBBBB',
        retrievedAt: createTimestamp(250),
      }),
      createMockRawItem({
        id: 'b4',
        contentHash: 'hashBBBBBBBBBBBB',
        retrievedAt: createTimestamp(350),
      }),
      // Group 3: hash C (3 items)
      createMockRawItem({
        id: 'c1',
        contentHash: 'hashCCCCCCCCCCCC',
        retrievedAt: createTimestamp(75),
      }),
      createMockRawItem({
        id: 'c2',
        contentHash: 'hashCCCCCCCCCCCC',
        retrievedAt: createTimestamp(175),
      }),
      createMockRawItem({
        id: 'c3',
        contentHash: 'hashCCCCCCCCCCCC',
        retrievedAt: createTimestamp(275),
      }),
    ];

    const result = deduplicateByHash(items);
    expect(result).toHaveLength(3);
    // Should keep earliest from each group
    expect(result.find((i) => i.contentHash === 'hashAAAAAAAAAAAA')?.id).toBe('a1');
    expect(result.find((i) => i.contentHash === 'hashBBBBBBBBBBBB')?.id).toBe('b1');
    expect(result.find((i) => i.contentHash === 'hashCCCCCCCCCCCC')?.id).toBe('c1');
  });
});

// ============================================
// deduplicateBySimilarity Tests
// ============================================

describe('deduplicateBySimilarity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateBySimilarity([])).toEqual([]);
  });

  it('returns same item for single item input', () => {
    const item = createMockRawItem({ id: 'single' });
    const result = deduplicateBySimilarity([item]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('single');
  });

  it('keeps one item when two have identical content', () => {
    const item1 = createMockRawItem({
      id: 'item-1',
      content: 'This is exactly the same content',
      retrievedAt: createTimestamp(0),
    });
    const item2 = createMockRawItem({
      id: 'item-2',
      content: 'This is exactly the same content',
      retrievedAt: createTimestamp(1000),
    });

    const result = deduplicateBySimilarity([item1, item2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('item-1'); // Earlier item kept
  });

  it('keeps both items when content is completely different', () => {
    const item1 = createMockRawItem({
      id: 'item-1',
      content: 'Apple banana cherry date elderberry',
      retrievedAt: createTimestamp(0),
    });
    const item2 = createMockRawItem({
      id: 'item-2',
      content: 'Dog elephant fox giraffe hippo',
      retrievedAt: createTimestamp(1000),
    });

    const result = deduplicateBySimilarity([item1, item2]);
    expect(result).toHaveLength(2);
  });

  it('uses default threshold of 0.85', () => {
    // Create content with similarity above 0.85
    // Using 13 words where 12 are shared = 12/14 = 0.857
    const base = 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13';
    const similar = 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 diff';

    const item1 = createMockRawItem({
      id: 'item-1',
      content: base,
      retrievedAt: createTimestamp(0),
    });
    const item2 = createMockRawItem({
      id: 'item-2',
      content: similar,
      retrievedAt: createTimestamp(1000),
    });

    // Calculate expected similarity: 12 shared / 14 total = 0.857
    const similarity = jaccardSimilarity(base, similar);
    expect(similarity).toBeCloseTo(12 / 14, 5);
    expect(similarity).toBeGreaterThan(0.85);

    const result = deduplicateBySimilarity([item1, item2]);
    expect(result).toHaveLength(1);
  });

  it('respects custom threshold of 0.5 for more aggressive dedup', () => {
    // Create content with ~60% similarity
    const item1 = createMockRawItem({
      id: 'item-1',
      content: 'one two three four five six',
      retrievedAt: createTimestamp(0),
    });
    const item2 = createMockRawItem({
      id: 'item-2',
      content: 'one two three seven eight nine',
      retrievedAt: createTimestamp(1000),
    });

    // Similarity = 3/9 = 0.33... (below 0.5, should keep both)
    const resultDefault = deduplicateBySimilarity([item1, item2], 0.5);
    expect(resultDefault).toHaveLength(2);

    // With threshold 0.3, should deduplicate
    const resultLower = deduplicateBySimilarity([item1, item2], 0.3);
    expect(resultLower).toHaveLength(1);
  });

  it('respects custom threshold of 0.99 for very conservative dedup', () => {
    // Even very similar content should be kept with 0.99 threshold
    const item1 = createMockRawItem({
      id: 'item-1',
      content: 'one two three four five six seven eight nine ten',
      retrievedAt: createTimestamp(0),
    });
    const item2 = createMockRawItem({
      id: 'item-2',
      content: 'one two three four five six seven eight nine eleven', // 1 word different
      retrievedAt: createTimestamp(1000),
    });

    // Similarity = 9/11 = 0.818... (below 0.99)
    const result = deduplicateBySimilarity([item1, item2], 0.99);
    expect(result).toHaveLength(2);
  });

  it('handles items at exactly threshold boundary', () => {
    // Create items where similarity is exactly at threshold
    // For threshold 0.5: need intersection/union = 0.5
    // 2 shared out of 4 total = 0.5
    const item1 = createMockRawItem({
      id: 'item-1',
      content: 'alpha beta',
      retrievedAt: createTimestamp(0),
    });
    const item2 = createMockRawItem({
      id: 'item-2',
      content: 'alpha gamma',
      retrievedAt: createTimestamp(1000),
    });

    // Similarity = 1/3 = 0.333...
    // At threshold 0.333..., should deduplicate
    const similarity = jaccardSimilarity(item1.content, item2.content);
    const result = deduplicateBySimilarity([item1, item2], similarity);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('item-1');
  });

  it('preserves earlier item by retrievedAt when similar', () => {
    const earlier = createMockRawItem({
      id: 'earlier',
      content: 'The quick brown fox jumps over the lazy dog',
      retrievedAt: createTimestamp(0),
    });
    const later = createMockRawItem({
      id: 'later',
      content: 'The quick brown fox jumps over the lazy dog', // Identical
      retrievedAt: createTimestamp(10000),
    });

    // Test with later item first in array
    const result = deduplicateBySimilarity([later, earlier]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('earlier');
  });

  it('handles multiple similar items correctly', () => {
    // Create items where a and b have very high similarity (above 0.85)
    // Using 13 words where 12 are shared = 12/14 = 0.857
    const items = [
      createMockRawItem({
        id: 'a',
        content: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'b',
        content: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 diff', // Very similar to a
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'c',
        content: 'cooking recipes food preparation kitchen tips', // Different topic
        retrievedAt: createTimestamp(200),
      }),
    ];

    const result = deduplicateBySimilarity(items);
    // a and b should be deduped (keeping a), c should remain
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toContain('a');
    expect(result.map((i) => i.id)).toContain('c');
    expect(result.map((i) => i.id)).not.toContain('b');
  });
});

// ============================================
// deduplicate (Full Pipeline) Tests
// ============================================

describe('deduplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct result for empty array', () => {
    const result = deduplicate([]);
    expect(result).toEqual({
      items: [],
      hashDuplicatesRemoved: 0,
      similarityDuplicatesRemoved: 0,
      totalRemoved: 0,
    });
  });

  it('returns all items with zero counts when no duplicates', () => {
    const items = [
      createMockRawItem({
        id: 'a',
        contentHash: 'hash1111111111111',
        content: 'unique content one',
      }),
      createMockRawItem({
        id: 'b',
        contentHash: 'hash2222222222222',
        content: 'different content two',
      }),
      createMockRawItem({
        id: 'c',
        contentHash: 'hash3333333333333',
        content: 'another unique three',
      }),
    ];

    const result = deduplicate(items);
    expect(result.items).toHaveLength(3);
    expect(result.hashDuplicatesRemoved).toBe(0);
    expect(result.similarityDuplicatesRemoved).toBe(0);
    expect(result.totalRemoved).toBe(0);
  });

  it('correctly counts only hash duplicates when no similarity matches', () => {
    const items = [
      createMockRawItem({
        id: 'a',
        contentHash: 'hash1111111111111',
        content: 'apple banana cherry',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'b',
        contentHash: 'hash1111111111111', // Same hash as a
        content: 'apple banana cherry', // Same content
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'c',
        contentHash: 'hash2222222222222',
        content: 'dog elephant fox', // Different content
        retrievedAt: createTimestamp(200),
      }),
    ];

    const result = deduplicate(items);
    expect(result.items).toHaveLength(2);
    expect(result.hashDuplicatesRemoved).toBe(1);
    expect(result.similarityDuplicatesRemoved).toBe(0);
    expect(result.totalRemoved).toBe(1);
  });

  it('correctly counts only similarity duplicates when no hash matches', () => {
    // Create content with similarity above 0.85 (12 shared out of 14 = 0.857)
    const items = [
      createMockRawItem({
        id: 'a',
        contentHash: 'hash1111111111111',
        content: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'b',
        contentHash: 'hash2222222222222', // Different hash
        content: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 diff', // Very similar
        retrievedAt: createTimestamp(100),
      }),
    ];

    const result = deduplicate(items);
    expect(result.items).toHaveLength(1);
    expect(result.hashDuplicatesRemoved).toBe(0);
    expect(result.similarityDuplicatesRemoved).toBe(1);
    expect(result.totalRemoved).toBe(1);
  });

  it('correctly counts both types of duplicates', () => {
    // Create items with:
    // - a1, a2: hash duplicates (same hash)
    // - b1, b2: similarity duplicates (different hash but >0.85 similar content)
    // - c: unique item
    const items = [
      // Hash duplicate pair
      createMockRawItem({
        id: 'a1',
        contentHash: 'hashAAAAAAAAAAAA',
        content: 'unique content alpha beta gamma',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'a2',
        contentHash: 'hashAAAAAAAAAAAA', // Same hash
        content: 'unique content alpha beta gamma',
        retrievedAt: createTimestamp(50),
      }),
      // Similarity duplicate pair (12 shared / 14 total = 0.857 > 0.85)
      createMockRawItem({
        id: 'b1',
        contentHash: 'hashBBBBBBBBBBBB',
        content: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13',
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'b2',
        contentHash: 'hashCCCCCCCCCCCC', // Different hash
        content: 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 diff', // Similar
        retrievedAt: createTimestamp(150),
      }),
      // Unique item
      createMockRawItem({
        id: 'c',
        contentHash: 'hashDDDDDDDDDDDD',
        content: 'cooking tips and kitchen recipes',
        retrievedAt: createTimestamp(200),
      }),
    ];

    const result = deduplicate(items);
    expect(result.items).toHaveLength(3); // a1, b1, c
    expect(result.hashDuplicatesRemoved).toBe(1); // a2 removed
    expect(result.similarityDuplicatesRemoved).toBe(1); // b2 removed
    expect(result.totalRemoved).toBe(2);
  });

  it('verifies items array contains correct items', () => {
    const items = [
      createMockRawItem({
        id: 'keep-1',
        contentHash: 'hash1111111111111',
        content: 'first unique item',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'remove-hash',
        contentHash: 'hash1111111111111', // Duplicate hash
        content: 'first unique item',
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'keep-2',
        contentHash: 'hash2222222222222',
        content: 'second unique item',
        retrievedAt: createTimestamp(200),
      }),
    ];

    const result = deduplicate(items);
    expect(result.items.map((i) => i.id)).toEqual(['keep-1', 'keep-2']);
  });

  it('verifies metadata counts are accurate for complex case', () => {
    // Create a complex scenario
    const items = [
      // Group 1: 3 hash duplicates (remove 2)
      createMockRawItem({
        id: 'g1-1',
        contentHash: 'hash1111111111111',
        content: 'group one content',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'g1-2',
        contentHash: 'hash1111111111111',
        content: 'group one content',
        retrievedAt: createTimestamp(10),
      }),
      createMockRawItem({
        id: 'g1-3',
        contentHash: 'hash1111111111111',
        content: 'group one content',
        retrievedAt: createTimestamp(20),
      }),
      // Group 2: 2 hash duplicates (remove 1)
      createMockRawItem({
        id: 'g2-1',
        contentHash: 'hash2222222222222',
        content: 'completely different topic here',
        retrievedAt: createTimestamp(100),
      }),
      createMockRawItem({
        id: 'g2-2',
        contentHash: 'hash2222222222222',
        content: 'completely different topic here',
        retrievedAt: createTimestamp(110),
      }),
      // Unique item
      createMockRawItem({
        id: 'unique',
        contentHash: 'hash3333333333333',
        content: 'standalone unique item',
        retrievedAt: createTimestamp(200),
      }),
    ];

    const result = deduplicate(items);
    expect(result.items).toHaveLength(3); // g1-1, g2-1, unique
    expect(result.hashDuplicatesRemoved).toBe(3); // g1-2, g1-3, g2-2
    expect(result.similarityDuplicatesRemoved).toBe(0);
    expect(result.totalRemoved).toBe(3);
    expect(result.items.map((i) => i.id)).toEqual(['g1-1', 'g2-1', 'unique']);
  });

  it('accepts custom similarity threshold', () => {
    const items = [
      createMockRawItem({
        id: 'a',
        contentHash: 'hash1111111111111',
        content: 'one two three four five',
        retrievedAt: createTimestamp(0),
      }),
      createMockRawItem({
        id: 'b',
        contentHash: 'hash2222222222222',
        content: 'one two three six seven', // 3 shared, 4 unique = 3/7 = 0.43
        retrievedAt: createTimestamp(100),
      }),
    ];

    // With default 0.85 threshold, both should be kept
    const resultDefault = deduplicate(items);
    expect(resultDefault.items).toHaveLength(2);

    // With 0.4 threshold, should deduplicate
    const resultLower = deduplicate(items, 0.4);
    expect(resultLower.items).toHaveLength(1);
    expect(resultLower.similarityDuplicatesRemoved).toBe(1);
  });
});
