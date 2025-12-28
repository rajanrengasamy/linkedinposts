/**
 * LinkedIn Collector - ScrapeCreators API (Optional, Gated)
 *
 * Optional data source that requires SCRAPECREATORS_API_KEY.
 * Only runs if 'linkedin' is in config.sources.
 *
 * This is a NON-FATAL collector - if it fails, we log a warning
 * and return an empty array to allow the pipeline to continue.
 *
 * See PRD Section 7.2
 *
 * ScrapeCreators API Reference:
 * - Base URL: https://api.scrapecreators.com
 * - Auth: x-api-key header
 * - Profile endpoint: /v1/linkedin/profile?handle={handle}
 * - Post endpoint: /v1/linkedin/post?url={url}
 *
 * NOTE: ScrapeCreators does not have a dedicated "search posts" endpoint.
 * This implementation fetches posts from known profiles based on query keywords.
 * The implementation may need adjustment based on actual API capabilities.
 */

import axios from 'axios';
import { RawItemSchema, SCHEMA_VERSION, createDefaultEngagement } from '../schemas/rawItem.js';
import type { RawItem, Engagement } from '../schemas/rawItem.js';
import type { PipelineConfig } from '../types/index.js';
import { getApiKey, hasApiKey, API_CONCURRENCY_LIMITS } from '../config.js';
import { generateContentHash, normalizeUrl, normalizeTimestamp } from '../processing/normalize.js';
import { withRetry, DEFAULT_RETRY_OPTIONS } from '../utils/retry.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';
import { generateStableId } from '../utils/stableId.js';

// ============================================
// Constants
// ============================================

const SCRAPECREATORS_BASE_URL = 'https://api.scrapecreators.com';

/**
 * Track if compliance warning has been logged this session.
 * We only log it once per process.
 */
let complianceWarningLogged = false;

// ============================================
// API Response Types
// ============================================

/**
 * Author information from LinkedIn post response
 */
interface LinkedInAuthor {
  name?: string;
  url?: string;
  followers?: number;
}

/**
 * LinkedIn post from profile response
 */
interface LinkedInProfilePost {
  url?: string;
  text?: string;
  content?: string;
  timestamp?: string;
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
  reactionCount?: number;
}

/**
 * LinkedIn profile API response structure
 */
interface LinkedInProfileResponse {
  success?: boolean;
  name?: string;
  headline?: string;
  handle?: string;
  url?: string;
  followers?: number;
  posts?: LinkedInProfilePost[];
}

/**
 * LinkedIn post API response structure
 * Based on ScrapeCreators documentation
 */
interface LinkedInPostResponse {
  success?: boolean;
  url?: string;
  name?: string;
  headline?: string;
  description?: string;
  commentCount?: number;
  likeCount?: number;
  reactionCount?: number;
  shareCount?: number;
  datePublished?: string;
  author?: LinkedInAuthor;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Normalize LinkedIn handle to include @ prefix.
 * Consistent with Twitter handle normalization (PRD: "authorHandle: @handle for social").
 *
 * @param handle - Raw handle string (with or without @)
 * @returns Handle with @ prefix, or undefined if input is falsy
 */
function normalizeLinkedInHandle(handle?: string): string | undefined {
  if (!handle) return undefined;
  return handle.startsWith('@') ? handle : `@${handle}`;
}

/**
 * Safely normalize an author URL, returning undefined if malformed.
 * Prevents invalid URLs from failing Zod validation on the entire item.
 *
 * @param url - Raw author URL string
 * @returns Normalized URL or undefined if invalid
 */
function safeNormalizeAuthorUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return normalizeUrl(url);
  } catch {
    logVerbose(`Invalid author URL, skipping: ${url}`);
    return undefined;
  }
}

/**
 * Log compliance warning on first use.
 * Only logs once per process to avoid spam.
 */
function logComplianceWarning(): void {
  if (!complianceWarningLogged) {
    logWarning(
      'Using LinkedIn sources may violate platform Terms of Service. Use at your own risk.'
    );
    complianceWarningLogged = true;
  }
}

/**
 * Build headers for ScrapeCreators API requests
 */
function buildHeaders(): Record<string, string> {
  const apiKey = getApiKey('SCRAPECREATORS_API_KEY');
  return {
    'x-api-key': apiKey ?? '',
    'Content-Type': 'application/json',
  };
}

/**
 * Map LinkedIn engagement metrics to normalized Engagement object.
 * LinkedIn uses reactions (which includes likes) and comments.
 *
 * @param post - Post data with engagement metrics
 * @returns Normalized engagement object
 */
function mapEngagement(post: LinkedInPostResponse | LinkedInProfilePost): Engagement {
  const engagement = createDefaultEngagement();

  // LinkedIn "likeCount" maps to our "likes"
  // Some responses use "reactionCount" which includes all reaction types
  if ('likeCount' in post && typeof post.likeCount === 'number') {
    engagement.likes = post.likeCount;
  } else if ('reactionCount' in post && typeof post.reactionCount === 'number') {
    engagement.likes = post.reactionCount;
  }

  // Comments map directly
  if ('commentCount' in post && typeof post.commentCount === 'number') {
    engagement.comments = post.commentCount;
  }

  // Shares/reposts
  if ('shareCount' in post && typeof (post as LinkedInPostResponse).shareCount === 'number') {
    engagement.shares = (post as LinkedInPostResponse).shareCount!;
  } else if ('repostCount' in post && typeof post.repostCount === 'number') {
    engagement.shares = post.repostCount;
  }

  // Store original reactions count in LinkedIn-specific field
  if ('reactionCount' in post && typeof post.reactionCount === 'number') {
    engagement.reactions = post.reactionCount;
  }

  return engagement;
}

/**
 * Convert a LinkedIn post response to a RawItem.
 *
 * @param post - API response for a single post
 * @param retrievedAt - ISO timestamp when data was retrieved
 * @returns RawItem or null if essential data is missing
 */
function postResponseToRawItem(
  post: LinkedInPostResponse,
  retrievedAt: string
): RawItem | null {
  // Content is required - skip if missing
  const content = post.description || post.headline || '';
  if (!content.trim()) {
    logVerbose('Skipping LinkedIn post: no content');
    return null;
  }

  // sourceUrl is required - skip if missing
  const sourceUrl = post.url;
  if (!sourceUrl) {
    logVerbose('Skipping LinkedIn post: no URL');
    return null;
  }

  // Normalize URL
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(sourceUrl);
  } catch {
    logVerbose(`Skipping LinkedIn post: invalid URL: ${sourceUrl}`);
    return null;
  }

  // Generate content hash for deduplication
  const contentHash = generateContentHash(content);

  // Parse publication date if available
  let publishedAt: string | undefined;
  if (post.datePublished) {
    try {
      publishedAt = normalizeTimestamp(post.datePublished);
    } catch {
      logVerbose(`Could not parse datePublished: ${post.datePublished}`);
    }
  }

  // Extract author info with safe URL normalization
  const author = post.author?.name;
  const authorUrl = safeNormalizeAuthorUrl(post.author?.url);

  // Build the RawItem with stable ID (same sourceUrl + contentHash + publishedAt = same ID across runs)
  const item: RawItem = {
    id: generateStableId(normalizedUrl, contentHash, publishedAt),
    schemaVersion: SCHEMA_VERSION,
    source: 'linkedin',
    sourceUrl: normalizedUrl,
    retrievedAt,
    content,
    contentHash,
    title: post.name,
    author,
    authorUrl,
    engagement: mapEngagement(post),
  };

  // Add optional publishedAt
  if (publishedAt) {
    item.publishedAt = publishedAt;
  }

  return item;
}

/**
 * Convert a profile post to a RawItem.
 * Profile posts have a slightly different structure than standalone post responses.
 *
 * @param post - Post from profile response
 * @param profileData - Parent profile data for author info
 * @param retrievedAt - ISO timestamp when data was retrieved
 * @returns RawItem or null if essential data is missing
 */
function profilePostToRawItem(
  post: LinkedInProfilePost,
  profileData: LinkedInProfileResponse,
  retrievedAt: string
): RawItem | null {
  // Content is required
  const content = post.text || post.content || '';
  if (!content.trim()) {
    logVerbose('Skipping LinkedIn profile post: no content');
    return null;
  }

  // sourceUrl is required
  const sourceUrl = post.url;
  if (!sourceUrl) {
    logVerbose('Skipping LinkedIn profile post: no URL');
    return null;
  }

  // Normalize URL
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(sourceUrl);
  } catch {
    logVerbose(`Skipping LinkedIn profile post: invalid URL: ${sourceUrl}`);
    return null;
  }

  // Generate content hash
  const contentHash = generateContentHash(content);

  // Parse publication date if available
  let publishedAt: string | undefined;
  if (post.timestamp) {
    try {
      publishedAt = normalizeTimestamp(post.timestamp);
    } catch {
      logVerbose(`Could not parse timestamp: ${post.timestamp}`);
    }
  }

  // Build the RawItem with stable ID (same sourceUrl + contentHash + publishedAt = same ID across runs)
  const item: RawItem = {
    id: generateStableId(normalizedUrl, contentHash, publishedAt),
    schemaVersion: SCHEMA_VERSION,
    source: 'linkedin',
    sourceUrl: normalizedUrl,
    retrievedAt,
    content,
    contentHash,
    author: profileData.name,
    authorHandle: normalizeLinkedInHandle(profileData.handle),
    authorUrl: safeNormalizeAuthorUrl(profileData.url),
    engagement: mapEngagement(post),
  };

  // Add optional publishedAt
  if (publishedAt) {
    item.publishedAt = publishedAt;
  }

  return item;
}

/**
 * Validate an item against RawItemSchema.
 * Returns the item if valid, null if invalid.
 *
 * @param item - RawItem to validate
 * @returns Validated RawItem or null
 */
function validateItem(item: RawItem): RawItem | null {
  const result = RawItemSchema.safeParse(item);
  if (result.success) {
    return result.data;
  }
  logVerbose(`LinkedIn item failed validation: ${result.error.message}`);
  return null;
}

// ============================================
// API Functions
// ============================================

/**
 * Fetch posts from a LinkedIn profile.
 *
 * NOTE: The ScrapeCreators API returns recent posts as part of the profile data.
 * This is the primary way to get LinkedIn posts without a direct search endpoint.
 *
 * @param handle - LinkedIn profile handle/username
 * @returns Array of RawItem from the profile's posts
 */
async function fetchProfilePosts(handle: string): Promise<RawItem[]> {
  const url = `${SCRAPECREATORS_BASE_URL}/v1/linkedin/profile`;
  const retrievedAt = new Date().toISOString();

  logVerbose(`Fetching LinkedIn profile: ${handle}`);

  const result = await withRetry(
    async () => {
      const response = await axios.get<LinkedInProfileResponse>(url, {
        params: { handle },
        headers: buildHeaders(),
        timeout: 30000,
      });
      return response.data;
    },
    {
      ...DEFAULT_RETRY_OPTIONS,
      operationName: `LinkedIn profile fetch (${handle})`,
    }
  );

  if (!result.success) {
    logVerbose(`Failed to fetch LinkedIn profile ${handle}: ${result.error.message}`);
    return [];
  }

  const profileData = result.data;

  if (!profileData.success) {
    logVerbose(`LinkedIn API returned success=false for profile ${handle}`);
    return [];
  }

  // Extract posts from profile
  const posts = profileData.posts || [];
  logVerbose(`Found ${posts.length} posts in LinkedIn profile ${handle}`);

  // Convert to RawItems
  const items: RawItem[] = [];
  for (const post of posts) {
    const item = profilePostToRawItem(post, profileData, retrievedAt);
    if (item) {
      const validated = validateItem(item);
      if (validated) {
        items.push(validated);
      }
    }
  }

  return items;
}

/**
 * Fetch a single LinkedIn post by URL.
 *
 * @param postUrl - Full LinkedIn post URL
 * @returns RawItem or null if fetch failed
 */
async function fetchPost(postUrl: string): Promise<RawItem | null> {
  const url = `${SCRAPECREATORS_BASE_URL}/v1/linkedin/post`;
  const retrievedAt = new Date().toISOString();

  logVerbose(`Fetching LinkedIn post: ${postUrl}`);

  const result = await withRetry(
    async () => {
      const response = await axios.get<LinkedInPostResponse>(url, {
        params: { url: postUrl },
        headers: buildHeaders(),
        timeout: 30000,
      });
      return response.data;
    },
    {
      ...DEFAULT_RETRY_OPTIONS,
      operationName: `LinkedIn post fetch`,
    }
  );

  if (!result.success) {
    logVerbose(`Failed to fetch LinkedIn post: ${result.error.message}`);
    return null;
  }

  const postData = result.data;

  if (!postData.success) {
    logVerbose(`LinkedIn API returned success=false for post`);
    return null;
  }

  const item = postResponseToRawItem(postData, retrievedAt);
  if (!item) {
    return null;
  }

  return validateItem(item);
}

// ============================================
// Main Export
// ============================================

/**
 * Known thought leaders and influencers on LinkedIn.
 * These profiles are queried when searching for LinkedIn content.
 *
 * In a production system, this could be:
 * 1. Dynamically built based on the query topic
 * 2. Loaded from a configuration file
 * 3. Discovered via a separate API endpoint
 *
 * NOTE: Since ScrapeCreators doesn't have a search endpoint,
 * we fetch from known profiles. This is a limitation of the current API.
 */
const DEFAULT_LINKEDIN_PROFILES = [
  'satyanadella',
  'jeffweiner08',
  'raborenstein',
  'barackobama',
  'melaborenstein',
];

/**
 * Search LinkedIn posts using ScrapeCreators API.
 *
 * This is an OPTIONAL source - if this fails, log warning and return empty array.
 *
 * IMPORTANT: Since ScrapeCreators doesn't provide a LinkedIn search endpoint,
 * this function fetches recent posts from known profiles. The query parameter
 * is currently not used for actual filtering (posts are returned as-is).
 *
 * In a production system, you would either:
 * 1. Use a different API that supports LinkedIn search
 * 2. Implement client-side filtering based on query keywords
 * 3. Dynamically select profiles based on query topic
 *
 * @param query - Search query / topic (for future filtering implementation)
 * @param config - Pipeline configuration
 * @returns Array of RawItem from LinkedIn, or empty array on failure
 */
export async function searchLinkedIn(
  query: string,
  config: PipelineConfig
): Promise<RawItem[]> {
  // ========================================
  // Gate check: Only run if linkedin is in sources
  // ========================================
  if (!config.sources.includes('linkedin')) {
    logVerbose('LinkedIn collector skipped: not in config.sources');
    return [];
  }

  // ========================================
  // API key validation
  // ========================================
  if (!hasApiKey('SCRAPECREATORS_API_KEY')) {
    logWarning('LinkedIn collector skipped: SCRAPECREATORS_API_KEY not configured');
    return [];
  }

  // ========================================
  // Log compliance warning on first use
  // ========================================
  logComplianceWarning();

  logInfo(`Searching LinkedIn for: "${query}"`);

  // ========================================
  // Fetch posts from profiles
  // ========================================
  const allItems: RawItem[] = [];
  const concurrencyLimit = API_CONCURRENCY_LIMITS.scrapeCreators;

  try {
    // Process profiles in batches respecting concurrency limit
    const profiles = DEFAULT_LINKEDIN_PROFILES;

    for (let i = 0; i < profiles.length; i += concurrencyLimit) {
      const batch = profiles.slice(i, i + concurrencyLimit);

      logVerbose(
        `Processing LinkedIn profiles batch ${Math.floor(i / concurrencyLimit) + 1}: ${batch.join(', ')}`
      );

      // Fetch profiles in parallel (within concurrency limit)
      const batchResults = await Promise.allSettled(
        batch.map((handle) => fetchProfilePosts(handle))
      );

      // Collect successful results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          allItems.push(...result.value);
        } else {
          // Log but don't fail - this is non-fatal
          logVerbose(`LinkedIn profile fetch failed: ${result.reason}`);
        }
      }
    }

    logVerbose(`LinkedIn collection complete: ${allItems.length} items total`);

    return allItems;
  } catch (error) {
    // Catch-all for unexpected errors - non-fatal for optional source
    const errorMessage = error instanceof Error ? error.message : String(error);
    logWarning(`LinkedIn collector error (non-fatal): ${errorMessage}`);
    return [];
  }
}

// Export fetchPost for potential direct use (e.g., fetching specific post URLs)
export { fetchPost };
