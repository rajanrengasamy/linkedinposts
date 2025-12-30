/**
 * Twitter/X Collector - ScrapeCreators API
 *
 * OPTIONAL, GATED data source. Non-fatal on failure.
 * Requires 'x' in config.sources and SCRAPECREATORS_API_KEY set.
 *
 * COMPLIANCE WARNING: Using X/Twitter data may violate platform ToS.
 * Use at your own risk for personal/research purposes only.
 */

import axios from 'axios';
import { RawItemSchema, SCHEMA_VERSION } from '../schemas/rawItem.js';
import type { RawItem, Engagement } from '../schemas/rawItem.js';
import type { PipelineConfig } from '../types/index.js';
import { getApiKey, hasApiKey, API_CONCURRENCY_LIMITS } from '../config.js';
import { generateContentHash, normalizeUrl, normalizeTimestamp } from '../processing/normalize.js';
import { withRetry, DEFAULT_RETRY_OPTIONS } from '../utils/retry.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';
import { generateStableId } from '../utils/stableId.js';
import { loadXHandles, selectHandlesByTopic, type XHandle } from '../utils/handleLoader.js';

// ============================================
// Constants
// ============================================

const SCRAPECREATORS_BASE_URL = 'https://api.scrapecreators.com';

/**
 * Compliance warning - logged once per session
 */
let complianceWarningLogged = false;

// ============================================
// ScrapeCreators API Types
// ============================================

/**
 * Nested legacy structure from /v1/twitter/user-tweets endpoint.
 * Twitter's raw API wraps tweet data in a `legacy` object.
 *
 * Example format: "Mon Feb 24 18:58:38 +0000 2025" for created_at
 */
interface TweetLegacy {
  bookmark_count?: number;
  created_at?: string;
  conversation_id_str?: string;
  full_text?: string;
  favorite_count?: number;
  quote_count?: number;
  reply_count?: number;
  retweet_count?: number;
  lang?: string;
  is_quote_status?: boolean;
  entities?: {
    hashtags?: Array<{ text: string }>;
    urls?: Array<{ expanded_url: string }>;
    user_mentions?: Array<{ screen_name: string }>;
  };
}

/**
 * Tweet data from ScrapeCreators API response.
 *
 * Supports TWO response formats:
 * 1. OLD: /v1/twitter/search - flat structure with fields at top level
 * 2. NEW: /v1/twitter/user-tweets - nested `legacy` object with tweet data
 *
 * Helper functions check `legacy` first, then fall back to flat fields.
 */
interface ScrapeCreatorsTweet {
  // Tweet identity (flat structure)
  id?: string;
  tweet_id?: string;

  // Content (flat structure)
  text?: string;
  full_text?: string;
  content?: string;

  // Author info (flat structure)
  user?: {
    id?: string;
    name?: string;
    screen_name?: string;
    username?: string;
    profile_url?: string;
  };
  author?: {
    id?: string;
    name?: string;
    screen_name?: string;
    username?: string;
  };

  // Engagement metrics (flat structure)
  favorite_count?: number;
  like_count?: number;
  likes?: number;
  retweet_count?: number;
  retweets?: number;
  quote_count?: number;
  quotes?: number;
  reply_count?: number;
  replies?: number;
  view_count?: number;
  views?: number;
  impressions?: number;

  // Timestamps (flat structure)
  created_at?: string;
  timestamp?: string;
  date?: string;

  // URL (flat structure)
  url?: string;
  tweet_url?: string;

  // NEW: Nested legacy structure from /v1/twitter/user-tweets endpoint
  legacy?: TweetLegacy;
}

/**
 * Response from /v1/twitter/user-tweets endpoint.
 * Tweets may be wrapped in data/tweets/results arrays.
 */
interface UserTweetsResponse {
  data?: ScrapeCreatorsTweet[];
  tweets?: ScrapeCreatorsTweet[];
  results?: ScrapeCreatorsTweet[];
  // Single tweet case (legacy at root)
  legacy?: TweetLegacy;
  success?: boolean;
  error?: string;
}

/**
 * ScrapeCreators search response structure.
 * Used for both /v1/twitter/search and /v1/twitter/user-tweets endpoints.
 */
interface ScrapeCreatorsSearchResponse {
  data?: ScrapeCreatorsTweet[];
  tweets?: ScrapeCreatorsTweet[];
  results?: ScrapeCreatorsTweet[];
  success?: boolean;
  error?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Decode HTML entities commonly found in Twitter API responses.
 * Twitter encodes special characters as HTML entities in full_text.
 *
 * @param text - Text with potential HTML entities
 * @returns Decoded text with actual characters
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Extract tweet ID from various possible fields.
 * Returns null if no real ID exists - never fabricates IDs.
 *
 * Checks legacy.conversation_id_str first (user-tweets endpoint),
 * then falls back to flat id/tweet_id fields (search endpoint).
 */
function extractTweetId(tweet: ScrapeCreatorsTweet): string | null {
  // Try new legacy structure first (user-tweets endpoint)
  if (tweet.legacy?.conversation_id_str) {
    return tweet.legacy.conversation_id_str;
  }
  // Fall back to flat structure (search endpoint)
  return tweet.id ?? tweet.tweet_id ?? null;
}

/**
 * Extract tweet content from various possible fields.
 *
 * Checks legacy.full_text first (user-tweets endpoint),
 * then falls back to flat text/full_text/content fields (search endpoint).
 * Decodes HTML entities from Twitter API responses.
 */
function extractContent(tweet: ScrapeCreatorsTweet): string {
  // Try new legacy structure first (user-tweets endpoint)
  if (tweet.legacy?.full_text) {
    return decodeHtmlEntities(tweet.legacy.full_text);
  }
  // Fall back to flat structure (search endpoint)
  const content = tweet.text ?? tweet.full_text ?? tweet.content ?? '';
  return decodeHtmlEntities(content);
}

/**
 * Extract author handle from nested user/author object
 */
function extractAuthorHandle(tweet: ScrapeCreatorsTweet): string | undefined {
  const user = tweet.user ?? tweet.author;
  if (!user) return undefined;

  const handle = user.screen_name ?? user.username;
  if (!handle) return undefined;

  // Ensure @ prefix for consistency
  return handle.startsWith('@') ? handle : `@${handle}`;
}

/**
 * Extract author display name
 */
function extractAuthorName(tweet: ScrapeCreatorsTweet): string | undefined {
  const user = tweet.user ?? tweet.author;
  return user?.name;
}

/**
 * Build tweet URL from ID and author handle.
 * Returns null if tweetId is null - never fabricates URLs.
 *
 * NOTE: Uses twitter.com for consistency with ScrapeCreators API responses,
 * which return twitter.com URLs. Twitter/X redirects between domains.
 */
function buildTweetUrl(tweetId: string | null, authorHandle?: string): string | null {
  if (tweetId === null) {
    return null;
  }
  // Clean the handle (remove @ if present)
  const cleanHandle = authorHandle?.replace(/^@/, '') ?? 'i';
  return `https://twitter.com/${cleanHandle}/status/${tweetId}`;
}

/**
 * Safely extract a numeric value from a field that might be number or object.
 * X API sometimes returns metrics as objects with nested values.
 */
function extractNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    // Try common nested field names
    const obj = value as Record<string, unknown>;
    if (typeof obj.count === 'number') return obj.count;
    if (typeof obj.value === 'number') return obj.value;
    if (typeof obj.total === 'number') return obj.total;
  }
  return undefined;
}

/**
 * Extract and normalize engagement metrics.
 *
 * Checks legacy structure first (user-tweets endpoint),
 * then falls back to flat fields (search endpoint).
 */
function extractEngagement(tweet: ScrapeCreatorsTweet): Engagement {
  const legacy = tweet.legacy;

  // Try legacy structure first, then fall back to flat fields
  const likes = legacy?.favorite_count ?? tweet.favorite_count ?? tweet.like_count ?? tweet.likes ?? 0;
  const retweets = legacy?.retweet_count ?? tweet.retweet_count ?? tweet.retweets ?? 0;
  const quotes = legacy?.quote_count ?? tweet.quote_count ?? tweet.quotes ?? 0;
  const replies = legacy?.reply_count ?? tweet.reply_count ?? tweet.replies ?? 0;
  const bookmarks = legacy?.bookmark_count;

  // Impressions may be returned as an object by the X API - extract numeric value
  const rawImpressions = tweet.view_count ?? tweet.views ?? tweet.impressions;
  const impressions = extractNumericValue(rawImpressions);

  return {
    // Base engagement (normalized across platforms)
    likes,
    comments: replies, // Map replies to comments for normalized view
    shares: retweets, // Map retweets to shares for normalized view

    // X/Twitter-specific fields
    retweets,
    quotes,
    replies,
    ...(bookmarks !== undefined && { bookmarks }),
    ...(impressions !== undefined && { impressions }),
  };
}

/**
 * Extract and normalize timestamp.
 *
 * Checks legacy.created_at first (user-tweets endpoint),
 * then falls back to flat fields (search endpoint).
 *
 * Handles Twitter's date format: "Mon Feb 24 18:58:38 +0000 2025"
 */
function extractTimestamp(tweet: ScrapeCreatorsTweet): string | undefined {
  const rawDate = tweet.legacy?.created_at ?? tweet.created_at ?? tweet.timestamp ?? tweet.date;
  if (!rawDate) return undefined;

  try {
    // Twitter's format: "Mon Feb 24 18:58:38 +0000 2025"
    // JavaScript's Date constructor handles this format natively
    const date = new Date(rawDate);
    if (isNaN(date.getTime())) {
      // If native parsing fails, try normalizeTimestamp as fallback
      return normalizeTimestamp(rawDate);
    }
    return date.toISOString();
  } catch {
    logVerbose(`Twitter: Failed to parse timestamp: ${rawDate}`);
    return undefined;
  }
}

/**
 * Extract hashtags from tweet entities.
 * Available from legacy.entities.hashtags in user-tweets endpoint.
 *
 * @param tweet - Tweet data
 * @returns Array of hashtag text (without # prefix)
 */
function extractHashtags(tweet: ScrapeCreatorsTweet): string[] {
  const hashtags = tweet.legacy?.entities?.hashtags ?? [];
  return hashtags.map(h => h.text);
}

/**
 * Extract keywords from query for relevance filtering.
 * Used to filter tweets client-side after fetching from user handles.
 */
function extractQueryKeywords(query: string): string[] {
  const keywords: string[] = [];

  // Tech terms
  const techTerms = query.match(/\b(AI|ML|LLM|GPT|Claude|OpenAI|Anthropic|agent|agents|software|developer|coding)\b/gi) || [];
  keywords.push(...techTerms.map(t => t.toLowerCase()));

  // Years
  const years = query.match(/\b20\d{2}\b/g) || [];
  keywords.push(...years);

  // Capitalized terms (product names)
  const capitalizedTerms = query.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
  keywords.push(...capitalizedTerms.map(t => t.toLowerCase()));

  return [...new Set(keywords)];
}

/**
 * Check if tweet content is relevant to query keywords.
 * Returns true if content contains at least minMatches keywords.
 */
function isTweetRelevant(content: string, keywords: string[], minMatches = 1): boolean {
  if (keywords.length === 0) return true;

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
 * Log compliance warning once per session
 */
function logComplianceWarningOnce(): void {
  if (!complianceWarningLogged) {
    logWarning(
      'Using X/Twitter sources may violate platform Terms of Service. Use at your own risk.'
    );
    complianceWarningLogged = true;
  }
}

/**
 * Simplify a long query into Twitter-friendly keywords.
 * Twitter search works best with short keyword queries, not paragraphs.
 *
 * Strategy:
 * 1. If query is short enough (<100 chars), use as-is
 * 2. Otherwise, extract key terms (capitalized words, quoted phrases, hashtags)
 * 3. Limit to ~80 chars to avoid API issues
 *
 * @param query - Original query (may be long paragraph)
 * @returns Simplified keyword query for Twitter search
 */
function simplifyQueryForTwitter(query: string): string {
  // If already short, use as-is
  if (query.length < 100) {
    return query;
  }

  logVerbose(`Twitter: Simplifying long query (${query.length} chars)`);

  // Extract potentially important terms:
  // - Capitalized words/phrases (proper nouns, products)
  // - Words in quotes
  // - Hashtags
  // - Numbers with context (e.g., "2025")
  const keywords: string[] = [];

  // Extract quoted phrases
  const quotedPhrases = query.match(/"[^"]+"/g) || [];
  keywords.push(...quotedPhrases);

  // Extract capitalized terms (2+ chars, not at sentence start)
  const capitalizedTerms = query.match(/(?<=[a-z]\s)[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*/g) || [];
  keywords.push(...capitalizedTerms);

  // Extract product/tech names (common patterns)
  const techTerms = query.match(/\b(AI|ML|LLM|GPT|Claude|OpenAI|Anthropic|GitHub|Copilot|M365|Microsoft|Google|AWS|CLI)\b/gi) || [];
  keywords.push(...techTerms);

  // Extract years
  const years = query.match(/\b20\d{2}\b/g) || [];
  keywords.push(...years);

  // Extract hashtag-like terms
  const hashtags = query.match(/#\w+/g) || [];
  keywords.push(...hashtags);

  // Deduplicate and clean
  const uniqueKeywords = [...new Set(keywords.map(k => k.trim()))];

  // Build query string, limiting to ~80 chars
  let simplified = '';
  for (const keyword of uniqueKeywords) {
    if ((simplified + ' ' + keyword).length > 80) break;
    simplified += (simplified ? ' ' : '') + keyword;
  }

  // Fallback: if nothing extracted, take first 80 chars
  if (!simplified) {
    simplified = query.substring(0, 80).trim();
    // Try to break at word boundary
    const lastSpace = simplified.lastIndexOf(' ');
    if (lastSpace > 40) {
      simplified = simplified.substring(0, lastSpace);
    }
  }

  logVerbose(`Twitter: Simplified query to: "${simplified}"`);
  return simplified;
}

// ============================================
// API Functions
// ============================================

/**
 * Make authenticated request to ScrapeCreators Twitter API (DEPRECATED)
 *
 * NOTE: This function is kept for backwards compatibility but is no longer
 * used by the main searchTwitter() function, which now uses handle-based
 * fetching via makeUserTweetsRequest().
 *
 * PRECONDITION: Caller must verify SCRAPECREATORS_API_KEY exists via hasApiKey()
 */
async function makeTwitterRequest(
  endpoint: string,
  params: Record<string, string>
): Promise<ScrapeCreatorsSearchResponse> {
  const apiKey = getApiKey('SCRAPECREATORS_API_KEY');
  // Assert: API key must exist - searchTwitter checks hasApiKey() before calling
  if (!apiKey) {
    throw new Error('Internal error: SCRAPECREATORS_API_KEY missing (caller should check hasApiKey first)');
  }

  const url = `${SCRAPECREATORS_BASE_URL}${endpoint}`;

  logVerbose(`Twitter: Making request to ${endpoint}`);

  const response = await axios.get<ScrapeCreatorsSearchResponse>(url, {
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    params,
    timeout: 30000, // 30 second timeout
  });

  return response.data;
}

/**
 * Fetch tweets for a specific user handle.
 * Uses /v1/twitter/user-tweets endpoint.
 *
 * @param handle - Twitter handle WITHOUT @ (e.g., "karpathy")
 */
async function makeUserTweetsRequest(handle: string): Promise<UserTweetsResponse> {
  const apiKey = getApiKey('SCRAPECREATORS_API_KEY');
  if (!apiKey) {
    throw new Error('Internal error: SCRAPECREATORS_API_KEY missing');
  }

  const url = `${SCRAPECREATORS_BASE_URL}/v1/twitter/user-tweets`;

  logVerbose(`Twitter: Fetching tweets for @${handle}`);

  const response = await axios.get<UserTweetsResponse>(url, {
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    params: {
      handle: handle, // WITHOUT the @
      trim: 'true',
    },
    timeout: 30000,
  });

  return response.data;
}

/**
 * Parse API response into tweets array.
 *
 * The /v1/twitter/user-tweets endpoint can return:
 * 1. Array wrapped in data/tweets/results
 * 2. Single tweet object with legacy at root
 * 3. Array of tweet objects with legacy inside each
 */
function extractTweetsFromResponse(response: UserTweetsResponse | ScrapeCreatorsSearchResponse): ScrapeCreatorsTweet[] {
  // Try array structures first
  if (response.data && Array.isArray(response.data) && response.data.length > 0) {
    logVerbose(`Twitter: Found ${response.data.length} tweets in response.data`);
    return response.data;
  }
  if (response.tweets && Array.isArray(response.tweets) && response.tweets.length > 0) {
    logVerbose(`Twitter: Found ${response.tweets.length} tweets in response.tweets`);
    return response.tweets;
  }
  if (response.results && Array.isArray(response.results) && response.results.length > 0) {
    logVerbose(`Twitter: Found ${response.results.length} tweets in response.results`);
    return response.results;
  }

  // Check if response itself has legacy (single tweet at root)
  if ('legacy' in response && response.legacy) {
    logVerbose('Twitter: Found single tweet with legacy at root');
    return [response as unknown as ScrapeCreatorsTweet];
  }

  // Check if response is an array directly
  if (Array.isArray(response)) {
    logVerbose(`Twitter: Response is array with ${response.length} tweets`);
    return response;
  }

  logVerbose(`Twitter: Could not extract tweets. Response keys: ${Object.keys(response).join(', ')}`);
  return [];
}

/**
 * Convert a single tweet to RawItem.
 * Returns null if no valid sourceUrl can be determined (PRD requirement).
 */
function tweetToRawItem(tweet: ScrapeCreatorsTweet): RawItem | null {
  const content = extractContent(tweet);

  // Skip empty content
  if (!content || content.trim().length === 0) {
    logVerbose('Twitter: Skipping tweet with empty content');
    return null;
  }

  const tweetId = extractTweetId(tweet);
  const authorHandle = extractAuthorHandle(tweet);

  // Build source URL - never fabricate URLs from synthetic IDs
  const sourceUrl = tweet.url ?? tweet.tweet_url ?? buildTweetUrl(tweetId, authorHandle);

  // Skip items without valid sourceUrl (PRD: verified source URL required)
  if (sourceUrl === null) {
    logVerbose('Twitter: Skipping tweet without valid source URL (no tweet ID or URL)');
    return null;
  }

  // Validate URL is present and valid
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(sourceUrl);
  } catch (error) {
    logVerbose(`Twitter: Invalid URL for tweet ${tweetId}: ${sourceUrl}`);
    return null;
  }

  // Generate content hash and timestamp for stable ID
  const contentHash = generateContentHash(content);
  const publishedAt = extractTimestamp(tweet);

  // Build RawItem with stable ID (same sourceUrl + contentHash + publishedAt = same ID across runs)
  const rawItem: RawItem = {
    id: generateStableId(normalizedUrl, contentHash, publishedAt),
    schemaVersion: SCHEMA_VERSION,
    source: 'x',
    sourceUrl: normalizedUrl,
    retrievedAt: new Date().toISOString(),
    content: content.trim(),
    contentHash,
    author: extractAuthorName(tweet),
    authorHandle,
    publishedAt,
    engagement: extractEngagement(tweet),
  };

  // Validate against schema
  const parseResult = RawItemSchema.safeParse(rawItem);
  if (!parseResult.success) {
    logVerbose(`Twitter: Schema validation failed for tweet ${tweetId}: ${parseResult.error.message}`);
    return null;
  }

  return parseResult.data;
}

/**
 * Fetch and parse tweets from a single user.
 *
 * @param handle - XHandle object with handle info
 * @returns Array of RawItem from user's tweets
 */
async function fetchUserTweets(handle: XHandle): Promise<RawItem[]> {
  const result = await withRetry(
    async () => makeUserTweetsRequest(handle.handle),
    {
      ...DEFAULT_RETRY_OPTIONS,
      operationName: `Twitter user tweets (@${handle.handle})`,
    }
  );

  if (!result.success) {
    logVerbose(`Twitter: Failed to fetch @${handle.handle}: ${result.error.message}`);
    return [];
  }

  const response = result.data;

  // Debug: log response structure
  logVerbose(`Twitter: Response for @${handle.handle} has keys: ${Object.keys(response).join(', ')}`);

  if (response.error) {
    logWarning(`Twitter: API error for @${handle.handle}: ${response.error}`);
    return [];
  }

  // Extract tweets from response (may be wrapped differently)
  const tweets = extractTweetsFromResponse(response);
  logInfo(`Twitter: Got ${tweets.length} tweets from @${handle.handle}`);

  // Convert to RawItems, passing handle info for URL construction
  const items: RawItem[] = [];
  for (const tweet of tweets) {
    // Inject handle for URL building if not present
    if (!tweet.user && !tweet.author) {
      tweet.user = { screen_name: handle.handle, name: handle.displayName };
    }

    const item = tweetToRawItem(tweet);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

// ============================================
// Main Export
// ============================================

/**
 * Collect tweets from X/Twitter using handle-based fetching.
 *
 * Strategy:
 * 1. Load handles from ref/x-handles.md
 * 2. Select relevant handles based on query topic
 * 3. Fetch tweets from each selected handle
 * 4. Filter tweets client-side for relevance
 * 5. Return merged results
 *
 * GATED: Only runs if 'x' is in config.sources and API key is set.
 * NON-FATAL: Returns empty array on failure.
 */
export async function searchTwitter(
  query: string,
  config: PipelineConfig
): Promise<RawItem[]> {
  // Gate check: Only run if 'x' source is enabled
  if (!config.sources.includes('x')) {
    logVerbose('Twitter: Source not enabled, skipping');
    return [];
  }

  // Gate check: Require API key
  if (!hasApiKey('SCRAPECREATORS_API_KEY')) {
    logVerbose('Twitter: SCRAPECREATORS_API_KEY not set, skipping');
    return [];
  }

  // Log compliance warning on first use
  logComplianceWarningOnce();

  // Load handles from file
  const allHandles = loadXHandles();
  if (allHandles.length === 0) {
    logWarning('Twitter: No handles loaded from ref/x-handles.md');
    return [];
  }
  logInfo(`Twitter: Loaded ${allHandles.length} handles from file`);

  // Select relevant handles (max 5 to avoid rate limits)
  const maxHandles = Math.min(5, Math.ceil(config.maxPerSource / 20));
  const selectedHandles = selectHandlesByTopic(allHandles, query, maxHandles);
  logInfo(`Twitter: Selected handles: ${selectedHandles.map(h => '@' + h.handle).join(', ')}`);

  // Extract keywords for relevance filtering
  const keywords = extractQueryKeywords(query);
  logVerbose(`Twitter: Using ${keywords.length} keywords for filtering`);

  try {
    // Fetch tweets from each handle (with concurrency limit)
    const allItems: RawItem[] = [];
    const concurrencyLimit = API_CONCURRENCY_LIMITS.scrapeCreators;

    for (let i = 0; i < selectedHandles.length; i += concurrencyLimit) {
      const batch = selectedHandles.slice(i, i + concurrencyLimit);

      logVerbose(`Twitter: Processing batch ${Math.floor(i / concurrencyLimit) + 1}`);

      const batchResults = await Promise.allSettled(
        batch.map(handle => fetchUserTweets(handle))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          allItems.push(...result.value);
        } else {
          logVerbose(`Twitter: Handle fetch failed: ${result.reason}`);
        }
      }
    }

    logVerbose(`Twitter: Fetched ${allItems.length} tweets before filtering`);

    // Filter by relevance
    const filteredItems = allItems.filter(item =>
      isTweetRelevant(item.content, keywords, 1)
    );

    logVerbose(`Twitter: ${filteredItems.length}/${allItems.length} tweets passed relevance filter`);

    // Sort by engagement and apply maxPerSource limit
    const sorted = filteredItems
      .sort((a, b) => {
        const engA = (a.engagement.likes ?? 0) + (a.engagement.shares ?? 0);
        const engB = (b.engagement.likes ?? 0) + (b.engagement.shares ?? 0);
        return engB - engA;
      })
      .slice(0, config.maxPerSource);

    logVerbose(`Twitter: Returning ${sorted.length} items (max ${config.maxPerSource})`);
    return sorted;

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Twitter: Collection failed (non-fatal): ${message}`);
    return [];
  }
}

export { searchTwitter as default };
