/**
 * Refinement Module Type Definitions
 *
 * Types for the prompt refinement phase (Stage 0) that runs before
 * data collection. This phase analyzes user prompts for clarity and
 * either suggests refinements or asks clarifying questions.
 */

// ============================================
// Model Configuration
// ============================================

/**
 * Available models for prompt refinement.
 *
 * | Model   | Provider   | Model ID                        | Use Case               |
 * |---------|------------|--------------------------------|------------------------|
 * | gemini  | Google     | gemini-3-flash-preview         | Fast, cost-effective   |
 * | gpt     | OpenAI     | gpt-5.2                        | Most capable reasoning |
 * | claude  | Anthropic  | claude-sonnet-4-20250514     | Balanced reasoning     |
 * | kimi2   | OpenRouter | moonshotai/kimi-k2-thinking    | Deep reasoning         |
 */
export type RefinementModel = 'gemini' | 'gpt' | 'claude' | 'kimi2';

/**
 * Valid refinement model values for validation
 */
export const REFINEMENT_MODELS: readonly RefinementModel[] = [
  'gemini',
  'gpt',
  'claude',
  'kimi2',
] as const;

/**
 * Model ID mapping for each refinement model provider
 */
export const REFINEMENT_MODEL_IDS: Record<RefinementModel, string> = {
  gemini: 'gemini-3-flash-preview',
  gpt: 'gpt-5.2',
  claude: 'claude-sonnet-4-20250514',
  kimi2: 'moonshotai/kimi-k2-thinking',
} as const;

// ============================================
// Configuration
// ============================================

/**
 * Configuration for the prompt refinement phase.
 *
 * Controls whether refinement runs, which model to use,
 * and iteration/timeout limits.
 */
export interface RefinementConfig {
  /**
   * Skip the refinement phase entirely.
   * Set via --skip-refinement CLI flag.
   * @default false
   */
  skip: boolean;

  /**
   * Model to use for prompt analysis.
   * Set via --refinement-model CLI option.
   * @default 'gemini'
   */
  model: RefinementModel;

  /**
   * Maximum refinement iterations before forcing completion.
   * Each iteration is one analyze-respond cycle.
   * @default 3
   */
  maxIterations: number;

  /**
   * Timeout for each LLM call in milliseconds.
   * @default 30000 (30 seconds)
   */
  timeoutMs: number;
}

/**
 * Default refinement configuration values.
 * Used when options are not explicitly provided.
 */
export const DEFAULT_REFINEMENT_CONFIG: RefinementConfig = {
  skip: false,
  model: 'gemini',
  maxIterations: 3,
  timeoutMs: 30000,
};

// ============================================
// LLM Analysis Types
// ============================================

/**
 * Result of LLM analyzing the user's prompt.
 *
 * The LLM evaluates the prompt for clarity and returns either:
 * - isClear=true: A suggested refinement that optimizes the prompt
 * - isClear=false: Clarifying questions to gather more context
 */
export interface PromptAnalysis {
  /**
   * Whether the prompt is clear enough to proceed.
   * If true, suggestedRefinement should be provided.
   * If false, clarifyingQuestions should be provided.
   */
  isClear: boolean;

  /**
   * Confidence level in the clarity assessment.
   * Range: 0.0 (no confidence) to 1.0 (fully confident)
   */
  confidence: number;

  /**
   * Questions to ask the user when prompt is unclear.
   * Should contain at least 2 questions when isClear=false.
   * Max 4 questions to avoid overwhelming the user.
   */
  clarifyingQuestions?: string[];

  /**
   * Optimized version of the prompt when clear.
   * Should be more specific and actionable than the original.
   */
  suggestedRefinement?: string;

  /**
   * Brief explanation of the analysis decision.
   * Helps users understand why questions were asked or how the prompt was refined.
   */
  reasoning: string;

  /**
   * Detected user intents from the prompt.
   * E.g., ["thought-leadership", "data-driven", "industry-specific"]
   */
  detectedIntents?: string[];
}

// ============================================
// User Interaction Types
// ============================================

/**
 * User's action after seeing a refined prompt or answering questions.
 *
 * - 'accept': Use the refined prompt
 * - 'reject': Use the original prompt unchanged
 * - 'feedback': Provide additional feedback for another refinement round
 */
export type UserAction = 'accept' | 'reject' | 'feedback';

/**
 * User's response to a refinement round.
 * Captures the action taken and optional feedback.
 */
export interface UserResponse {
  /**
   * The action the user chose:
   * - 'accept': Proceed with refined prompt
   * - 'reject': Use original prompt
   * - 'feedback': Iterate with additional feedback
   */
  action: UserAction;

  /**
   * Additional feedback when action is 'feedback'.
   * Used to guide the next refinement iteration.
   */
  feedback?: string;
}

/**
 * User's answers to clarifying questions.
 * Keys are question indices (0, 1, 2...) or question text.
 * Values are the user's answers.
 */
export type UserAnswers = Record<string, string>;

// ============================================
// Refinement Result Types
// ============================================

/**
 * Result of the complete refinement phase.
 *
 * Contains the final prompt to use (refined or original),
 * along with metadata about the refinement process.
 */
export interface RefinementResult {
  /**
   * The prompt to use for the pipeline.
   * Either the refined version or the original if rejected/skipped.
   */
  refinedPrompt: string;

  /**
   * The original prompt as provided by the user.
   */
  originalPrompt: string;

  /**
   * Whether any refinement was applied.
   * False if:
   * - User rejected the refinement
   * - Refinement was skipped (--skip-refinement)
   * - LLM determined prompt was already optimal
   */
  wasRefined: boolean;

  /**
   * Number of refinement iterations performed.
   * 0 if refinement was skipped.
   */
  iterationCount: number;

  /**
   * Which model was used for refinement.
   * Useful for cost tracking and debugging.
   */
  modelUsed: RefinementModel;

  /**
   * Total time spent in refinement phase (milliseconds).
   * Includes LLM calls and user input time.
   */
  processingTimeMs: number;
}

// ============================================
// Internal Types
// ============================================

/**
 * Context passed between refinement iterations.
 * Tracks state across the refinement loop.
 */
export interface RefinementContext {
  /** The current working prompt (may be modified each iteration) */
  currentPrompt: string;

  /** Original user prompt (never modified) */
  originalPrompt: string;

  /** Questions asked in previous iterations */
  previousQuestions: string[];

  /** Answers collected in previous iterations */
  previousAnswers: UserAnswers;

  /** Current iteration number (1-indexed) */
  iteration: number;

  /** Start time for duration tracking */
  startTime: number;
}

/**
 * Function signature for model-specific analyzers.
 * Each model integration (gemini.ts, gpt.ts, etc.) exports this.
 */
export type AnalyzerFn = (
  prompt: string,
  config: RefinementConfig
) => Promise<PromptAnalysis>;
