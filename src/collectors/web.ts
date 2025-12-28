/**
 * Web Collector - Perplexity Sonar Reasoning Pro
 *
 * CRITICAL/REQUIRED data source. Pipeline fails if this collector fails.
 * Uses Perplexity's sonar-reasoning-pro model for web search with citations.
 */

import axios from 'axios';
import { RawItemSchema, SCHEMA_VERSION, createDefaultEngagement } from '../schemas/rawItem.js';
import type { RawItem } from '../schemas/rawItem.js';
import type { PipelineConfig } from '../types/index.js';
import { getApiKey, API_CONCURRENCY_LIMITS } from '../config.js';
import { generateContentHash, normalizeUrl } from '../processing/normalize.js';
import { withRetryThrow, CRITICAL_RETRY_OPTIONS } from '../utils/retry.js';
import { logVerbose, logProgress, logWarning } from '../utils/logger.js';
import { generateStableId } from '../utils/stableId.js';
import {
  PERPLEXITY_API_URL,
  PERPLEXITY_MODEL,
  type PerplexityResponse,
} from '../types/perplexity.js';

// ============================================
// Types
// ============================================

/**
 * Parsed content block from Perplexity response
 */
interface ParsedContent {
  content: string;
  title?: string;
  sourceUrl: string;
}

// ============================================
// Search Prompt Builder
// ============================================

/**
 * Build search prompt with sub-queries for comprehensive coverage.
 *
 * Derives 3-5 sub-queries from the main query:
 * 1. Direct keyword search
 * 2. Expert opinions on topic
 * 3. Latest news/developments
 * 4. Statistics and data
 * 5. Trending discussions
 *
 * @param query - Main search query/topic
 * @returns Structured prompt for Perplexity API
 */
export function buildSearchPrompt(query: string): string {
  const subQueries = [
    query,
    `Expert opinions on ${query}`,
    `Latest news ${query} 2025`,
    `${query} statistics data research`,
    `Trending ${query} insights`,
  ];

  return `Search for the following topics and provide comprehensive, well-sourced information with exact quotes where available:

${subQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

For each piece of information you find:
- Provide the EXACT quote or key insight
- Include the source name/publication
- Note any relevant statistics or data points
- Highlight expert opinions and their credentials

Format your response as distinct content blocks, each with:
- The main quote or insight (clearly marked)
- Source attribution
- Any relevant context

Be thorough and include multiple perspectives. Prioritize recent (2024-2025) and authoritative sources.`;
}

// ============================================
// Response Parser
// ============================================

/**
 * Parse Perplexity response into content blocks with source URLs.
 *
 * Strategy:
 * 1. Split response into logical blocks (paragraphs/sections)
 * 2. Match content to citations by order of appearance
 * 3. Extract titles from content patterns (quotes, headers)
 *
 * @param response - Perplexity API response
 * @returns Array of parsed content blocks
 */
function parsePerplexityResponse(response: PerplexityResponse): ParsedContent[] {
  const results: ParsedContent[] = [];
  const content = response.choices[0]?.message?.content || '';
  const citations = response.citations || [];

  if (!content || citations.length === 0) {
    logWarning('Perplexity response missing content or citations');
    return results;
  }

  logVerbose(`Parsing Perplexity response: ${content.length} chars, ${citations.length} citations`);

  // Split content into meaningful blocks
  // Look for numbered lists, quote blocks, or paragraph separators
  const blocks = content
    .split(/\n\n+|\n(?=\d+\.)|(?<=\.\s)(?=[A-Z])/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 50); // Filter out tiny fragments

  // Match blocks to citations - 1:1 mapping only
  // Only process blocks that have a corresponding citation to maintain provenance accuracy
  // Blocks without matching citations are skipped to avoid incorrect source attribution
  const validBlocks = blocks.slice(0, citations.length);
  for (let i = 0; i < validBlocks.length; i++) {
    const block = validBlocks[i];
    const sourceUrl = citations[i]; // Direct 1:1 mapping, no modulo

    if (!sourceUrl) continue;

    // Try to extract a title from the block
    // Look for quoted text or the first sentence as title
    const quoteMatch = block.match(/"([^"]+)"/);
    const title = quoteMatch ? quoteMatch[1].substring(0, 100) : undefined;

    try {
      // Validate URL before adding
      const normalizedUrl = normalizeUrl(sourceUrl);
      results.push({
        content: block,
        title,
        sourceUrl: normalizedUrl,
      });
    } catch {
      // Skip invalid URLs
      logVerbose(`Skipping invalid citation URL: ${sourceUrl}`);
    }
  }

  // Also create entries for each unique citation to ensure coverage
  const usedUrls = new Set(results.map((r) => r.sourceUrl));
  for (const citation of citations) {
    try {
      const normalizedUrl = normalizeUrl(citation);
      if (!usedUrls.has(normalizedUrl)) {
        // Create a minimal entry for unused citations
        // Extract domain as title
        const url = new URL(normalizedUrl);
        results.push({
          content: `Reference from ${url.hostname}`,
          sourceUrl: normalizedUrl,
        });
        usedUrls.add(normalizedUrl);
      }
    } catch {
      logVerbose(`Skipping invalid citation URL: ${citation}`);
    }
  }

  return results;
}

// ============================================
// Main Search Function
// ============================================

/**
 * Search the web using Perplexity's sonar-reasoning-pro model.
 *
 * CRITICAL: This is the required data source. If this fails, the pipeline must fail.
 * No try/catch wrapping - let errors propagate up as FATAL.
 *
 * @param query - Search query/topic
 * @param config - Pipeline configuration
 * @returns Array of RawItem objects validated against schema
 * @throws Error if API call fails (FATAL for pipeline)
 */
export async function searchWeb(query: string, config: PipelineConfig): Promise<RawItem[]> {
  const apiKey = getApiKey('PERPLEXITY_API_KEY');
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY is required but not configured');
  }

  logVerbose(`Web search starting for query: "${query}"`);
  logVerbose(`Using model: ${PERPLEXITY_MODEL}, concurrency limit: ${API_CONCURRENCY_LIMITS.perplexity}`);

  const prompt = buildSearchPrompt(query);
  logVerbose(`Built search prompt (${prompt.length} chars)`);

  // Make API request with retry logic
  // CRITICAL_RETRY_OPTIONS: 5 retries, 2s base delay, exponential backoff
  const response = await withRetryThrow<PerplexityResponse>(
    async () => {
      const result = await axios.post<PerplexityResponse>(
        PERPLEXITY_API_URL,
        {
          model: PERPLEXITY_MODEL,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 60 second timeout
        }
      );
      return result.data;
    },
    {
      ...CRITICAL_RETRY_OPTIONS,
      operationName: 'Perplexity web search',
    }
  );

  logVerbose(`Perplexity response received: ${response.choices?.length || 0} choices`);

  // Parse response into content blocks
  const parsedContent = parsePerplexityResponse(response);
  logVerbose(`Parsed ${parsedContent.length} content blocks from response`);

  if (parsedContent.length === 0) {
    throw new Error('Perplexity returned no usable content with citations');
  }

  // Convert to RawItem format
  const items: RawItem[] = [];
  const retrievedAt = new Date().toISOString();
  const seenHashes = new Set<string>();

  // Filter citations through normalizeUrl() before attaching to items
  // Schema requires citations: z.array(z.string().url()) - malformed citations cause validation failure
  const validCitations = (response.citations ?? [])
    .map((citation) => {
      try {
        return normalizeUrl(citation);
      } catch {
        logVerbose(`Filtering out invalid citation: ${citation}`);
        return null;
      }
    })
    .filter((url): url is string => url !== null);

  logVerbose(`Filtered citations: ${validCitations.length}/${response.citations?.length ?? 0} valid`);

  for (let i = 0; i < parsedContent.length; i++) {
    const parsed = parsedContent[i];
    logProgress(i + 1, parsedContent.length, 'Processing web results');

    // Generate content hash for deduplication
    const contentHash = generateContentHash(parsed.content);

    // Skip duplicates within this batch
    if (seenHashes.has(contentHash)) {
      logVerbose(`Skipping duplicate content (hash: ${contentHash})`);
      continue;
    }
    seenHashes.add(contentHash);

    // Build RawItem with stable ID (same sourceUrl + contentHash = same ID across runs)
    const rawItem: RawItem = {
      id: generateStableId(parsed.sourceUrl, contentHash),
      schemaVersion: SCHEMA_VERSION,
      source: 'web',
      sourceUrl: parsed.sourceUrl,
      retrievedAt,
      content: parsed.content,
      contentHash,
      title: parsed.title,
      engagement: createDefaultEngagement(),
      citations: validCitations,
    };

    // Validate against schema
    const validation = RawItemSchema.safeParse(rawItem);
    if (validation.success) {
      items.push(validation.data);
    } else {
      logWarning(`Item failed schema validation: ${validation.error.message}`);
      logVerbose(`Failed item: ${JSON.stringify(rawItem, null, 2)}`);
    }
  }

  logVerbose(`Web search completed: ${items.length} valid items`);

  // Respect maxPerSource limit
  const limit = config.maxPerSource;
  if (items.length > limit) {
    logVerbose(`Trimming results from ${items.length} to ${limit} (maxPerSource)`);
    return items.slice(0, limit);
  }

  return items;
}
