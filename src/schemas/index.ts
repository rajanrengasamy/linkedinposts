import { z } from 'zod';

// ============================================
// Re-export all schemas and types
// ============================================

// RawItem - collected data from sources
export {
  SCHEMA_VERSION,
  SourceTypeSchema,
  EngagementSchema,
  RawItemSchema,
  createDefaultEngagement,
  type SourceType,
  type Engagement,
  type RawItem,
} from './rawItem.js';

// ValidatedItem - after verification
export {
  VerificationLevelSchema,
  VERIFICATION_BOOSTS,
  QuoteVerifiedSchema,
  ValidationSchema,
  ValidatedItemSchema,
  createUnverifiedValidation,
  assignVerificationLevel,
  type VerificationLevel,
  type QuoteVerified,
  type Validation,
  type ValidatedItem,
} from './validatedItem.js';

// ScoredItem - after scoring
export {
  SCORING_WEIGHTS,
  ScoresSchema,
  ScoredItemSchema,
  calculateOverallScore,
  calculateRecencyScore,
  calculateEngagementScore,
  type Scores,
  type ScoredItem,
} from './scoredItem.js';

// SynthesisResult - final output
export {
  LINKEDIN_POST_MAX_LENGTH,
  LINKEDIN_HASHTAGS_MIN,
  LINKEDIN_HASHTAGS_MAX,
  InfographicStyleSchema,
  KeyQuoteSchema,
  InfographicBriefSchema,
  FactCheckSummarySchema,
  CostBreakdownSchema,
  SynthesisMetadataSchema,
  SynthesisResultSchema,
  createEmptyCostBreakdown,
  calculateTotalCost,
  type InfographicStyle,
  type KeyQuote,
  type InfographicBrief,
  type FactCheckSummary,
  type CostBreakdown,
  type SynthesisMetadata,
  type SynthesisResult,
} from './synthesisResult.js';

// SourceReference - provenance tracking
export {
  SourceReferenceSchema,
  SourcesFileSchema,
  buildSourceReference,
  groupSourcesByLevel,
  formatSourcesMarkdown,
  type SourceReference,
  type SourcesFile,
} from './sourceReference.js';

// PipelineStatus - run metadata and status
export {
  QualityProfileSchema,
  ImageResolutionSchema,
  SourceOptionSchema,
  PipelineConfigSchema,
  PipelineStatusSchema,
  type QualityProfile,
  type ImageResolution,
  type SourceOption,
  type PipelineConfigValidated,
  type PipelineStatusValidated,
} from './pipelineStatus.js';

// ============================================
// Validation Result Types
// ============================================

/**
 * Result type for validation operations
 * Discriminated union for type-safe error handling
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/**
 * Parse result for model responses
 */
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate data against a schema, throwing on error
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated and typed data
 * @throws ZodError if validation fails
 */
export function validateOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): T {
  return schema.parse(data);
}

/**
 * Validate data against a schema, returning a Result type
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns ValidationResult with either data or error
 */
export function tryValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, error: result.error };
}

/**
 * Parse model response text, extracting JSON from markdown code fences
 *
 * Handles common LLM output patterns:
 * - ```json\n{...}\n```
 * - ```\n{...}\n```
 * - Raw JSON with trailing text
 * - JSON with leading/trailing whitespace
 *
 * @param text - Raw model response text
 * @returns Parsed JSON object
 * @throws Error if parsing fails
 */
export function parseModelResponse<T = unknown>(text: string): T {
  let cleaned = text.trim();

  // Remove markdown code fences (```json or ```)
  const jsonFenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
  const fenceMatch = cleaned.match(jsonFenceRegex);

  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try to find JSON object or array boundaries
  const jsonStart = cleaned.search(/[\[{]/);
  if (jsonStart === -1) {
    throw new Error('No JSON object or array found in response');
  }

  // Find matching end bracket
  const startChar = cleaned[jsonStart];
  const endChar = startChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let jsonEnd = -1;

  for (let i = jsonStart; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === startChar) {
      depth++;
    } else if (char === endChar) {
      depth--;
      if (depth === 0) {
        jsonEnd = i;
        break;
      }
    }
  }

  if (jsonEnd === -1) {
    throw new Error('Unclosed JSON structure in response');
  }

  const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to parse JSON: ${error.message}`);
  }
}

/**
 * Parse and validate model response in one step
 *
 * @param schema - Zod schema to validate against
 * @param text - Raw model response text
 * @returns ParseResult with either validated data or error message
 */
export function parseAndValidate<T>(
  schema: z.ZodSchema<T>,
  text: string
): ParseResult<T> {
  try {
    const parsed = parseModelResponse(text);
    const result = schema.safeParse(parsed);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errorMessages = result.error.issues
      .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');

    return { success: false, error: `Validation failed: ${errorMessages}` };
  } catch (e) {
    const error = e as Error;
    return { success: false, error: error.message };
  }
}

/**
 * Format Zod error for display
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((e: z.ZodIssue) => {
      const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
      return `${path}${e.message}`;
    })
    .join('\n');
}

// ============================================
// Retry with Fix-JSON Prompt (Section 2.3)
// ============================================

/**
 * Result type for retryWithFixPrompt
 */
export type RetryResult<T> =
  | { success: true; data: T; retried: boolean }
  | { success: false; error: string; originalError: string };

/**
 * Model call function signature for retry helper
 * Takes a prompt and returns raw model response text
 */
export type ModelCallFn = (prompt: string) => Promise<string>;

/**
 * Retry model output with a "fix JSON" prompt when validation fails
 *
 * This function attempts to parse and validate model output. If validation
 * fails, it sends a follow-up prompt asking the model to fix the JSON,
 * then validates again.
 *
 * @param callModel - Function that calls the model and returns response text
 * @param schema - Zod schema to validate against
 * @param originalResponse - The original model response that failed validation
 * @param originalPrompt - The original prompt (for context in fix request)
 * @returns RetryResult with validated data or error details
 *
 * @example
 * ```typescript
 * const result = await retryWithFixPrompt(
 *   async (prompt) => await openai.chat(prompt),
 *   ScoredItemSchema,
 *   badJsonResponse,
 *   originalScoringPrompt
 * );
 * if (result.success) {
 *   console.log('Got valid data:', result.data);
 * }
 * ```
 */
export async function retryWithFixPrompt<T>(
  callModel: ModelCallFn,
  schema: z.ZodSchema<T>,
  originalResponse: string,
  originalPrompt?: string
): Promise<RetryResult<T>> {
  // First, try to parse the original response
  const firstAttempt = parseAndValidate(schema, originalResponse);

  if (firstAttempt.success) {
    return { success: true, data: firstAttempt.data, retried: false };
  }

  const originalError = firstAttempt.error;

  // Build the fix prompt
  const fixPrompt = buildFixJsonPrompt(originalResponse, originalError, originalPrompt);

  try {
    // Call model with fix prompt
    const fixedResponse = await callModel(fixPrompt);

    // Try to parse and validate the fixed response
    const secondAttempt = parseAndValidate(schema, fixedResponse);

    if (secondAttempt.success) {
      return { success: true, data: secondAttempt.data, retried: true };
    }

    // Both attempts failed
    return {
      success: false,
      error: `Fix attempt also failed: ${secondAttempt.error}`,
      originalError,
    };
  } catch (e) {
    const error = e as Error;
    return {
      success: false,
      error: `Model call failed during fix attempt: ${error.message}`,
      originalError,
    };
  }
}

/**
 * Build the prompt to ask model to fix invalid JSON
 */
function buildFixJsonPrompt(
  badResponse: string,
  validationError: string,
  originalPrompt?: string
): string {
  const contextSection = originalPrompt
    ? `\n\nOriginal request context:\n${originalPrompt.slice(0, 500)}${originalPrompt.length > 500 ? '...' : ''}`
    : '';

  return `The following JSON response has validation errors. Please fix it and return ONLY valid JSON with no additional text.

Validation errors:
${validationError}

Invalid JSON:
\`\`\`json
${badResponse}
\`\`\`
${contextSection}

Return the corrected JSON only, with no explanation or markdown formatting:`;
}
