/**
 * Validation Engine - Perplexity API Client
 *
 * Provides the core Perplexity API request function for verification tasks.
 * Uses sonar-reasoning-pro model for cross-checking quotes and claims.
 */

import axios, { AxiosError } from 'axios';
import { getApiKey } from '../config.js';
import { withRetry, CRITICAL_RETRY_OPTIONS, TimeoutError, type RetryResult } from '../utils/retry.js';
import { logVerbose, logStage, logProgress, logWarning } from '../utils/logger.js';
import {
  type RawItem,
  type ValidatedItem,
  type Validation,
  type QuoteVerified,
  createUnverifiedValidation,
  assignVerificationLevel,
  retryWithFixPrompt,
  ValidatedItemSchema,
  QuoteVerifiedSchema,
} from '../schemas/index.js';
import {
  type PipelineConfig,
  API_CONCURRENCY_LIMITS,
  PERPLEXITY_API_URL,
  PERPLEXITY_MODEL,
  type PerplexityResponse,
  type PerplexityRequestOptions,
} from '../types/index.js';
import { processWithConcurrency } from '../utils/concurrency.js';

/** Length for truncated IDs in log messages */
const SHORT_ID_LENGTH = 8;

/** Maximum content length to prevent DoS via unbounded input (MAJ-2) */
const MAX_CONTENT_LENGTH = 50000;

/** Maximum prompt length for API requests (MAJ-2) */
const MAX_PROMPT_LENGTH = 100000;

// ============================================
// Security: Content Sanitization (CRIT-1)
// ============================================

/**
 * Patterns that indicate potential prompt injection attempts.
 * These patterns try to manipulate the LLM's behavior by injecting commands.
 */
const INJECTION_PATTERNS = [
  /IGNORE\s+(ALL\s+)?PREVIOUS/gi,
  /SYSTEM\s+OVERRIDE/gi,
  /---\s*END\s*---/gi,
  /<<<\s*END\s*>>>/gi,
  /\[\[SYSTEM\]\]/gi,
  /\{\{SYSTEM\}\}/gi,
  /DISREGARD\s+(ALL\s+)?INSTRUCTIONS/gi,
  /NEW\s+INSTRUCTIONS?:/gi,
  /ADMIN\s+MODE/gi,
  /OVERRIDE\s+PROMPT/gi,
  /FORGET\s+(ALL\s+)?ABOVE/gi,
  /STOP\s+BEING\s+A/gi,
  /YOU\s+ARE\s+NOW/gi,
  /ACT\s+AS\s+IF/gi,
];

/**
 * Sanitize user content to prevent prompt injection attacks (CRIT-1).
 *
 * Detects and neutralizes injection patterns that could manipulate
 * the LLM's behavior. Uses unique delimiters that are harder to escape.
 *
 * @param content - Raw user content to sanitize
 * @returns Sanitized content safe for prompt interpolation
 */
export function sanitizeContent(content: string): string {
  let sanitized = content;

  // Detect and neutralize injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      // Replace with harmless placeholder that preserves approximate length
      return '[FILTERED:' + match.length + ']';
    });
  }

  // Escape our delimiter tokens if they appear in content
  sanitized = sanitized.replace(/<<<CONTENT_START>>>/g, '[FILTERED:DELIMITER]');
  sanitized = sanitized.replace(/<<<CONTENT_END>>>/g, '[FILTERED:DELIMITER]');
  sanitized = sanitized.replace(/<<<CONTEXT_START>>>/g, '[FILTERED:DELIMITER]');
  sanitized = sanitized.replace(/<<<CONTEXT_END>>>/g, '[FILTERED:DELIMITER]');

  return sanitized;
}

// ============================================
// Security: Error Sanitization (MAJ-3)
// ============================================

/**
 * Patterns that indicate sensitive data in error messages.
 */
const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9_-]+/gi,
  /Authorization:\s*[^\s]+/gi,
  /api[_-]?key[=:]\s*[A-Za-z0-9_-]+/gi,
  /sk-[A-Za-z0-9_-]{20,}/gi, // OpenAI-style keys
  /pplx-[A-Za-z0-9_-]{20,}/gi, // Perplexity keys
  /[A-Za-z0-9_-]{32,}(?=\s|$|")/g, // Long alphanumeric tokens (potential API keys)
];

/**
 * Sanitize error messages to prevent API key exposure (MAJ-3).
 *
 * Removes or masks sensitive data like API keys, authorization headers,
 * and other credentials that could be leaked in error messages.
 *
 * @param message - Raw error message
 * @returns Sanitized error message safe for logging/display
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  let containsSensitiveData = false;

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(sanitized)) {
      containsSensitiveData = true;
      // Reset lastIndex since we're reusing the regex
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
  }

  // If sensitive data was detected, return a generic message
  if (containsSensitiveData) {
    return 'API request failed (check logs for details)';
  }

  return sanitized;
}

// Types PerplexityResponse and PerplexityRequestOptions are imported from ../types/perplexity.js
// Re-export for backwards compatibility
export type { PerplexityResponse, PerplexityRequestOptions } from '../types/index.js';

// ============================================
// Main API Client Function
// ============================================

/**
 * Make a request to the Perplexity API.
 *
 * Sends a prompt to Perplexity's sonar-reasoning-pro model and returns
 * the response. Uses retry logic with exponential backoff for resilience.
 *
 * @param prompt - The verification prompt to send
 * @param options - Optional request configuration
 * @returns Promise resolving to the Perplexity API response
 * @throws Error if API key is missing or all retries fail
 */
export async function makePerplexityRequest(
  prompt: string,
  options: PerplexityRequestOptions = {}
): Promise<PerplexityResponse> {
  const { timeoutMs = 60000, operationName = 'Perplexity verification' } = options;

  // MAJ-2: Check prompt length to prevent DoS
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `Prompt exceeds maximum length (${prompt.length} > ${MAX_PROMPT_LENGTH}). Content may be too large.`
    );
  }

  // Get API key from environment
  const apiKey = getApiKey('PERPLEXITY_API_KEY');
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY is required but not configured');
  }

  logVerbose(`${operationName}: Sending request (${prompt.length} chars)`);

  // Make API request with retry logic
  const result = await withRetry(
    async () => {
      try {
        const response = await axios.post(
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
            timeout: timeoutMs,
          }
        );
        return response.data;
      } catch (error) {
        // MAJ-9: Provide clear error messages for 4xx client errors
        if (error instanceof AxiosError && error.response) {
          const status = error.response.status;
          if (status === 401 || status === 403) {
            throw new Error(
              `Authentication failed (${status}). Check PERPLEXITY_API_KEY is valid and not expired.`
            );
          }
          if (status === 400) {
            throw new Error(
              `Bad request format (400). This may indicate an API schema change.`
            );
          }
          // 429 is handled by retry logic, just rethrow
        }
        throw error;
      }
    },
    {
      ...CRITICAL_RETRY_OPTIONS,
      operationName,
    }
  );

  // Handle retry result - MAJ-3: Sanitize error messages
  if (result.success === false) {
    const rawMessage = `${operationName} failed after ${result.attempts} attempts: ${result.error.message}`;
    throw new Error(sanitizeErrorMessage(rawMessage));
  }

  logVerbose(
    `${operationName}: Response received (${result.data.choices?.length || 0} choices, ${result.data.citations?.length || 0} citations)`
  );

  return result.data;
}

/**
 * Extract the content text from a Perplexity response.
 *
 * Convenience function to get the main response text.
 *
 * @param response - Perplexity API response
 * @returns The content string from the first choice, or empty string if not available
 */
export function extractContent(response: PerplexityResponse): string {
  return response.choices?.[0]?.message?.content || '';
}

/**
 * Extract citations from a Perplexity response.
 *
 * @param response - Perplexity API response
 * @returns Array of citation URLs, or empty array if none
 */
export function extractCitations(response: PerplexityResponse): string[] {
  return response.citations || [];
}

// ============================================
// Validation Prompt Building & Response Parsing
// ============================================

import { z } from 'zod';
import { VerificationLevelSchema, parseModelResponse } from '../schemas/index.js';

/**
 * Schema for validating HTTP(S) URLs only.
 * Rejects dangerous protocols like javascript:, file:, data: (MAJ-1)
 */
const HttpUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith('http://') || url.startsWith('https://'), {
    message: 'Only HTTP(S) URLs are allowed',
  });

/**
 * Schema for LLM validation response from Perplexity.
 *
 * This schema defines the expected JSON structure when asking Perplexity
 * to verify quotes and claims against web sources.
 *
 * MAJ-1: Uses HttpUrlSchema to reject dangerous URL protocols
 */
export const ValidationResponseSchema = z.object({
  /** Whether the main content was verified */
  verified: z.boolean(),

  /** Level of verification achieved */
  verificationLevel: VerificationLevelSchema,

  /** Confidence score from 0.0 to 1.0 */
  confidence: z.number().min(0).max(1),

  /** URLs of corroborating sources found - MAJ-1: Only HTTP(S) allowed */
  sourcesFound: z.array(HttpUrlSchema),

  /** Whether content is from a primary source (author's own site/publication) */
  isPrimarySource: z.boolean(),

  /** Brief notes about the verification process */
  notes: z.array(z.string()),

  /**
   * Individual quote verification results.
   * MAJ-4: Mirrors QuoteVerifiedSchema constraints (.min(1), sourceUrl required when verified)
   * but uses HttpUrlSchema for security (MAJ-1: only HTTP(S) allowed)
   */
  quotesVerified: z.array(
    z
      .object({
        /** The quote text that was checked - must be non-empty */
        quote: z.string().min(1),

        /** Whether this specific quote was verified */
        verified: z.boolean(),

        /** Source URL where the quote was found - MAJ-1: Only HTTP(S) allowed */
        sourceUrl: HttpUrlSchema.optional(),
      })
      .refine((data) => !data.verified || (data.verified && !!data.sourceUrl), {
        message: 'sourceUrl is required when verified is true',
        path: ['sourceUrl'],
      })
  ),

  /** Verified publication date in ISO 8601 format (optional) */
  publishedAtVerified: z.string().datetime().optional(),
});

/** Type inferred from ValidationResponseSchema */
export type ValidationResponse = z.infer<typeof ValidationResponseSchema>;

/**
 * Build a validation prompt for Perplexity to verify content.
 *
 * Creates a structured prompt asking Perplexity to cross-check the content
 * against web sources, verify author attribution, and find corroborating
 * evidence for any quotes or claims.
 *
 * CRIT-1: Sanitizes user content and uses structured delimiters
 * MAJ-2: Truncates content exceeding MAX_CONTENT_LENGTH
 *
 * @param item - The RawItem to validate
 * @param originalPrompt - The original user prompt for context
 * @returns Prompt string for Perplexity API
 */
export function buildValidationPrompt(item: RawItem, originalPrompt: string): string {
  // CRIT-1: Sanitize user-provided content before interpolation
  let sanitizedContent = sanitizeContent(item.content);
  const sanitizedPrompt = sanitizeContent(originalPrompt);
  const sanitizedAuthor = sanitizeContent(item.author || 'Unknown');
  const sanitizedHandle = sanitizeContent(item.authorHandle || 'N/A');

  // MAJ-2: Truncate content if it exceeds maximum length
  let truncationNote = '';
  if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
    sanitizedContent = sanitizedContent.slice(0, MAX_CONTENT_LENGTH);
    truncationNote = '\n[NOTE: Content was truncated due to length limits]';
  }

  // Extract potential quotes from content (text within quotation marks)
  const quoteMatches = sanitizedContent.match(/"[^"]+"|"[^"]+"|'[^']+'/g) || [];
  const quotesSection =
    quoteMatches.length > 0
      ? `\n\nQuotes to verify:\n${quoteMatches.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';

  // CRIT-1: Use structured delimiters that are harder to escape
  return `You are a fact-checking assistant. Your task is to verify the following content by cross-checking it against web sources.

## Content to Verify

**Author:** ${sanitizedAuthor}
**Author Handle:** ${sanitizedHandle}
**Source URL:** ${item.sourceUrl}

<<<CONTENT_START>>>
${sanitizedContent}${truncationNote}
<<<CONTENT_END>>>
${quotesSection}

## Original Context

<<<CONTEXT_START>>>
The user was searching for: "${sanitizedPrompt}"
<<<CONTEXT_END>>>

## Verification Tasks (Chain-of-Thought Required)

For each task below, think step-by-step before reaching a conclusion. Document your reasoning in the notes array.

### Task 1: Cross-check Content
Step 1a: Search for the exact content or key phrases in web sources
Step 1b: Compare found content with the provided content for accuracy
Step 1c: Note any discrepancies or confirmations found

### Task 2: Verify Author Attribution
Step 2a: Determine the relationship type - is this content:
  - AUTHORED_BY: Written/said directly by the claimed author
  - QUOTING: The author is quoting someone else
  - ABOUT: Content written about the author by a third party
Step 2b: Search for the author's verified profiles/publications
Step 2c: Cross-reference the content with known author works
Step 2d: Document the attribution type in notes (e.g., "Attribution: AUTHORED_BY - confirmed via official Twitter account")

### Task 3: Verify Quotes (Fuzzy Matching Allowed)
Step 3a: For each quote, search for the exact text first
Step 3b: If exact match not found, search for semantic equivalents (paraphrases with >80% meaning similarity)
Step 3c: If only a paraphrase is found, mark verified=true but add note: "Paraphrase match - original wording differs slightly"
Step 3d: A quote can be verified if the core meaning is preserved even if exact wording varies

### Task 4: Find Corroborating Sources
Step 4a: Search for independent sources confirming the claims
Step 4b: Evaluate source independence (same organization = not independent)
Step 4c: Prefer authoritative sources (official sites, reputable publications, verified accounts)

### Task 5: Determine Primary Source Status
Step 5a: Check if URL is author's official website/blog
Step 5b: Check if URL is author's verified social media
Step 5c: Check if URL is author's official publication/book
Step 5d: Only mark isPrimarySource=true if content originates FROM the author's own platform

### Task 6: Verify Publication Date
Step 6a: Look for explicit publication timestamps on the source
Step 6b: Cross-reference with archive services if needed
Step 6c: Use ISO 8601 format for dates (see Date Format Guide below)

## Confidence Calibration Scale

Use this specific scale for the confidence field:

- **0.0-0.2**: Unable to find ANY corroborating sources; content may be fabricated or too obscure
- **0.2-0.4**: Found partial matches or similar content, but not exact; attribution uncertain
- **0.4-0.6**: Found ONE reliable source confirming the content; basic verification achieved
- **0.6-0.8**: Found MULTIPLE independent sources confirming the content; good confidence
- **0.8-0.95**: PRIMARY source found with direct confirmation; high confidence
- **0.95-1.0**: Primary source with EXACT match of content; near-certain verification

Example calibration:
- Quote found on author's verified Twitter AND in a news article = 0.85
- Quote found only on aggregator sites with no primary source = 0.35
- Quote exactly matches author's published book = 0.98

## Publication Date Format Guide (ISO 8601)

When verifying publication dates, use these formats:

- **Full datetime**: "2024-03-15T14:30:00Z" (preferred when exact time is known)
- **Date only**: "2024-03-15T00:00:00Z" (use midnight UTC when only date is known)
- **Year-month only**: "2024-03-01T00:00:00Z" (use first of month when only month/year known)
- **Year only**: "2024-01-01T00:00:00Z" (use Jan 1 when only year is known)

Add a note explaining precision, e.g., "Publication date precision: month-level only"

## Handling Contradictory Sources

When sources disagree on facts:

1. **Note the contradiction** in the notes array with specifics
2. **Prefer primary sources** over secondary sources
3. **Prefer recent sources** over older sources (unless historical accuracy matters)
4. **Lower confidence score** to reflect uncertainty (typically 0.3-0.5 range)
5. **Document both versions** if the contradiction is significant
6. **Do NOT mark as verified** if primary facts are in dispute

Example note: "Contradiction found: Source A (author's blog) says 2019, Source B (news article) says 2020. Using primary source date."

## Source Requirements

Return between 1-5 sources maximum in sourcesFound:

- **Deduplicate**: Do not include multiple URLs from the same domain for the same claim
- **Prefer authoritative sources**: Official sites > Major publications > Blogs > Social aggregators
- **Prefer primary sources**: Author's own platforms > Third-party reporting
- **Include diverse sources**: If possible, include sources from different organizations

## Verification Level Definitions

- **UNVERIFIED**: Could not find corroborating sources
- **SOURCE_CONFIRMED**: Found in 1 web source
- **MULTISOURCE_CONFIRMED**: Found in 2+ independent sources
- **PRIMARY_SOURCE**: Confirmed from original author/publication (author's website, verified account, official publication)

## Response Format

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):

{
  "verified": boolean,
  "verificationLevel": "UNVERIFIED" | "SOURCE_CONFIRMED" | "MULTISOURCE_CONFIRMED" | "PRIMARY_SOURCE",
  "confidence": number between 0.0 and 1.0,
  "sourcesFound": ["url1", "url2", ...],
  "isPrimarySource": boolean,
  "notes": ["note1", "note2", ...],
  "quotesVerified": [
    {
      "quote": "the quote text",
      "verified": boolean,
      "sourceUrl": "url where found" (required if verified=true, omit if verified=false)
    }
  ],
  "publishedAtVerified": "ISO 8601 datetime string" (optional, include if publication date was verified)
}

## Critical Requirements

1. **Return ONLY the JSON object** - no markdown, no explanation text
2. **All URLs must be HTTP(S)** - no javascript:, file:, or data: URLs
3. **quotesVerified must include ALL quotes** - return an entry for EVERY quote listed in "Quotes to verify" above, even if unverified
4. **sourceUrl is REQUIRED when verified=true** - a verified quote MUST have a source URL
5. **isPrimarySource=true requires evidence** - only set if content originates from author's own platform
6. **Confidence must follow calibration scale** - use the specific ranges defined above
7. **sourcesFound: 1-5 URLs maximum** - deduplicated, prefer authoritative/primary sources
8. **Document reasoning in notes** - include key findings from each verification task`;
}

/**
 * Parse and validate a Perplexity validation response.
 *
 * Extracts JSON from the response content (handling markdown code fences
 * and other LLM output patterns) and validates against ValidationResponseSchema.
 *
 * @param content - Raw response content from Perplexity
 * @returns Parsed and validated ValidationResponse
 * @throws Error if JSON parsing fails or validation fails
 */
export function parseValidationResponse(content: string): ValidationResponse {
  // Use parseModelResponse to extract JSON from potential markdown/text
  const parsed = parseModelResponse<unknown>(content);

  // Validate against schema
  const result = ValidationResponseSchema.safeParse(parsed);

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Validation response schema error: ${errorMessages}`);
  }

  return result.data;
}

// ============================================
// Batch Validation Orchestration
// ============================================

/**
 * Calculate total engagement score for sorting items.
 * Higher engagement = higher priority for validation.
 */
function calculateEngagementScore(item: RawItem): number {
  const { likes = 0, comments = 0, shares = 0 } = item.engagement;
  return likes + comments + shares;
}

/**
 * Calculate recency score on a 0-100 scale.
 * Items within last 24 hours = 100, older items decay over time.
 * Uses publishedAt if available, otherwise retrievedAt.
 *
 * Issue 3: PRD requires selection based on engagement AND recency.
 */
function calculateRecencyScore(item: RawItem): number {
  const dateStr = item.publishedAt || item.retrievedAt;
  const itemDate = new Date(dateStr);
  const now = new Date();
  const ageMs = now.getTime() - itemDate.getTime();

  // Convert to hours
  const ageHours = ageMs / (1000 * 60 * 60);

  // Items within 24 hours get full score (100)
  if (ageHours <= 24) {
    return 100;
  }

  // Decay: lose 10 points per day after first 24 hours
  // Minimum score is 0
  const daysOld = (ageHours - 24) / 24;
  const score = 100 - daysOld * 10;
  return Math.max(0, score);
}

/**
 * Calculate combined selection score for validation capping.
 * Combines engagement (70%) and recency (30%) per PRD requirements.
 *
 * Issue 3: PRD states selection should be based on engagement AND recency.
 */
function calculateSelectionScore(item: RawItem): number {
  const engagementScore = calculateEngagementScore(item);
  const recencyScore = calculateRecencyScore(item);

  // Normalize engagement to 0-100 scale (cap at 1000 for normalization)
  const normalizedEngagement = Math.min(100, (engagementScore / 1000) * 100);

  // Combine: 70% engagement + 30% recency
  return normalizedEngagement * 0.7 + recencyScore * 0.3;
}

/**
 * Split array into batches of specified size.
 */
function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

// processWithConcurrency is imported from ../utils/concurrency.js (MAJ-6)

/**
 * Convert ValidationResponse to Validation schema format.
 *
 * Maps the API response to the internal Validation type used by ValidatedItem.
 * Uses assignVerificationLevel() to determine level from sourcesFound and isPrimarySource,
 * ensuring consistent logic with schema definitions.
 *
 * @param response - Parsed ValidationResponse from Perplexity
 * @returns Validation object conforming to ValidationSchema
 */
function toValidation(response: ValidationResponse): Validation {
  // Use assignVerificationLevel from validatedItem.ts for consistent level determination
  const level = assignVerificationLevel(response.sourcesFound, response.isPrimarySource);

  // Map quotes, ensuring verified quotes have sourceUrl (per QuoteVerifiedSchema requirement)
  const quotesVerified: QuoteVerified[] = response.quotesVerified
    .filter((q) => {
      // Per QuoteVerifiedSchema: if verified=true, sourceUrl is REQUIRED
      if (q.verified && !q.sourceUrl) {
        logWarning(`Dropping verified quote without sourceUrl: "${q.quote.slice(0, 50)}..."`);
        return false;
      }
      return true;
    })
    .map((q) => ({
      quote: q.quote,
      verified: q.verified,
      sourceUrl: q.sourceUrl,
    }));

  // Build notes array, including publishedAtVerified if present
  const notes = [...response.notes];
  if (response.publishedAtVerified) {
    notes.push(`Publication date verified: ${response.publishedAtVerified}`);
  }

  return {
    level,
    confidence: response.confidence,
    checkedAt: new Date().toISOString(),
    sourcesFound: response.sourcesFound,
    notes,
    quotesVerified,
  };
}

/**
 * Check if an error is a timeout error.
 * CRIT-3: Used for circuit breaker activation on Perplexity timeouts.
 *
 * @param error - The error to check
 * @returns True if this is a timeout-related error
 */
function isTimeoutError(error: unknown): boolean {
  // Check for TimeoutError class from retry.ts
  if (error instanceof TimeoutError) {
    return true;
  }

  // Check for axios timeout errors and common timeout patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('etimedout') ||
      message.includes('econnaborted')
    ) {
      return true;
    }

    // Check axios error code
    const axiosError = error as AxiosError;
    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
      return true;
    }
  }

  return false;
}

/**
 * Create an unverified ValidatedItem from a RawItem.
 *
 * Used when validation fails for any reason - ensures the pipeline
 * can continue even if individual item validation fails.
 *
 * @param item - The original RawItem
 * @param reason - Description of why validation failed
 * @returns ValidatedItem with UNVERIFIED validation and failure note
 */
function createUnverifiedItem(item: RawItem, reason: string): ValidatedItem {
  const validation = createUnverifiedValidation();
  // Override the default note with the specific failure reason
  validation.notes = [`Validation failed: ${reason}`];

  return {
    ...item,
    validation,
  };
}

/**
 * Validate a single item using Perplexity API (Section 8.1-8.3).
 *
 * This function orchestrates the validation of a single item:
 * 1. Builds a validation prompt using buildValidationPrompt()
 * 2. Calls makePerplexityRequest() to query Perplexity
 * 3. Extracts content using extractContent()
 * 4. Parses response using parseValidationResponse()
 * 5. Converts response to Validation object with proper verification level
 * 6. Returns ValidatedItem (RawItem extended with validation)
 *
 * FAILURE HANDLING (Section 8.3):
 * - Network/timeout errors: Returns item with UNVERIFIED validation
 * - Parse errors: Retries once with fix-JSON prompt, then UNVERIFIED if still fails
 * - Validation failure should NOT crash the pipeline
 *
 * @param item - RawItem to validate
 * @param originalPrompt - Original search prompt for context
 * @returns ValidatedItem with validation results
 */
export async function validateSingleItem(
  item: RawItem,
  originalPrompt: string
): Promise<ValidatedItem> {
  try {
    // Step 1: Build validation prompt for this item
    const prompt = buildValidationPrompt(item, originalPrompt);

    // Step 2: Make API request
    const response = await makePerplexityRequest(prompt, {
      operationName: `Validate item ${item.id.slice(0, SHORT_ID_LENGTH)}`,
      timeoutMs: 60000,
    });

    // Step 3: Extract content from response
    const content = extractContent(response);

    if (!content) {
      logWarning(`Validation failed for item ${item.id}: Empty response from Perplexity`);
      return createUnverifiedItem(item, 'Empty response from Perplexity API');
    }

    // Step 4: Parse response - with retry on parse error (Section 8.3)
    let validationResponse: ValidationResponse;

    try {
      validationResponse = parseValidationResponse(content);
    } catch (parseError) {
      // Retry with fix-JSON prompt (Section 8.3)
      const parseErrorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      logWarning(
        `Parse error for item ${item.id.slice(0, SHORT_ID_LENGTH)}, attempting fix-JSON retry: ${parseErrorMessage}`
      );

      const retryResult = await retryWithFixPrompt(
        async (fixPrompt: string) => {
          const fixResponse = await makePerplexityRequest(fixPrompt, {
            operationName: `Fix-JSON retry for item ${item.id.slice(0, SHORT_ID_LENGTH)}`,
            timeoutMs: 30000,
          });
          return extractContent(fixResponse);
        },
        ValidationResponseSchema,
        content,
        prompt
      );

      if (!retryResult.success) {
        logWarning(
          `Validation failed for item ${item.id.slice(0, SHORT_ID_LENGTH)}: Fix-JSON retry failed - ${retryResult.error}`
        );
        return createUnverifiedItem(
          item,
          `Parse error after fix-JSON retry: ${retryResult.error}`
        );
      }

      validationResponse = retryResult.data;
    }

    // Step 5: Convert to Validation schema format
    const validation = toValidation(validationResponse);

    // Step 6: Build ValidatedItem
    const validatedItem: ValidatedItem = {
      ...item,
      validation,
    };

    // Issue 1: Enforce ValidatedItemSchema to catch invalid verification states
    // (e.g., PRIMARY_SOURCE with zero sourcesFound violates provenance rules)
    const schemaResult = ValidatedItemSchema.safeParse(validatedItem);
    if (!schemaResult.success) {
      const errorMessages = schemaResult.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      logWarning(
        `Item ${item.id.slice(0, SHORT_ID_LENGTH)} failed ValidatedItemSchema: ${errorMessages}`
      );
      return createUnverifiedItem(item, `Schema validation failed: ${errorMessages}`);
    }

    return schemaResult.data;
  } catch (error) {
    // Handle any unexpected errors (network, timeout, etc.) - return UNVERIFIED
    // This ensures validation failure does NOT crash the pipeline
    // MAJ-3: Sanitize error message before exposing
    const rawErrorMessage = error instanceof Error ? error.message : String(error);
    const errorMessage = sanitizeErrorMessage(rawErrorMessage);
    logWarning(`Validation failed for item ${item.id.slice(0, SHORT_ID_LENGTH)}: ${errorMessage}`);
    return createUnverifiedItem(item, errorMessage);
  }
}

/**
 * Main validation orchestration function.
 *
 * Validates items in batches with concurrency control to manage API rate limits.
 * Items are sorted by combined engagement and recency score, then capped to limit API costs.
 *
 * Section 8.1: Handles skipValidation shortcut
 * Section 8.4: Implements batching and concurrency control
 * CRIT-3: Implements circuit breaker for timeout handling
 *
 * @param items - RawItems to validate
 * @param originalPrompt - Original search prompt for context
 * @param config - Pipeline configuration
 * @returns Promise resolving to array of ValidatedItems
 */
export async function validateItems(
  items: RawItem[],
  originalPrompt: string,
  config: PipelineConfig
): Promise<ValidatedItem[]> {
  // MAJ-8: Log warning when items array is empty
  if (items.length === 0) {
    logWarning('Validation: No items to validate');
    return [];
  }

  // Section 8.1: Shortcut - skip validation if configured
  if (config.skipValidation) {
    logStage('Validation (skipped)');
    return items.map((item) => ({
      ...item,
      validation: createUnverifiedValidation(),
    }));
  }

  logStage('Validation');

  // Cap items for validation to limit API costs
  // Issue 3: Sort by combined selection score (engagement + recency) instead of just engagement
  const sortedItems = [...items].sort(
    (a, b) => calculateSelectionScore(b) - calculateSelectionScore(a)
  );
  const maxItems = Math.min(items.length, config.maxTotal);
  const itemsToValidate = sortedItems.slice(0, maxItems);

  logVerbose(`Validating ${itemsToValidate.length} items (sorted by engagement+recency, capped at ${maxItems})`);

  // Section 8.4: Split into batches for sequential processing
  const batchSize = config.validationBatchSize || 10;
  const batches = splitIntoBatches(itemsToValidate, batchSize);
  const totalBatches = batches.length;

  logVerbose(`Split into ${totalBatches} batches of up to ${batchSize} items`);

  const allValidatedItems: ValidatedItem[] = [];

  // CRIT-3: Circuit breaker for timeout handling
  // When a timeout is detected, mark all remaining items UNVERIFIED
  let circuitBroken = false;

  // Process batches sequentially to manage rate limits
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    // CRIT-3: If circuit breaker activated, skip API calls and mark remaining items UNVERIFIED
    if (circuitBroken) {
      const unverifiedBatch = batch.map((item) =>
        createUnverifiedItem(item, 'Skipped due to Perplexity timeout (circuit breaker)')
      );
      allValidatedItems.push(...unverifiedBatch);
      continue;
    }

    logProgress(
      batchIndex + 1,
      totalBatches,
      `Validating batch ${batchIndex + 1}/${totalBatches}...`
    );

    // Section 8.4: Within each batch, validate items with concurrency limit
    const concurrencyLimit = API_CONCURRENCY_LIMITS.perplexity;
    const batchResults = await processWithConcurrency(
      batch,
      async (item) => {
        // CRIT-3: Check circuit breaker before each item
        if (circuitBroken) {
          return createUnverifiedItem(item, 'Skipped due to Perplexity timeout (circuit breaker)');
        }

        try {
          return await validateSingleItem(item, originalPrompt);
        } catch (error) {
          // CRIT-3: Detect timeout errors and activate circuit breaker
          if (isTimeoutError(error)) {
            circuitBroken = true;
            logWarning(
              'Circuit breaker activated: Perplexity timeout detected. Marking remaining items UNVERIFIED.'
            );
            return createUnverifiedItem(item, 'Perplexity timeout - circuit breaker activated');
          }
          throw error;
        }
      },
      concurrencyLimit
    );

    allValidatedItems.push(...batchResults);
  }

  logProgress(totalBatches, totalBatches, 'Validation complete');

  return allValidatedItems;
}
