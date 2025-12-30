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
import { loadLinkedInProfiles, selectLinkedInProfiles } from '../utils/handleLoader.js';

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
 * LinkedIn post from profile response (legacy format)
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
 * LinkedIn activity item from profile response
 * This is the actual format returned by ScrapeCreators API
 */
interface LinkedInActivityItem {
  title?: string;         // Post content/text
  activityType?: string;  // e.g., "Shared by Satya Nadella", "Liked by Satya Nadella"
  link?: string;          // Post URL
  image?: string;         // Optional image URL
}

/**
 * LinkedIn article from profile response
 */
interface LinkedInArticle {
  headline?: string;
  author?: string;
  datePublished?: string;
  url?: string;
  articleBody?: string;
  image?: string;
}

/**
 * LinkedIn profile API response structure
 * Updated to match actual ScrapeCreators API response format
 */
interface LinkedInProfileResponse {
  success?: boolean;
  name?: string;
  headline?: string;
  handle?: string;
  url?: string;
  followers?: number;
  about?: string;
  location?: string;
  // Legacy format (may be empty)
  posts?: LinkedInProfilePost[];
  recentPosts?: LinkedInProfilePost[];
  // Actual data from ScrapeCreators API
  activity?: LinkedInActivityItem[];
  articles?: LinkedInArticle[];
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
 * Extract keywords from a query for relevance filtering.
 * Used to filter LinkedIn posts client-side since the API doesn't support search.
 *
 * @param query - Original query (may be long paragraph)
 * @returns Array of lowercase keywords for matching
 */
function extractQueryKeywords(query: string): string[] {
  const keywords: string[] = [];

  // Extract tech terms (common in AI/enterprise topics)
  const techTerms = query.match(/\b(AI|ML|LLM|GPT|Claude|OpenAI|Anthropic|GitHub|Copilot|M365|Microsoft|Google|AWS|CLI|agent|agents|enterprise|software|developer|coding|automation)\b/gi) || [];
  keywords.push(...techTerms.map(t => t.toLowerCase()));

  // Extract years
  const years = query.match(/\b20\d{2}\b/g) || [];
  keywords.push(...years);

  // Extract capitalized terms (product names, proper nouns)
  const capitalizedTerms = query.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
  keywords.push(...capitalizedTerms.map(t => t.toLowerCase()));

  // Deduplicate
  return [...new Set(keywords)];
}

/**
 * Check if a post is relevant to the query keywords.
 * Uses simple keyword matching for client-side filtering.
 *
 * @param content - Post content to check
 * @param keywords - Keywords extracted from query
 * @param minMatches - Minimum keyword matches required (default: 1)
 * @returns true if post matches enough keywords
 */
function isPostRelevant(content: string, keywords: string[], minMatches = 1): boolean {
  if (keywords.length === 0) return true; // No filtering if no keywords

  const contentLower = content.toLowerCase();
  let matches = 0;

  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) {
      matches++;
      if (matches >= minMatches) return true;
    }
  }

  return false;
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
 * Convert a LinkedIn activity item to a RawItem.
 * Activity items are the actual posts/shares from ScrapeCreators API.
 *
 * @param activity - Activity item from profile response
 * @param profileData - Parent profile data for author info
 * @param retrievedAt - ISO timestamp when data was retrieved
 * @returns RawItem or null if essential data is missing
 */
function activityToRawItem(
  activity: LinkedInActivityItem,
  profileData: LinkedInProfileResponse,
  retrievedAt: string
): RawItem | null {
  // Content is required
  const content = activity.title || '';
  if (!content.trim()) {
    logVerbose('Skipping LinkedIn activity: no content');
    return null;
  }

  // sourceUrl is required
  const sourceUrl = activity.link;
  if (!sourceUrl) {
    logVerbose('Skipping LinkedIn activity: no URL');
    return null;
  }

  // Normalize URL
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(sourceUrl);
  } catch {
    logVerbose(`Skipping LinkedIn activity: invalid URL: ${sourceUrl}`);
    return null;
  }

  // Generate content hash
  const contentHash = generateContentHash(content);

  // Build the RawItem with stable ID
  const item: RawItem = {
    id: generateStableId(normalizedUrl, contentHash, undefined),
    schemaVersion: SCHEMA_VERSION,
    source: 'linkedin',
    sourceUrl: normalizedUrl,
    retrievedAt,
    content,
    contentHash,
    author: profileData.name,
    authorHandle: normalizeLinkedInHandle(profileData.handle),
    authorUrl: safeNormalizeAuthorUrl(profileData.url),
    engagement: createDefaultEngagement(),
  };

  return item;
}

/**
 * Convert a LinkedIn article to a RawItem.
 * Articles are LinkedIn Pulse articles with headlines and dates.
 *
 * @param article - Article from profile response
 * @param profileData - Parent profile data for author info
 * @param retrievedAt - ISO timestamp when data was retrieved
 * @returns RawItem or null if essential data is missing
 */
function articleToRawItem(
  article: LinkedInArticle,
  profileData: LinkedInProfileResponse,
  retrievedAt: string
): RawItem | null {
  // Content is required - use headline + articleBody
  const content = article.headline || '';
  if (!content.trim()) {
    logVerbose('Skipping LinkedIn article: no headline');
    return null;
  }

  // sourceUrl is required
  const sourceUrl = article.url;
  if (!sourceUrl) {
    logVerbose('Skipping LinkedIn article: no URL');
    return null;
  }

  // Normalize URL
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(sourceUrl);
  } catch {
    logVerbose(`Skipping LinkedIn article: invalid URL: ${sourceUrl}`);
    return null;
  }

  // Generate content hash
  const contentHash = generateContentHash(content);

  // Parse publication date if available
  let publishedAt: string | undefined;
  if (article.datePublished) {
    try {
      publishedAt = normalizeTimestamp(article.datePublished);
    } catch {
      logVerbose(`Could not parse article datePublished: ${article.datePublished}`);
    }
  }

  // Build the RawItem with stable ID
  const item: RawItem = {
    id: generateStableId(normalizedUrl, contentHash, publishedAt),
    schemaVersion: SCHEMA_VERSION,
    source: 'linkedin',
    sourceUrl: normalizedUrl,
    retrievedAt,
    content,
    contentHash,
    title: article.headline,
    author: article.author || profileData.name,
    authorHandle: normalizeLinkedInHandle(profileData.handle),
    authorUrl: safeNormalizeAuthorUrl(profileData.url),
    engagement: createDefaultEngagement(),
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
 * Convert a LinkedIn handle to a profile URL.
 * ScrapeCreators API may accept either handle or url parameter.
 *
 * @param handle - LinkedIn profile handle/username (e.g., 'satyanadella')
 * @returns Full LinkedIn profile URL
 */
function handleToProfileUrl(handle: string): string {
  // Remove @ prefix if present
  const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
  return `https://linkedin.com/in/${cleanHandle}`;
}

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
  const apiEndpoint = `${SCRAPECREATORS_BASE_URL}/v1/linkedin/profile`;
  const profileUrl = handleToProfileUrl(handle);
  const retrievedAt = new Date().toISOString();

  logVerbose(`Fetching LinkedIn profile: ${handle} (${profileUrl})`);

  const result = await withRetry(
    async () => {
      const response = await axios.get<LinkedInProfileResponse>(apiEndpoint, {
        params: { url: profileUrl },
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

  // ScrapeCreators API returns data in multiple fields:
  // - activity: Recent posts/shares/likes (most useful)
  // - articles: LinkedIn Pulse articles
  // - posts/recentPosts: Often empty in practice
  const activity = profileData.activity || [];
  const articles = profileData.articles || [];
  const legacyPosts = profileData.posts || profileData.recentPosts || [];

  logVerbose(
    `Found in LinkedIn profile ${handle}: ${activity.length} activities, ${articles.length} articles, ${legacyPosts.length} legacy posts`
  );

  // Convert to RawItems from all sources
  const items: RawItem[] = [];

  // Process activity items (posts/shares)
  for (const act of activity) {
    const item = activityToRawItem(act, profileData, retrievedAt);
    if (item) {
      const validated = validateItem(item);
      if (validated) {
        items.push(validated);
      }
    }
  }

  // Process articles
  for (const article of articles) {
    const item = articleToRawItem(article, profileData, retrievedAt);
    if (item) {
      const validated = validateItem(item);
      if (validated) {
        items.push(validated);
      }
    }
  }

  // Process legacy posts (if any)
  for (const post of legacyPosts) {
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
 * Search LinkedIn posts using ScrapeCreators API.
 *
 * This is an OPTIONAL source - if this fails, log warning and return empty array.
 *
 * Strategy:
 * 1. Select relevant profiles based on query keywords (AI, enterprise, software, etc.)
 * 2. Fetch posts from selected profiles
 * 3. Filter posts client-side for relevance to query
 *
 * @param query - Search query / topic used for profile selection and filtering
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

  // Extract keywords for filtering and truncate long query for logging
  const keywords = extractQueryKeywords(query);
  const displayQuery = query.length > 80 ? query.substring(0, 80) + '...' : query;
  logInfo(`Searching LinkedIn for: "${displayQuery}"`);
  logVerbose(`LinkedIn: Extracted ${keywords.length} keywords for filtering: ${keywords.slice(0, 10).join(', ')}`);

  // ========================================
  // Load profiles from file
  // ========================================
  const allProfiles = loadLinkedInProfiles();
  if (allProfiles.length === 0) {
    logWarning('LinkedIn: No profiles loaded from ref/linkedin-handles.md');
    return [];
  }
  logInfo(`LinkedIn: Loaded ${allProfiles.length} profiles from file`);

  // Select profiles (max based on rate limits)
  const maxProfiles = Math.min(5, Math.ceil(config.maxPerSource / 20));
  const selectedProfiles = selectLinkedInProfiles(allProfiles, maxProfiles);
  logInfo(`LinkedIn: Selected profiles: ${selectedProfiles.map(p => p.slug).join(', ')}`);

  // Map to profile slugs for fetching
  const profileSlugs = selectedProfiles.map(p => p.slug);

  // ========================================
  // Fetch posts from profiles
  // ========================================
  const allItems: RawItem[] = [];
  const concurrencyLimit = API_CONCURRENCY_LIMITS.scrapeCreators;

  try {
    for (let i = 0; i < profileSlugs.length; i += concurrencyLimit) {
      const batch = profileSlugs.slice(i, i + concurrencyLimit);

      logVerbose(
        `Processing LinkedIn profiles batch ${Math.floor(i / concurrencyLimit) + 1}: ${batch.join(', ')}`
      );

      // Fetch profiles in parallel (within concurrency limit)
      const batchResults = await Promise.allSettled(
        batch.map((slug: string) => fetchProfilePosts(slug))
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

    logVerbose(`LinkedIn: Fetched ${allItems.length} items before filtering`);

    // ========================================
    // Client-side filtering by relevance
    // ========================================
    const filteredItems = allItems.filter(item =>
      isPostRelevant(item.content, keywords, 1)
    );

    logVerbose(`LinkedIn collection complete: ${filteredItems.length}/${allItems.length} items passed relevance filter`);

    return filteredItems;
  } catch (error) {
    // Catch-all for unexpected errors - non-fatal for optional source
    const errorMessage = error instanceof Error ? error.message : String(error);
    logWarning(`LinkedIn collector error (non-fatal): ${errorMessage}`);
    return [];
  }
}

// Export fetchPost for potential direct use (e.g., fetching specific post URLs)
export { fetchPost };
