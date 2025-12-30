/**
 * Prompt Breakdown Module
 *
 * Breaks down long prompts into shorter, social-media-optimized search queries.
 * Used when collecting from multiple sources to optimize search relevance.
 *
 * Long prompts work well for web search (Perplexity) but may be too verbose
 * for social media search APIs (LinkedIn, Twitter). This module uses Gemini
 * to intelligently extract key concepts into shorter queries.
 */

import { z } from 'zod';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getApiKey } from '../config.js';
import { withRetry, QUICK_RETRY_OPTIONS } from '../utils/retry.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import { sanitizePromptContent, createSafeError } from '../utils/sanitization.js';

// ============================================
// Constants
// ============================================

/** Default threshold for "long" prompts (in characters) */
export const DEFAULT_LONG_PROMPT_THRESHOLD = 100;

/** Minimum number of social queries to generate */
const MIN_SOCIAL_QUERIES = 3;

/** Maximum number of social queries to generate */
const MAX_SOCIAL_QUERIES = 5;

/** Maximum length for each social query (characters) */
const MAX_QUERY_LENGTH = 50;

/**
 * Gemini model to use for prompt breakdown.
 * Using Gemini 3 Flash for speed and low cost since this is a simple extraction task.
 * @see https://ai.google.dev/gemini-api/docs/gemini-3
 */
const BREAKDOWN_MODEL = 'gemini-3-flash-preview';

/**
 * Thinking level for Gemini 3 Flash prompt breakdown.
 * LOW for speed since this is a simple keyword extraction task.
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */
const BREAKDOWN_THINKING_LEVEL = ThinkingLevel.LOW;

// ============================================
// Types & Schemas
// ============================================

/**
 * Result of prompt breakdown
 */
export interface PromptBreakdownResult {
  /** Original full prompt (for web search) */
  original: string;
  /** Shorter queries optimized for social search */
  socialQueries: string[];
  /** Whether breakdown was performed */
  wasBreakdown: boolean;
}

/**
 * Schema for validating Gemini's breakdown response
 */
const BreakdownResponseSchema = z.object({
  queries: z
    .array(z.string().min(1).max(MAX_QUERY_LENGTH * 2)) // Allow some flexibility
    .min(MIN_SOCIAL_QUERIES)
    .max(MAX_SOCIAL_QUERIES + 2), // Allow Gemini to return slightly more
});

type BreakdownResponse = z.infer<typeof BreakdownResponseSchema>;

// ============================================
// Prompt Building
// ============================================

/**
 * Build the prompt for Gemini to break down a long search query.
 *
 * @param prompt - The original long prompt to break down
 * @returns Formatted prompt for Gemini
 */
function buildBreakdownPrompt(prompt: string): string {
  const sanitized = sanitizePromptContent(prompt, 1000);

  return `Extract ${MIN_SOCIAL_QUERIES}-${MAX_SOCIAL_QUERIES} short search queries from this topic. Each query should:
- Be under ${MAX_QUERY_LENGTH} characters
- Focus on one key concept, person, or term
- Work well as a social media search term (LinkedIn/Twitter)
- Avoid generic words, prefer specific names, topics, or phrases

Topic: "${sanitized}"

Return ONLY valid JSON in this exact format:
{"queries": ["query 1", "query 2", "query 3"]}

No additional text, just the JSON object.`;
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse and validate Gemini's breakdown response.
 *
 * @param responseText - Raw text response from Gemini
 * @returns Parsed queries or null if parsing fails
 */
function parseBreakdownResponse(responseText: string): string[] | null {
  try {
    // Strip markdown code fences if present
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }

    // Parse JSON
    const parsed = JSON.parse(cleaned);

    // Validate with Zod
    const result = BreakdownResponseSchema.safeParse(parsed);
    if (!result.success) {
      logVerbose(`Breakdown response validation failed: ${result.error.message}`);
      return null;
    }

    // Truncate queries to max length and filter empty ones
    const queries = result.data.queries
      .map((q) => q.trim().slice(0, MAX_QUERY_LENGTH))
      .filter((q) => q.length > 0)
      .slice(0, MAX_SOCIAL_QUERIES);

    if (queries.length < MIN_SOCIAL_QUERIES) {
      logVerbose(`Too few valid queries after processing: ${queries.length}`);
      return null;
    }

    return queries;
  } catch (error) {
    logVerbose(`Failed to parse breakdown response: ${error}`);
    return null;
  }
}

// ============================================
// Fallback Logic
// ============================================

/**
 * Fallback keyword extraction when Gemini fails.
 *
 * Uses simple heuristics to extract key terms:
 * 1. Remove common stop words
 * 2. Extract multi-word phrases (quoted or capitalized)
 * 3. Return top N most significant terms
 *
 * @param prompt - Original prompt to extract from
 * @returns Array of extracted keywords
 */
function fallbackKeywordExtraction(prompt: string): string[] {
  // Common stop words to filter out
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'about', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'again', 'further', 'then', 'once',
    'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
    'now', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
    'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his',
    'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself',
    'they', 'them', 'their', 'theirs', 'themselves',
  ]);

  const queries: string[] = [];

  // Extract quoted phrases first (high priority)
  const quotedPhrases = prompt.match(/"([^"]+)"|'([^']+)'/g);
  if (quotedPhrases) {
    for (const phrase of quotedPhrases) {
      const clean = phrase.replace(/['"]/g, '').trim();
      if (clean.length > 2 && clean.length <= MAX_QUERY_LENGTH) {
        queries.push(clean);
      }
    }
  }

  // Extract capitalized phrases (likely proper nouns/names)
  const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  const capitalizedPhrases = prompt.match(capitalizedPattern);
  if (capitalizedPhrases) {
    for (const phrase of capitalizedPhrases) {
      if (phrase.length <= MAX_QUERY_LENGTH && !queries.includes(phrase)) {
        queries.push(phrase);
      }
    }
  }

  // If we don't have enough, extract significant words
  if (queries.length < MIN_SOCIAL_QUERIES) {
    const words = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stopWords.has(word));

    // Count word frequency
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // Sort by frequency, take top words
    const sortedWords = [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);

    for (const word of sortedWords) {
      if (queries.length >= MAX_SOCIAL_QUERIES) break;
      if (!queries.some((q) => q.toLowerCase().includes(word))) {
        queries.push(word);
      }
    }
  }

  return queries.slice(0, MAX_SOCIAL_QUERIES);
}

// ============================================
// Public API
// ============================================

/**
 * Check if a prompt is considered "long" and needs breakdown.
 *
 * @param prompt - The user's prompt
 * @param threshold - Character threshold (default: 100)
 * @returns true if prompt exceeds threshold
 */
export function isLongPrompt(
  prompt: string,
  threshold: number = DEFAULT_LONG_PROMPT_THRESHOLD
): boolean {
  return prompt.trim().length > threshold;
}

/**
 * Break down a long prompt into shorter social-media-optimized queries.
 *
 * Uses Gemini to intelligently extract 3-5 shorter search terms that
 * capture the key concepts from the original prompt.
 *
 * If Gemini fails or is unavailable, falls back to simple keyword extraction.
 *
 * @param prompt - The original long prompt
 * @returns Breakdown result with original and social queries
 */
export async function breakdownForSocialSearch(
  prompt: string
): Promise<PromptBreakdownResult> {
  const original = prompt.trim();

  // If prompt is short, no breakdown needed
  if (!isLongPrompt(original)) {
    return {
      original,
      socialQueries: [original],
      wasBreakdown: false,
    };
  }

  logVerbose(`Breaking down long prompt (${original.length} chars) for social search`);

  // Try Gemini breakdown
  try {
    const apiKey = getApiKey('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      logVerbose('No Google AI API key, using fallback keyword extraction');
      return {
        original,
        socialQueries: fallbackKeywordExtraction(original),
        wasBreakdown: true,
      };
    }

    const client = new GoogleGenAI({ apiKey });
    const breakdownPrompt = buildBreakdownPrompt(original);

    const result = await withRetry(
      async () => {
        const response = await client.models.generateContent({
          model: BREAKDOWN_MODEL,
          contents: breakdownPrompt,
          config: {
            thinkingConfig: {
              thinkingLevel: BREAKDOWN_THINKING_LEVEL,
            },
          },
        });

        const text = response.text;
        if (!text || text.trim().length === 0) {
          throw new Error('Empty response from Gemini');
        }

        return text;
      },
      {
        ...QUICK_RETRY_OPTIONS,
        operationName: 'Prompt breakdown',
      }
    );

    if (!result.success) {
      logWarning(`Prompt breakdown failed: ${result.error.message}, using fallback`);
      return {
        original,
        socialQueries: fallbackKeywordExtraction(original),
        wasBreakdown: true,
      };
    }

    // Parse response
    const queries = parseBreakdownResponse(result.data);
    if (!queries) {
      logVerbose('Failed to parse breakdown response, using fallback');
      return {
        original,
        socialQueries: fallbackKeywordExtraction(original),
        wasBreakdown: true,
      };
    }

    logVerbose(`Prompt broken down into ${queries.length} social queries`);
    return {
      original,
      socialQueries: queries,
      wasBreakdown: true,
    };
  } catch (error) {
    // Create safe error without exposing API keys
    const safeError = createSafeError('Prompt breakdown', error);
    logWarning(`Prompt breakdown error: ${safeError.message}, using fallback`);

    return {
      original,
      socialQueries: fallbackKeywordExtraction(original),
      wasBreakdown: true,
    };
  }
}

/**
 * Get the appropriate prompt for a given source.
 *
 * - For 'web': Returns the original full prompt (works well with Perplexity)
 * - For 'linkedin'/'x': Returns socialQueries array (caller will iterate)
 *
 * @param prompt - Original prompt
 * @param breakdown - Breakdown result (or null if not performed)
 * @param source - The source type ('web', 'linkedin', 'x')
 * @returns The prompt to use for this source (string for web, array for social)
 */
export function getPromptForSource(
  prompt: string,
  breakdown: PromptBreakdownResult | null,
  source: 'web' | 'linkedin' | 'x'
): string | string[] {
  // Web search always uses the original full prompt
  if (source === 'web') {
    return breakdown?.original ?? prompt;
  }

  // Social sources use broken-down queries
  if (breakdown && breakdown.wasBreakdown) {
    return breakdown.socialQueries;
  }

  // No breakdown available, return original as single-item array
  return [prompt];
}
