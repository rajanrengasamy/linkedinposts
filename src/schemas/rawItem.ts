import { z } from 'zod';

/**
 * Schema Version - used for backwards compatibility
 */
export const SCHEMA_VERSION = '1.0.0' as const;

/**
 * Source types for collected data
 */
export const SourceTypeSchema = z.enum(['web', 'linkedin', 'x', 'googletrends']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/**
 * Engagement metrics - normalized across platforms
 * Base fields are required (can be 0), platform-specific are optional
 */
export const EngagementSchema = z.object({
  // Base engagement (required, defaults handled at creation)
  likes: z.number().int().min(0),
  comments: z.number().int().min(0),
  shares: z.number().int().min(0),

  // X/Twitter-specific (optional)
  retweets: z.number().int().min(0).optional(),
  quotes: z.number().int().min(0).optional(),
  replies: z.number().int().min(0).optional(),
  impressions: z.number().int().min(0).optional(),

  // LinkedIn-specific (optional)
  reactions: z.number().int().min(0).optional(),
});
export type Engagement = z.infer<typeof EngagementSchema>;

/**
 * RawItem Schema - Collected data from sources before validation
 *
 * This is the core data structure returned by collectors.
 * Every item MUST have a sourceUrl for provenance tracking.
 */
export const RawItemSchema = z.object({
  // ============================================
  // Identity & Provenance
  // ============================================

  /** Stable UUID for tracking through pipeline */
  id: z.string().uuid(),

  /** Schema version for backwards compatibility */
  schemaVersion: z.literal(SCHEMA_VERSION),

  /** Source platform */
  source: SourceTypeSchema,

  /** Original URL where content was found (REQUIRED for provenance) */
  sourceUrl: z.string().url(),

  /** When the content was retrieved (ISO 8601) */
  retrievedAt: z.string().datetime(),

  /** Reference to raw API response file (only if --save-raw) */
  rawResponseRef: z.string().optional(),

  // ============================================
  // Content
  // ============================================

  /** Main text content */
  content: z.string().min(1, 'Content cannot be empty'),

  /**
   * Normalized hash for deduplication.
   * Format: First 16 characters of SHA-256 hash over normalized content.
   * Must be exactly 16 lowercase hexadecimal characters.
   */
  contentHash: z
    .string()
    .regex(
      /^[a-f0-9]{16}$/,
      'contentHash must be exactly 16 lowercase hex characters (first 16 chars of SHA-256)'
    ),

  /** Article/post title if available */
  title: z.string().optional(),

  // ============================================
  // Attribution
  // ============================================

  /** Author display name */
  author: z.string().optional(),

  /** Author handle (@handle for social, domain for web) */
  authorHandle: z.string().optional(),

  /** Author profile/page URL */
  authorUrl: z.string().url().optional(),

  /** When the content was originally published (ISO 8601) */
  publishedAt: z.string().datetime().optional(),

  // ============================================
  // Engagement
  // ============================================

  /** Engagement metrics normalized across platforms */
  engagement: EngagementSchema,

  // ============================================
  // Web-specific
  // ============================================

  /** Source URLs/citations from Perplexity */
  citations: z.array(z.string().url()).optional(),
});

export type RawItem = z.infer<typeof RawItemSchema>;

/**
 * Helper to create default engagement object
 */
export function createDefaultEngagement(): Engagement {
  return {
    likes: 0,
    comments: 0,
    shares: 0,
  };
}
