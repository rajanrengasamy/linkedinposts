/**
 * Twitter/X Collector - ScrapeCreators API
 *
 * OPTIONAL, GATED data source. Non-fatal on failure.
 * Requires 'x' in config.sources and SCRAPECREATORS_API_KEY set.
 *
 * COMPLIANCE WARNING: Using X/Twitter data may violate platform ToS.
 * Use at your own risk for personal/research purposes only.
 */

import axios, { AxiosError } from 'axios';
import { RawItemSchema, SCHEMA_VERSION, createDefaultEngagement } from '../schemas/rawItem.js';
import type { RawItem, Engagement } from '../schemas/rawItem.js';
import type { PipelineConfig } from '../types/index.js';
import { getApiKey, hasApiKey, API_CONCURRENCY_LIMITS } from '../config.js';
import { generateContentHash, normalizeUrl, normalizeTimestamp } from '../processing/normalize.js';
import { withRetry, DEFAULT_RETRY_OPTIONS } from '../utils/retry.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import { generateStableId } from '../utils/stableId.js';

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
 * Tweet data from ScrapeCreators API response
 *
 * NOTE: This interface is based on typical Twitter/X data structures.
 * Adjust field names if actual API response differs.
 */
interface ScrapeCreatorsTweet {
  // Tweet identity
  id?: string;
  tweet_id?: string;

  // Content
  text?: string;
  full_text?: string;
  content?: string;

  // Author info
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

  // Engagement metrics
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

  // Timestamps
  created_at?: string;
  timestamp?: string;
  date?: string;

  // URL
  url?: string;
  tweet_url?: string;
}

/**
 * ScrapeCreators search response structure
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
 * Extract tweet ID from various possible fields.
 * Returns null if no real ID exists - never fabricates IDs.
 */
function extractTweetId(tweet: ScrapeCreatorsTweet): string | null {
  return tweet.id ?? tweet.tweet_id ?? null;
}

/**
 * Extract tweet content from various possible fields
 */
function extractContent(tweet: ScrapeCreatorsTweet): string {
  return tweet.text ?? tweet.full_text ?? tweet.content ?? '';
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
 * Extract and normalize engagement metrics
 */
function extractEngagement(tweet: ScrapeCreatorsTweet): Engagement {
  const likes = tweet.favorite_count ?? tweet.like_count ?? tweet.likes ?? 0;
  const retweets = tweet.retweet_count ?? tweet.retweets ?? 0;
  const quotes = tweet.quote_count ?? tweet.quotes ?? 0;
  const replies = tweet.reply_count ?? tweet.replies ?? 0;
  const impressions = tweet.view_count ?? tweet.views ?? tweet.impressions;

  return {
    // Base engagement (normalized across platforms)
    likes,
    comments: replies, // Map replies to comments for normalized view
    shares: retweets, // Map retweets to shares for normalized view

    // X/Twitter-specific fields
    retweets,
    quotes,
    replies,
    ...(impressions !== undefined && { impressions }),
  };
}

/**
 * Extract and normalize timestamp
 */
function extractTimestamp(tweet: ScrapeCreatorsTweet): string | undefined {
  const rawDate = tweet.created_at ?? tweet.timestamp ?? tweet.date;
  if (!rawDate) return undefined;

  try {
    return normalizeTimestamp(rawDate);
  } catch {
    logVerbose(`Twitter: Failed to parse timestamp: ${rawDate}`);
    return undefined;
  }
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

// ============================================
// API Functions
// ============================================

/**
 * Make authenticated request to ScrapeCreators Twitter API
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
 * Parse API response into tweets array
 */
function extractTweetsFromResponse(response: ScrapeCreatorsSearchResponse): ScrapeCreatorsTweet[] {
  // Try different possible response structures
  return response.data ?? response.tweets ?? response.results ?? [];
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

// ============================================
// Main Export
// ============================================

/**
 * Search Twitter/X for content related to query
 *
 * GATED: Only runs if 'x' is in config.sources and API key is set.
 * NON-FATAL: Returns empty array on failure.
 *
 * @param query - Search query
 * @param config - Pipeline configuration
 * @returns Array of RawItem or empty array on failure
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

  logVerbose(`Twitter: Searching for "${query}"`);

  try {
    // Make API request with retry
    const result = await withRetry(
      async () => {
        // Use the search endpoint
        // NOTE: Adjust endpoint and params based on actual ScrapeCreators API docs
        return makeTwitterRequest('/v1/twitter/search', {
          query,
          count: String(config.maxPerSource),
        });
      },
      {
        ...DEFAULT_RETRY_OPTIONS,
        operationName: 'Twitter search',
      }
    );

    if (!result.success) {
      logWarning(`Twitter: Search failed after retries: ${result.error.message}`);
      return [];
    }

    const response = result.data;

    // Check for API-level errors
    if (response.error) {
      logWarning(`Twitter: API error: ${response.error}`);
      return [];
    }

    // Extract tweets from response
    const tweets = extractTweetsFromResponse(response);
    logVerbose(`Twitter: Received ${tweets.length} tweets`);

    // Convert to RawItems
    const items: RawItem[] = [];
    for (const tweet of tweets) {
      const item = tweetToRawItem(tweet);
      if (item) {
        items.push(item);
      }

      // Respect maxPerSource limit
      if (items.length >= config.maxPerSource) {
        logVerbose(`Twitter: Reached maxPerSource limit (${config.maxPerSource})`);
        break;
      }
    }

    logVerbose(`Twitter: Converted ${items.length} valid items`);
    return items;
  } catch (error) {
    // Handle all errors gracefully (non-fatal)
    const message = error instanceof Error ? error.message : String(error);

    // Check for specific error types
    if (error instanceof AxiosError) {
      if (error.response?.status === 401) {
        logWarning('Twitter: Authentication failed - check SCRAPECREATORS_API_KEY');
      } else if (error.response?.status === 403) {
        logWarning('Twitter: Access forbidden - API key may lack required permissions');
      } else if (error.response?.status === 429) {
        logWarning('Twitter: Rate limited - try again later');
      } else {
        logWarning(`Twitter: API error (${error.response?.status}): ${message}`);
      }
    } else {
      logWarning(`Twitter: Search failed: ${message}`);
    }

    return [];
  }
}

export { searchTwitter as default };
