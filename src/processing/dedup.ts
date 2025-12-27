/**
 * Deduplication Logic
 *
 * Implements a two-phase deduplication strategy:
 * 1. Deterministic hash-based deduplication (fast, exact matches)
 * 2. Jaccard similarity-based deduplication (handles near-duplicates)
 *
 * See PRD Section 8: Deduplication Strategy
 */

import type { RawItem } from '../schemas/rawItem.js';
import { normalizeContent } from './normalize.js';
import { logVerbose } from '../utils/logger.js';

// ============================================
// Types
// ============================================

/**
 * Result of deduplication process with metadata
 */
export interface DeduplicationResult {
  /** Deduplicated items */
  items: RawItem[];
  /** Number of items removed by hash matching */
  hashDuplicatesRemoved: number;
  /** Number of items removed by similarity matching */
  similarityDuplicatesRemoved: number;
  /** Total duplicates removed */
  totalRemoved: number;
}

// ============================================
// Similarity Functions
// ============================================

/**
 * Calculate Jaccard similarity between two strings.
 * Uses token-based comparison on normalized text.
 *
 * Jaccard Index = |A intersection B| / |A union B|
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score between 0.0 and 1.0
 */
export function jaccardSimilarity(a: string, b: string): number {
  const normalizedA = normalizeContent(a);
  const normalizedB = normalizeContent(b);

  // Split into word tokens, filter out empty strings
  const tokensA = normalizedA.split(' ').filter((t) => t.length > 0);
  const tokensB = normalizedB.split(' ').filter((t) => t.length > 0);

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  // Handle edge case: both empty
  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }

  // Handle edge case: one empty, one not
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  // Calculate intersection
  const intersection = new Set([...setA].filter((x) => setB.has(x)));

  // Calculate union
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

// ============================================
// Deduplication Functions
// ============================================

/**
 * Deduplicate items by content hash.
 * When duplicates are found, keeps the earlier item by retrievedAt.
 * The kept item retains its original array position (stable ordering).
 *
 * @param items - Array of raw items
 * @returns Deduplicated array with kept items in their original positions
 */
export function deduplicateByHash(items: RawItem[]): RawItem[] {
  if (items.length === 0) {
    return [];
  }

  const seen = new Map<string, RawItem>();

  for (const item of items) {
    const existing = seen.get(item.contentHash);

    if (!existing) {
      // First occurrence of this hash
      seen.set(item.contentHash, item);
    } else {
      // Duplicate found - keep the earlier one by retrievedAt
      const existingTime = new Date(existing.retrievedAt).getTime();
      const currentTime = new Date(item.retrievedAt).getTime();

      if (currentTime < existingTime) {
        // Current item is earlier, replace
        seen.set(item.contentHash, item);
        logVerbose(`Dedup by hash: keeping earlier item ${item.id} over ${existing.id}`);
      } else {
        logVerbose(`Dedup by hash: keeping earlier item ${existing.id} over ${item.id}`);
      }
    }
  }

  // Build set of IDs to keep
  const keepIds = new Set([...seen.values()].map((item) => item.id));

  // Filter original array to preserve order of kept items
  return items.filter((item) => keepIds.has(item.id));
}

/**
 * Deduplicate items by content similarity using Jaccard index.
 * When similar items are found, keeps the earlier item by retrievedAt.
 *
 * @param items - Array of raw items
 * @param threshold - Similarity threshold (0.0-1.0), default 0.85
 * @returns Deduplicated array
 */
export function deduplicateBySimilarity(items: RawItem[], threshold = 0.85): RawItem[] {
  if (items.length === 0) {
    return [];
  }

  if (items.length === 1) {
    return [...items];
  }

  // Track which items to keep (by index)
  const keep = new Set<number>(items.map((_, i) => i));

  // Compare all pairs
  for (let i = 0; i < items.length; i++) {
    if (!keep.has(i)) continue;

    for (let j = i + 1; j < items.length; j++) {
      if (!keep.has(j)) continue;

      const similarity = jaccardSimilarity(items[i].content, items[j].content);

      if (similarity >= threshold) {
        // Items are similar - keep the earlier one by retrievedAt
        const timeI = new Date(items[i].retrievedAt).getTime();
        const timeJ = new Date(items[j].retrievedAt).getTime();

        if (timeI <= timeJ) {
          // Keep i, remove j
          keep.delete(j);
          logVerbose(
            `Dedup by similarity (${similarity.toFixed(2)}): keeping ${items[i].id} over ${items[j].id}`
          );
        } else {
          // Keep j, remove i
          keep.delete(i);
          logVerbose(
            `Dedup by similarity (${similarity.toFixed(2)}): keeping ${items[j].id} over ${items[i].id}`
          );
          break; // i is removed, no need to continue inner loop
        }
      }
    }
  }

  // Return kept items in original order
  return items.filter((_, i) => keep.has(i));
}

/**
 * Full deduplication pipeline.
 * Runs hash-based dedup first, then similarity-based dedup.
 *
 * @param items - Array of raw items
 * @param similarityThreshold - Optional similarity threshold (default 0.85)
 * @returns Deduplication result with items and metadata
 */
export function deduplicate(items: RawItem[], similarityThreshold = 0.85): DeduplicationResult {
  const originalCount = items.length;

  // Phase 1: Hash-based deduplication
  const afterHash = deduplicateByHash(items);
  const hashDuplicatesRemoved = originalCount - afterHash.length;

  // Phase 2: Similarity-based deduplication
  const afterSimilarity = deduplicateBySimilarity(afterHash, similarityThreshold);
  const similarityDuplicatesRemoved = afterHash.length - afterSimilarity.length;

  const totalRemoved = hashDuplicatesRemoved + similarityDuplicatesRemoved;

  if (totalRemoved > 0) {
    logVerbose(
      `Deduplication: removed ${totalRemoved} items (${hashDuplicatesRemoved} hash, ${similarityDuplicatesRemoved} similarity)`
    );
  }

  return {
    items: afterSimilarity,
    hashDuplicatesRemoved,
    similarityDuplicatesRemoved,
    totalRemoved,
  };
}
