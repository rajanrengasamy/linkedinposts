/**
 * Refinement Module Zod Schemas
 *
 * Validation schemas for refinement phase data structures.
 * Used to validate LLM responses and ensure type safety.
 */

import { z } from 'zod';

// ============================================
// Model Enum Schema
// ============================================

/**
 * Schema for refinement model selection.
 * Validates against allowed model values.
 */
export const RefinementModelSchema = z.enum(['gemini', 'gpt', 'claude', 'kimi2']);
export type RefinementModelValidated = z.infer<typeof RefinementModelSchema>;

// ============================================
// Configuration Schema
// ============================================

/**
 * Schema for refinement configuration.
 * Used to validate config objects before processing.
 */
export const RefinementConfigSchema = z.object({
  /** Skip refinement phase */
  skip: z.boolean(),

  /** Model to use */
  model: RefinementModelSchema,

  /** Maximum iterations */
  maxIterations: z.number().int().min(1).max(10),

  /** Timeout per LLM call (ms) */
  timeoutMs: z.number().int().min(5000).max(120000),
});
export type RefinementConfigValidated = z.infer<typeof RefinementConfigSchema>;

// ============================================
// Prompt Analysis Schema
// ============================================

/**
 * Schema for LLM's prompt analysis response.
 *
 * Validates the JSON response from LLM analyzers:
 * - isClear=true requires suggestedRefinement (optional but expected)
 * - isClear=false requires at least 2 clarifying questions
 * - confidence must be 0-1 range
 */
export const PromptAnalysisSchema = z
  .object({
    /** Whether the prompt is clear enough to proceed */
    isClear: z.boolean(),

    /** Confidence in the clarity assessment (0.0-1.0) */
    confidence: z.number().min(0).max(1),

    /**
     * Questions to ask when prompt is unclear.
     * Must have at least 2 when isClear=false, max 4.
     */
    clarifyingQuestions: z
      .array(z.string().min(10).max(500))
      .min(2)
      .max(4)
      .optional(),

    /**
     * Suggested refinement when prompt is clear.
     * Should be more specific than original.
     */
    suggestedRefinement: z.string().min(10).max(3000).optional(),

    /** Brief explanation of the analysis */
    reasoning: z.string().min(10).max(1500),

    /** Detected intents from the prompt */
    detectedIntents: z.array(z.string().min(2).max(300)).max(10).optional(),
  })
  .refine(
    (data) => {
      // If not clear, must have at least 2 clarifying questions
      if (!data.isClear) {
        return (
          data.clarifyingQuestions !== undefined &&
          data.clarifyingQuestions.length >= 2
        );
      }
      return true;
    },
    {
      message:
        'Unclear prompts (isClear=false) must include at least 2 clarifying questions',
      path: ['clarifyingQuestions'],
    }
  );

export type PromptAnalysisValidated = z.infer<typeof PromptAnalysisSchema>;

// ============================================
// Refinement Response Schema
// ============================================

/**
 * Schema for LLM response when refining after clarifying questions.
 *
 * After user answers questions, the LLM generates an optimized prompt
 * that incorporates their answers.
 */
export const RefinementResponseSchema = z.object({
  /**
   * The refined prompt incorporating user answers.
   * Should be clear, specific, and actionable.
   */
  refinedPrompt: z.string().min(10).max(3000),

  /**
   * Brief explanation of how answers were incorporated.
   */
  reasoning: z.string().min(10).max(1500),

  /**
   * Detected intents after incorporating answers.
   * May differ from initial analysis.
   */
  detectedIntents: z.array(z.string().min(2).max(300)).max(10).optional(),
});

export type RefinementResponseValidated = z.infer<
  typeof RefinementResponseSchema
>;

// ============================================
// User Interaction Schemas
// ============================================

/**
 * Schema for user action after refinement.
 */
export const UserActionSchema = z.enum(['accept', 'reject', 'feedback']);
export type UserActionValidated = z.infer<typeof UserActionSchema>;

/**
 * Schema for user response to a refinement round.
 */
export const UserResponseSchema = z
  .object({
    /** Action taken by user */
    action: UserActionSchema,

    /** Feedback text when action is 'feedback' */
    feedback: z.string().min(1).max(1000).optional(),
  })
  .refine(
    (data) => {
      // If action is feedback, must have feedback text
      if (data.action === 'feedback') {
        return data.feedback !== undefined && data.feedback.trim().length > 0;
      }
      return true;
    },
    {
      message: "Feedback action requires non-empty 'feedback' field",
      path: ['feedback'],
    }
  );

export type UserResponseValidated = z.infer<typeof UserResponseSchema>;

/**
 * Schema for user answers to clarifying questions.
 * Maps question index/text to answer string.
 *
 * Requires at least one answer to be non-empty.
 */
export const UserAnswersSchema = z
  .record(z.string(), z.string().max(1000))
  .refine(
    (answers) => {
      // At least one answer must be non-empty
      const values = Object.values(answers);
      return values.some((v) => v.trim().length > 0);
    },
    {
      message: 'At least one answer must be provided',
    }
  );

export type UserAnswersValidated = z.infer<typeof UserAnswersSchema>;

// ============================================
// Refinement Result Schema
// ============================================

/**
 * Schema for the complete refinement phase result.
 * Used for validating/serializing refinement output.
 */
export const RefinementResultSchema = z.object({
  /** Final prompt to use (refined or original) */
  refinedPrompt: z.string().min(1).max(5000),

  /** Original user prompt */
  originalPrompt: z.string().min(1).max(5000),

  /** Whether refinement was applied */
  wasRefined: z.boolean(),

  /** Number of iterations performed */
  iterationCount: z.number().int().min(0).max(10),

  /** Model used for refinement */
  modelUsed: RefinementModelSchema,

  /** Processing time in milliseconds */
  processingTimeMs: z.number().int().min(0),
});

export type RefinementResultValidated = z.infer<typeof RefinementResultSchema>;

// ============================================
// Context Schema (Internal)
// ============================================

/**
 * Schema for internal refinement context.
 * Used between iterations of the refinement loop.
 */
export const RefinementContextSchema = z.object({
  /** Current working prompt */
  currentPrompt: z.string().min(1),

  /** Original user prompt */
  originalPrompt: z.string().min(1),

  /** Questions from previous iterations */
  previousQuestions: z.array(z.string()),

  /** Answers from previous iterations */
  previousAnswers: UserAnswersSchema.or(z.record(z.string(), z.string())),

  /** Current iteration number (1-indexed) */
  iteration: z.number().int().min(1),

  /** Start timestamp */
  startTime: z.number().int().positive(),
});

export type RefinementContextValidated = z.infer<
  typeof RefinementContextSchema
>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Check if a string is a valid refinement model.
 *
 * @param value - String to check
 * @returns true if value is a valid RefinementModel
 */
export function isValidRefinementModel(value: string): value is RefinementModelValidated {
  return RefinementModelSchema.safeParse(value).success;
}

/**
 * Parse and validate a prompt analysis response from an LLM.
 *
 * @param data - Raw parsed JSON from LLM response
 * @returns Validated PromptAnalysis or null if invalid
 */
export function parsePromptAnalysis(
  data: unknown
): PromptAnalysisValidated | null {
  const result = PromptAnalysisSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}

/**
 * Parse and validate a refinement response from an LLM.
 *
 * @param data - Raw parsed JSON from LLM response
 * @returns Validated RefinementResponse or null if invalid
 */
export function parseRefinementResponse(
  data: unknown
): RefinementResponseValidated | null {
  const result = RefinementResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}

/**
 * Format Zod validation errors for display.
 *
 * @param error - Zod error object
 * @returns Human-readable error message
 */
export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}
