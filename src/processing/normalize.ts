/**
 * Content Normalization
 *
 * Functions for normalizing content before hashing and comparison.
 * Used by deduplication and content hash generation.
 */

import { createHash } from 'node:crypto';

/**
 * Normalize content for hashing and similarity comparison.
 *
 * Transformations applied:
 * 1. Convert to lowercase
 * 2. Remove URLs
 * 3. Remove emoji
 * 4. Remove punctuation (keep alphanumeric and spaces)
 * 5. Collapse whitespace
 * 6. Trim
 *
 * @param content - Raw content string
 * @returns Normalized content string
 */
export function normalizeContent(content: string): string {
  // Handle edge case: empty or whitespace-only input
  if (!content || content.trim() === '') {
    return '';
  }

  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '') // Remove URLs
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '') // Remove emoji (basic range)
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Remove misc symbols & pictographs
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Remove supplemental symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Remove symbols extended-A
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Remove flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '') // Remove misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '') // Remove dingbats
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
}

/**
 * Generate content hash for deduplication.
 *
 * Uses SHA-256 over normalized content, returns first 16 hex characters.
 * This provides sufficient uniqueness for deduplication while being compact.
 *
 * @param content - Raw content string
 * @returns 16-character lowercase hex hash
 */
export function generateContentHash(content: string): string {
  const normalized = normalizeContent(content);
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Normalize timestamp to ISO 8601 format.
 *
 * Handles various input formats and converts to standard ISO string.
 * Supported formats:
 * - Date objects
 * - ISO 8601 strings (e.g., "2024-01-01T00:00:00Z")
 * - Date-only strings (e.g., "2024-01-01")
 * - YYYYMMDD numeric strings (e.g., "20240101") - 8 digits
 * - Unix timestamp in seconds (e.g., "1704067200") - 10 digits
 * - Unix timestamp in milliseconds (e.g., "1704067200000") - 13 digits
 *
 * @param date - Date string or Date object
 * @returns ISO 8601 datetime string
 * @throws Error if date is invalid
 */
export function normalizeTimestamp(date: string | Date): string {
  let parsed: Date;

  if (date instanceof Date) {
    parsed = date;
  } else if (typeof date === 'string') {
    const trimmed = date.trim();
    // Check if it's a numeric string (Unix timestamp or YYYYMMDD)
    if (/^\d+$/.test(trimmed)) {
      const len = trimmed.length;

      if (len === 8) {
        // YYYYMMDD format (e.g., "20240101")
        const yearStr = trimmed.slice(0, 4);
        const monthStr = trimmed.slice(4, 6);
        const dayStr = trimmed.slice(6, 8);

        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const day = parseInt(dayStr, 10);

        // Validate basic ranges
        if (month < 1 || month > 12) {
          throw new Error(`Invalid date: ${date} (month ${month} out of range 1-12)`);
        }
        if (day < 1 || day > 31) {
          throw new Error(`Invalid date: ${date} (day ${day} out of range 1-31)`);
        }

        // Create date and verify no rollover
        parsed = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00.000Z`);

        // Check for JS Date rollover (e.g., Feb 30 becomes Mar 1)
        if (
          parsed.getUTCFullYear() !== year ||
          parsed.getUTCMonth() + 1 !== month ||
          parsed.getUTCDate() !== day
        ) {
          throw new Error(`Invalid date: ${date} (date does not exist in calendar)`);
        }
      } else if (len === 10) {
        // Unix seconds (e.g., "1704067200" for 2024-01-01)
        parsed = new Date(parseInt(trimmed, 10) * 1000);
      } else if (len === 13) {
        // Unix milliseconds (e.g., "1704067200000")
        parsed = new Date(parseInt(trimmed, 10));
      } else {
        throw new Error(
          `Invalid date: ${date} (numeric string must be 8 digits YYYYMMDD, 10 digits Unix seconds, or 13 digits Unix milliseconds; got ${len} digits)`
        );
      }
    } else {
      parsed = new Date(trimmed);
    }
  } else {
    throw new Error(`Invalid date: ${date}`);
  }

  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }

  return parsed.toISOString();
}

/**
 * Tracking parameters to remove from URLs.
 * These are commonly used for analytics and don't affect content identity.
 */
const TRACKING_PARAMS = new Set([
  // UTM parameters (Google Analytics / Urchin)
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_cid',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  // Facebook/Meta
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'fb_source',
  'fb_ref',
  // Google
  'gclid',
  'gclsrc',
  'dclid',
  // Microsoft / Bing
  'msclkid',
  // Twitter / X
  'twclid',
  // Other common tracking
  'ref',
  'source',
  'src',
  'ref_src',
  'ref_url',
  'referrer',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'yclid',
  // Social sharing
  'share',
  'shared',
  'share_source',
  // Affiliate tracking
  'affiliate_id',
  'aff_id',
  'partner',
  // Other platform trackers
  'igshid', // Instagram
  's', // Generic session
  'si', // Spotify
  'ved', // Google search
  'usg', // Google redirect
]);

/**
 * Normalize URL for consistent comparison.
 *
 * Transformations:
 * 1. Upgrade HTTP to HTTPS
 * 2. Remove common tracking parameters
 * 3. Remove trailing slashes (except for root)
 * 4. Preserve fragment identifiers (#section)
 * 5. Preserve non-tracking query parameters
 *
 * @param url - URL string
 * @returns Normalized URL string
 * @throws Error if URL is malformed
 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  const trimmed = url.trim();

  try {
    parsed = new URL(trimmed);
  } catch {
    // Include original URL in error for debugging whitespace issues
    throw new Error(`Malformed URL: "${url}" (trimmed: "${trimmed}")`);
  }

  // Upgrade to HTTPS
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  // Remove tracking parameters (case-insensitive)
  const paramsToDelete: string[] = [];
  for (const key of parsed.searchParams.keys()) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      paramsToDelete.push(key);
    }
  }
  for (const key of paramsToDelete) {
    parsed.searchParams.delete(key);
  }

  // Normalize hostname to lowercase
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove trailing slash from pathname (but keep for root path)
  // This handles cases where query string or fragment follows the path
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}
