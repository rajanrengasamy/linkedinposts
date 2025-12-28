/**
 * Stable ID Generation Utility
 *
 * Generates deterministic UUIDs based on content characteristics.
 * Same sourceUrl + contentHash + publishedAt = same UUID every run.
 *
 * This enables:
 * - Cross-run deduplication
 * - Provenance tracking
 * - Consistent item identification
 */

import { v5 as uuidv5 } from 'uuid';

// ============================================
// Namespace UUID
// ============================================

/**
 * Project namespace UUID for stable ID generation.
 * Using DNS namespace as base (RFC 4122).
 * This ensures all generated IDs are unique to this project.
 */
const LINKEDINQUOTES_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// ============================================
// Stable ID Generation
// ============================================

/**
 * Generate a stable, deterministic UUID based on content characteristics.
 *
 * The ID is derived from a combination of:
 * - sourceUrl: The canonical URL of the content
 * - contentHash: Hash of the normalized content
 * - publishedAt: Optional publication timestamp
 *
 * Same inputs always produce the same UUID, enabling:
 * - Cross-run deduplication (same content = same ID)
 * - Provenance tracking (ID traces back to source)
 * - Idempotent pipeline runs
 *
 * @param sourceUrl - Canonical URL of the content source
 * @param contentHash - Hash of the normalized content
 * @param publishedAt - Optional ISO timestamp of publication
 * @returns Deterministic UUID v5
 *
 * @example
 * ```typescript
 * const id = generateStableId(
 *   'https://example.com/article',
 *   'abc123hash',
 *   '2025-01-15T10:30:00Z'
 * );
 * // Always returns the same UUID for these inputs
 * ```
 */
export function generateStableId(
  sourceUrl: string,
  contentHash: string,
  publishedAt?: string
): string {
  // Build deterministic seed from content characteristics
  // Using pipe separator to avoid collisions from concatenation
  const seed = `${sourceUrl}|${contentHash}|${publishedAt ?? ''}`;

  return uuidv5(seed, LINKEDINQUOTES_NAMESPACE);
}

/**
 * Validate that a string is a valid UUID format.
 * Useful for verifying IDs from external sources.
 *
 * @param id - String to validate
 * @returns True if valid UUID format
 */
export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
