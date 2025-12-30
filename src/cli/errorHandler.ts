/**
 * CLI Error Handler
 *
 * Provides error handling utilities for the CLI pipeline execution.
 * Handles error logging, status file writing, and exit code management.
 */

import { join } from 'node:path';
import type { PipelineConfig, PipelineStatus } from '../types/index.js';
import { sanitize, logError, logPipelineResult } from '../utils/logger.js';
import { writePipelineStatus, safeWrite } from '../utils/fileWriter.js';

// ============================================
// Exit Codes
// ============================================

/**
 * Exit codes for CLI.
 *
 * 0: Success - Pipeline completed successfully
 * 1: Pipeline error - Runtime failure during execution
 * 2: Configuration error - Missing API keys or invalid options
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  PIPELINE_ERROR: 1,
  CONFIG_ERROR: 2,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

// ============================================
// Error Context
// ============================================

/**
 * Error context for pipeline failures.
 * Provides information needed for status file writing.
 */
export interface ErrorContext {
  /** Current pipeline stage when error occurred */
  stage?: string;
  /** Output directory path (if created) */
  outputDir?: string;
  /** Pipeline configuration */
  config: PipelineConfig;
  /** Pipeline start time (Date.now()) */
  startTime: number;
}

// ============================================
// Error Classification
// ============================================

/**
 * Patterns that indicate a configuration error.
 * These errors should exit with CONFIG_ERROR (2) instead of PIPELINE_ERROR (1).
 */
const CONFIG_ERROR_PATTERNS = [
  /missing required api key/i,
  /invalid.*option/i,
  /configuration.*invalid/i,
  /\.env/i,
  /environment.*variable/i,
  /api key.*not set/i,
  /invalid.*source/i,
  /invalid.*quality.*profile/i,
];

/**
 * Determine if an error is a configuration error.
 *
 * Configuration errors are issues with setup (missing API keys, invalid options)
 * that the user needs to fix before running the pipeline.
 *
 * @param error - The error to classify
 * @returns true if this is a configuration error
 */
export function isConfigError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Check for known configuration error patterns
  for (const pattern of CONFIG_ERROR_PATTERNS) {
    if (pattern.test(error.message)) {
      return true;
    }
  }

  // Additional heuristics
  if (message.includes('missing') && message.includes('key')) {
    return true;
  }

  return false;
}

/**
 * Get the appropriate exit code for an error.
 *
 * @param error - The error that occurred
 * @returns Exit code (1 for pipeline errors, 2 for config errors)
 */
export function getExitCode(error: Error): ExitCode {
  return isConfigError(error) ? EXIT_CODES.CONFIG_ERROR : EXIT_CODES.PIPELINE_ERROR;
}

// ============================================
// Pipeline Status Helpers
// ============================================

/**
 * Create initial pipeline status for tracking.
 *
 * @param config - Pipeline configuration
 * @param startTime - Pipeline start time (Date.now())
 * @returns Initial PipelineStatus object
 */
export function createPipelineStatus(config: PipelineConfig, startTime: number): PipelineStatus {
  return {
    success: false,
    startedAt: new Date(startTime).toISOString(),
    config,
  };
}

/**
 * Update pipeline status on completion.
 *
 * @param status - Current pipeline status
 * @param success - Whether pipeline succeeded
 * @param durationMs - Total duration in milliseconds
 * @param error - Optional error message (sanitized)
 * @returns Updated PipelineStatus
 */
export function completePipelineStatus(
  status: PipelineStatus,
  success: boolean,
  durationMs: number,
  error?: string
): PipelineStatus {
  return {
    ...status,
    success,
    completedAt: new Date().toISOString(),
    durationMs,
    error: error ? sanitize(error) : undefined,
  };
}

/**
 * Update pipeline status with current stage.
 *
 * This helper is used for PipelineStatus objects during error handling
 * to track which stage failed. Note that runPipeline.ts uses a separate
 * internal PipelineState for runtime tracking - this is intentional as
 * PipelineStatus is for serialization/output while PipelineState is
 * an internal implementation detail.
 *
 * @param status - Current pipeline status
 * @param stage - Stage name (e.g., "collection", "validation")
 * @returns Updated PipelineStatus with stage field set
 */
export function updatePipelineStage(status: PipelineStatus, stage: string): PipelineStatus {
  return {
    ...status,
    stage,
  };
}

// ============================================
// Error Handling
// ============================================

/**
 * Handle pipeline error - log, write status, and return exit code.
 *
 * This function:
 * 1. Logs the sanitized error message
 * 2. Writes pipeline_status.json with error details (if outputDir exists)
 * 3. Returns the appropriate exit code
 *
 * @param error - The error that occurred
 * @param context - Error context for status writing
 * @returns Exit code (1 or 2)
 */
export async function handlePipelineError(
  error: Error,
  context: ErrorContext
): Promise<ExitCode> {
  const durationMs = Date.now() - context.startTime;
  const sanitizedMessage = sanitize(error.message);

  // Log the error
  logError(sanitizedMessage);

  // Log pipeline result summary
  logPipelineResult(false, durationMs, context.outputDir ?? 'N/A', sanitizedMessage);

  // Write pipeline_status.json if we have an output directory
  if (context.outputDir) {
    const status = createPipelineStatus(context.config, context.startTime);
    const finalStatus = completePipelineStatus(status, false, durationMs, error.message);

    // Add stage info if available
    if (context.stage) {
      finalStatus.stage = context.stage;
    }

    // Use safeWrite to avoid throwing on write failure
    await safeWrite(
      () => writePipelineStatus(join(context.outputDir!, 'pipeline_status.json'), finalStatus),
      'pipeline_status.json'
    );
  }

  return getExitCode(error);
}

// ============================================
// Execution Wrapper
// ============================================

/**
 * Result type for withErrorHandling.
 */
export type ErrorHandlingResult<T> =
  | { success: true; result: T }
  | { success: false; exitCode: ExitCode };

/**
 * Wrap pipeline execution with error handling.
 *
 * This wrapper catches all errors from the pipeline execution,
 * handles them appropriately (logging, status file writing),
 * and returns a structured result.
 *
 * @param fn - Async function to execute
 * @param context - Error context for handling failures
 * @returns Success with result, or failure with exit code
 *
 * @example
 * ```typescript
 * const result = await withErrorHandling(
 *   () => runPipeline(prompt, config),
 *   { config, startTime: Date.now() }
 * );
 *
 * if (!result.success) {
 *   process.exit(result.exitCode);
 * }
 *
 * console.log('Pipeline succeeded:', result.result);
 * ```
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context: ErrorContext
): Promise<ErrorHandlingResult<T>> {
  try {
    const result = await fn();
    return { success: true, result };
  } catch (error) {
    // Ensure we have an Error object
    const err = error instanceof Error ? error : new Error(String(error));

    const exitCode = await handlePipelineError(err, context);
    return { success: false, exitCode };
  }
}

/**
 * Create an error context from common parameters.
 *
 * Convenience helper for creating ErrorContext objects.
 *
 * @param config - Pipeline configuration
 * @param startTime - Pipeline start time
 * @param outputDir - Optional output directory path
 * @param stage - Optional current stage name
 * @returns ErrorContext object
 */
export function createErrorContext(
  config: PipelineConfig,
  startTime: number,
  outputDir?: string,
  stage?: string
): ErrorContext {
  return {
    config,
    startTime,
    outputDir,
    stage,
  };
}
