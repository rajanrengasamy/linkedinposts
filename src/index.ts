#!/usr/bin/env node
/**
 * LinkedIn Post Generator CLI
 *
 * Main entry point for the CLI application.
 * Parses arguments, validates configuration, and runs the pipeline.
 *
 * Usage:
 *   npx tsx src/index.ts <prompt> [options]
 *
 * @see docs/PRD-v2.md Section 12 - CLI Interface
 */

import { CommanderError } from 'commander';
import {
  createProgram,
  parseCliOptions,
  runPreflightChecks,
  runPipeline,
  withErrorHandling,
  EXIT_CODES,
} from './cli/index.js';
import { buildConfig } from './config.js';
import { setVerbose, logError, logVerbose, sanitize } from './utils/logger.js';
import { withTimeout } from './utils/retry.js';
import { ensureOutputDir } from './utils/fileWriter.js';

// ============================================
// Main Entry Point
// ============================================

/**
 * Main CLI entry point.
 *
 * Flow:
 * 1. Parse CLI arguments with Commander
 * 2. Build configuration from options
 * 3. Run pre-flight checks (API keys, cost estimate, dry-run)
 * 4. Execute pipeline with error handling
 * 5. Exit with appropriate code
 */
async function main(): Promise<void> {
  // Create Commander program
  const program = createProgram();

  // Configure Commander to throw errors instead of calling process.exit directly
  // This allows us to catch parsing errors and exit with our CONFIG_ERROR code
  program.exitOverride();

  let opts: ReturnType<typeof program.opts>;
  let args: string[];

  try {
    program.parse(process.argv);
    opts = program.opts();
    args = program.args;
  } catch (error) {
    // MAJ-6: Handle Commander parsing failures with proper exit code
    if (error instanceof CommanderError) {
      // Commander already printed the error message
      // Exit with CONFIG_ERROR instead of Commander's default exit code
      process.exit(EXIT_CODES.CONFIG_ERROR);
    }
    throw error;
  }

  // MAJ-5 & CODEX-4: Validate prompt is non-empty string
  // Use outputHelp() instead of help() so we can control the exit code
  if (args.length === 0 || !args[0] || args[0].trim().length === 0) {
    logError('Error: Prompt cannot be empty');
    program.outputHelp();
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }

  // Parse CLI options
  const { prompt, options, printCostEstimate } = parseCliOptions(opts, args[0]);

  // Build configuration from parsed options
  const config = buildConfig(options);

  // Set verbose mode early for pre-flight logging
  setVerbose(config.verbose);

  // Run pre-flight checks
  const preflight = runPreflightChecks(config, {
    printCostEstimate,
    dryRun: config.dryRun,
  });

  // Exit if pre-flight checks indicate we should not continue
  // Note: If shouldContinue is false, preflight already logged the reason
  // (missing API keys, dry-run summary, or cost estimate)
  if (!preflight.shouldContinue) {
    process.exit(preflight.exitCode ?? EXIT_CODES.SUCCESS);
  }

  // At this point, API keys are guaranteed valid (preflight.shouldContinue
  // is only true when apiKeyValidation.valid is true - see preflight.ts)

  // CRIT-2: Create output directory BEFORE pipeline execution
  // This ensures the error handler can write pipeline_status.json with error details
  // even if the pipeline fails partway through
  const outputDir = await ensureOutputDir(config.outputDir);
  logVerbose(`Pre-created output directory: ${outputDir}`);

  const startTime = Date.now();
  const timeoutMs = config.timeoutSeconds * 1000;

  // Run pipeline with error handling and global timeout (CRIT-1)
  // The timeout enforces config.timeoutSeconds at the pipeline level
  const result = await withErrorHandling(
    () =>
      withTimeout(
        () => runPipeline(prompt, config, { outputDir }),
        timeoutMs,
        'Pipeline execution'
      ),
    { config, startTime, outputDir }
  );

  // Exit based on result
  if (result.success) {
    process.exit(EXIT_CODES.SUCCESS);
  } else {
    process.exit(result.exitCode);
  }
}

// ============================================
// Execution
// ============================================

// Run main and catch any unhandled errors
main().catch((error: unknown) => {
  // SECURITY (MAJ-4): Only log sanitized error message, not full stack trace.
  // Stack traces may expose internal paths, API keys, or other sensitive data.
  // This should only be reached for truly unexpected errors
  // (e.g., bugs in error handling itself)
  const errorMessage =
    error instanceof Error ? error.message : 'An unexpected error occurred';
  console.error('Unexpected error:', sanitize(errorMessage));
  process.exit(EXIT_CODES.PIPELINE_ERROR);
});
