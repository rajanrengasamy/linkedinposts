/**
 * Prompt Refinement Phase - Main Orchestrator
 *
 * Orchestrates the prompt refinement process (Stage 0) before data collection.
 * Analyzes user prompts and either suggests refinements or asks clarifying questions.
 *
 * Flow:
 * 1. If skip is true, return original prompt unchanged
 * 2. Analyze prompt with selected model
 * 3. If clear: show refined prompt, ask user to accept/reject/feedback
 * 4. If not clear: display questions, collect answers, re-analyze
 * 5. Loop until user accepts or max iterations reached
 * 6. Return RefinementResult with final prompt
 *
 * @see docs/PRD-v2.md Section 18
 */

// ============================================
// Re-export types and schemas for public API
// ============================================

export * from './types.js';
export * from './schemas.js';

// ============================================
// Imports
// ============================================

import type {
  RefinementConfig,
  RefinementResult,
  RefinementModel,
  PromptAnalysis,
  UserAnswers,
  AnalyzerFn,
} from './types.js';
import { DEFAULT_REFINEMENT_CONFIG } from './types.js';
import { analyzeWithGemini } from './gemini.js';
import { analyzeWithGPT } from './gpt.js';
import { analyzeWithClaude } from './claude.js';
import { analyzeWithKimi } from './kimi.js';
import { buildRefinementPrompt, buildFeedbackPrompt, REFINEMENT_SYSTEM_PROMPT } from './prompts.js';
import { PromptAnalysisSchema, RefinementResponseSchema } from './schemas.js';
import {
  createReadlineInterface,
  displayRefinedPrompt,
  displayClarifyingQuestions,
  collectAnswers,
  askAcceptRejectFeedback,
  closeReadline,
  displayAnalyzing,
  displaySkipping,
  displayUsingOriginal,
  displaySuccess,
  displayWarning,
} from '../utils/stdin.js';
import { logStage, logVerbose, logWarning, logSuccess } from '../utils/logger.js';

// ============================================
// Model Selection
// ============================================

/**
 * Select the appropriate analyzer function based on model.
 *
 * @param model - The refinement model to use
 * @returns The analyzer function for the specified model
 */
function selectAnalyzer(model: RefinementModel): AnalyzerFn {
  switch (model) {
    case 'gemini':
      return analyzeWithGemini;
    case 'gpt':
      return analyzeWithGPT;
    case 'claude':
      return analyzeWithClaude;
    case 'kimi2':
      return analyzeWithKimi;
    default:
      // Fallback to gemini for unknown models
      logWarning(`Unknown refinement model '${model}', falling back to gemini`);
      return analyzeWithGemini;
  }
}

// ============================================
// Prompt Re-analysis with Answers
// ============================================

/**
 * Re-analyze prompt after collecting user answers.
 *
 * Builds a new prompt that incorporates the user's answers to clarifying
 * questions, then analyzes it with the selected model.
 *
 * @param originalPrompt - The original user prompt
 * @param questions - The clarifying questions that were asked
 * @param answers - The user's answers to those questions
 * @param analyzer - The analyzer function to use
 * @param config - Refinement configuration
 * @returns PromptAnalysis with suggested refinement
 */
async function reanalyzeWithAnswers(
  originalPrompt: string,
  questions: string[],
  answers: UserAnswers,
  analyzer: AnalyzerFn,
  config: RefinementConfig
): Promise<PromptAnalysis> {
  // Build a combined prompt with the Q&A context
  const refinementPrompt = buildRefinementPrompt(originalPrompt, questions, answers);

  // Re-analyze with the enriched context
  // The analyzer should now return isClear=true with a suggestedRefinement
  const analysis = await analyzer(refinementPrompt, config);

  // If still not clear after answers, force a refinement
  if (!analysis.isClear && !analysis.suggestedRefinement) {
    // Create a synthetic refinement by combining original with answers
    const combinedAnswers = Object.values(answers).filter(a => a.trim()).join('; ');
    return {
      ...analysis,
      isClear: true,
      suggestedRefinement: `${originalPrompt} - focusing on: ${combinedAnswers}`,
    };
  }

  return analysis;
}

/**
 * Re-analyze prompt with user feedback.
 *
 * Takes the original prompt, current refinement, and user feedback,
 * then generates an adjusted refinement.
 *
 * @param originalPrompt - The original user prompt
 * @param currentRefinement - The current suggested refinement
 * @param feedback - The user's feedback
 * @param analyzer - The analyzer function to use
 * @param config - Refinement configuration
 * @returns PromptAnalysis with adjusted refinement
 */
async function reanalyzeWithFeedback(
  originalPrompt: string,
  currentRefinement: string,
  feedback: string,
  analyzer: AnalyzerFn,
  config: RefinementConfig
): Promise<PromptAnalysis> {
  // Build a feedback prompt (requires original, refinement, and feedback)
  const feedbackPrompt = buildFeedbackPrompt(originalPrompt, currentRefinement, feedback);

  // Re-analyze with the feedback context
  const analysis = await analyzer(feedbackPrompt, config);

  // If analysis returns questions instead of refinement, force refinement
  if (!analysis.isClear || !analysis.suggestedRefinement) {
    // Apply feedback directly to current refinement
    return {
      isClear: true,
      confidence: 0.7,
      suggestedRefinement: `${currentRefinement} (${feedback})`,
      reasoning: 'Applied user feedback to refinement',
    };
  }

  return analysis;
}

// ============================================
// Main Orchestrator
// ============================================

/**
 * Main prompt refinement function.
 *
 * Orchestrates the entire refinement process:
 * 1. If config.skip is true, return original prompt unchanged
 * 2. Analyze prompt with selected model
 * 3. If clear: show refined prompt, ask user to accept/reject/feedback
 * 4. If not clear: display questions, collect answers, re-analyze
 * 5. Loop until user accepts or max iterations reached
 * 6. Return RefinementResult
 *
 * Handles Ctrl+C gracefully by returning the original prompt.
 *
 * @param prompt - The user's original prompt to refine
 * @param config - Refinement configuration (defaults to DEFAULT_REFINEMENT_CONFIG)
 * @returns RefinementResult with the final prompt to use
 *
 * @example
 * ```typescript
 * const result = await refinePrompt('AI trends', {
 *   skip: false,
 *   model: 'gemini',
 *   maxIterations: 3,
 *   timeoutMs: 30000
 * });
 *
 * console.log('Final prompt:', result.refinedPrompt);
 * console.log('Was refined:', result.wasRefined);
 * ```
 */
export async function refinePrompt(
  prompt: string,
  config: RefinementConfig = DEFAULT_REFINEMENT_CONFIG
): Promise<RefinementResult> {
  const startTime = Date.now();

  // Build result with defaults
  const buildResult = (
    refinedPrompt: string,
    wasRefined: boolean,
    iterationCount: number,
    extras: Partial<RefinementResult> = {}
  ): RefinementResult => ({
    refinedPrompt,
    originalPrompt: prompt,
    wasRefined,
    iterationCount,
    modelUsed: config.model,
    processingTimeMs: Date.now() - startTime,
    ...extras,
  });

  // 1. Skip if configured
  if (config.skip) {
    displaySkipping('--skip-refinement flag set');
    return buildResult(prompt, false, 0);
  }

  // Log stage start
  logStage('Prompt Refinement');

  // Get the analyzer for the selected model
  const analyzer = selectAnalyzer(config.model);

  // Create readline interface for user interaction
  const rl = createReadlineInterface();

  // Track state across iterations
  let currentPrompt = prompt;
  let iteration = 0;
  let lastAnalysis: PromptAnalysis | null = null;
  let wasRefined = false;

  // Set up Ctrl+C handler
  let ctrlCPressed = false;
  const sigintHandler = () => {
    ctrlCPressed = true;
    console.log('\n');
    displayWarning('Refinement cancelled');
    rl.close();
  };
  process.once('SIGINT', sigintHandler);

  try {
    // Main refinement loop
    while (iteration < config.maxIterations) {
      iteration++;

      if (ctrlCPressed) {
        displayUsingOriginal();
        return buildResult(prompt, false, iteration - 1);
      }

      logVerbose(`Refinement iteration ${iteration}/${config.maxIterations}`);
      displayAnalyzing();

      // Analyze the current prompt
      let analysis: PromptAnalysis;
      try {
        if (lastAnalysis && !lastAnalysis.isClear && lastAnalysis.clarifyingQuestions) {
          // We have answers from previous iteration, re-analyze with them
          // This path is reached after collecting answers
          const answers = await collectAnswers(rl, lastAnalysis.clarifyingQuestions);

          if (ctrlCPressed) {
            displayUsingOriginal();
            return buildResult(prompt, false, iteration);
          }

          analysis = await reanalyzeWithAnswers(
            prompt,
            lastAnalysis.clarifyingQuestions,
            answers,
            analyzer,
            config
          );
        } else {
          // Fresh analysis
          analysis = await analyzer(currentPrompt, config);
        }
      } catch (error) {
        // LLM failed - skip refinement gracefully
        const message = error instanceof Error ? error.message : String(error);
        logWarning(`Refinement analysis failed: ${message}`);
        displayWarning('Skipping refinement due to error');
        return buildResult(prompt, false, iteration);
      }

      lastAnalysis = analysis;

      // Handle the analysis result
      if (analysis.isClear && analysis.suggestedRefinement) {
        // Prompt is clear - show refinement and ask for confirmation
        displayRefinedPrompt(analysis.suggestedRefinement);

        if (ctrlCPressed) {
          displayUsingOriginal();
          return buildResult(prompt, false, iteration);
        }

        // Ask user: Accept, Reject, or Feedback?
        const response = await askAcceptRejectFeedback(rl);

        if (ctrlCPressed) {
          displayUsingOriginal();
          return buildResult(prompt, false, iteration);
        }

        switch (response.action) {
          case 'accept':
            // User accepted the refinement
            displaySuccess('Prompt refined successfully');
            return buildResult(analysis.suggestedRefinement, true, iteration);

          case 'reject':
            // User rejected - use original
            displayUsingOriginal();
            return buildResult(prompt, false, iteration);

          case 'feedback':
            // User wants to provide feedback
            if (response.feedback && response.feedback.trim()) {
              logVerbose(`User feedback: ${response.feedback}`);
              // Re-analyze with feedback (pass original prompt, current refinement, and feedback)
              try {
                const feedbackAnalysis = await reanalyzeWithFeedback(
                  prompt, // original prompt
                  analysis.suggestedRefinement,
                  response.feedback,
                  analyzer,
                  config
                );
                lastAnalysis = feedbackAnalysis;
                currentPrompt = feedbackAnalysis.suggestedRefinement ?? currentPrompt;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logWarning(`Feedback re-analysis failed: ${message}`);
                // Continue with current refinement
              }
            }
            // Loop continues
            break;
        }
      } else if (!analysis.isClear && analysis.clarifyingQuestions) {
        // Prompt needs clarification - display questions
        displayClarifyingQuestions(analysis.clarifyingQuestions);

        // The next iteration will collect answers and re-analyze
        // (handled at the start of the loop)
      } else {
        // Unexpected state - prompt is neither clear nor has questions
        logWarning('Analysis returned unexpected state - using original prompt');
        return buildResult(prompt, false, iteration);
      }
    }

    // Max iterations reached
    logWarning(`Max refinement iterations (${config.maxIterations}) reached`);
    if (lastAnalysis?.suggestedRefinement) {
      // Use the last suggested refinement
      displayRefinedPrompt(lastAnalysis.suggestedRefinement);
      displaySuccess('Using last refinement (max iterations reached)');
      return buildResult(lastAnalysis.suggestedRefinement, true, iteration);
    }

    // No refinement available - use original
    displayUsingOriginal();
    return buildResult(prompt, false, iteration);
  } finally {
    // Always clean up
    process.removeListener('SIGINT', sigintHandler);
    closeReadline(rl);
  }
}

// ============================================
// Exports
// ============================================

// Re-export individual analyzers for direct use if needed
export { analyzeWithGemini } from './gemini.js';
export { analyzeWithGPT } from './gpt.js';
export { analyzeWithClaude, getAnthropicClient } from './claude.js';
export { analyzeWithKimi } from './kimi.js';
