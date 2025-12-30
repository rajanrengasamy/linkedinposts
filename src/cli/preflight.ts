/**
 * Pre-flight Checks
 *
 * Validates configuration and API keys before pipeline execution.
 * Supports --dry-run and --print-cost-estimate modes for validation-only runs.
 */

import type { PipelineConfig } from '../types/index.js';
import type { ApiKeyValidationResult } from '../config.js';
import { validateApiKeys } from '../config.js';
import { estimateCost } from '../utils/cost.js';
import {
  logApiKeyStatus,
  logConfig,
  logCost,
  logWarning,
  logError,
  logInfo,
  logSuccess,
  logNewline,
} from '../utils/logger.js';

// ============================================
// Types
// ============================================

/**
 * Result of pre-flight checks.
 */
export interface PreflightResult {
  /** Whether to continue with pipeline execution */
  shouldContinue: boolean;
  /** Exit code if shouldContinue is false (0 = success exit, 1 = error exit) */
  exitCode?: number;
  /** API key validation result */
  apiKeyValidation: ApiKeyValidationResult;
}

/**
 * CLI options relevant to pre-flight checks
 */
export interface PreflightOptions {
  /** Print cost estimate and exit */
  printCostEstimate?: boolean;
  /** Validate config and exit without running */
  dryRun?: boolean;
}

// ============================================
// Pre-flight Functions
// ============================================

/**
 * Run pre-flight checks before pipeline execution.
 *
 * Handles:
 * - API key validation (always)
 * - --print-cost-estimate (print and exit with code 0)
 * - --dry-run (validate and exit with code 0)
 *
 * @param config - Resolved pipeline configuration
 * @param options - CLI options for checking modes
 * @returns PreflightResult indicating whether to continue
 */
export function runPreflightChecks(
  config: PipelineConfig,
  options: PreflightOptions
): PreflightResult {
  // Step 1: Always validate API keys first
  const apiKeyValidation = validateApiKeys(config.sources);

  // Log API key status
  logApiKeyStatus(apiKeyValidation.valid, apiKeyValidation.missing, apiKeyValidation.warnings);

  // Fail fast if required keys are missing
  if (!apiKeyValidation.valid) {
    logNewline();
    logError('Cannot proceed without required API keys.');
    logInfo('Please set the missing keys in your .env file or environment.');
    logInfo('See .env.example for reference.');

    return {
      shouldContinue: false,
      exitCode: 1,
      apiKeyValidation,
    };
  }

  // MIN-3: Warn if both flags are provided (only --print-cost-estimate will run)
  if (options.printCostEstimate && options.dryRun) {
    logWarning(
      'Both --print-cost-estimate and --dry-run provided. ' +
        'Only --print-cost-estimate will be executed.'
    );
  }

  // Step 2: Handle --print-cost-estimate mode
  if (options.printCostEstimate) {
    printCostEstimate(config);

    return {
      shouldContinue: false,
      exitCode: 0,
      apiKeyValidation,
    };
  }

  // Step 3: Handle --dry-run mode
  if (options.dryRun) {
    printDryRunSummary(config);

    return {
      shouldContinue: false,
      exitCode: 0,
      apiKeyValidation,
    };
  }

  // All checks passed, continue with pipeline
  return {
    shouldContinue: true,
    apiKeyValidation,
  };
}

/**
 * Print cost estimate and configuration summary.
 *
 * Used when --print-cost-estimate flag is provided.
 * Shows estimated costs for each API service based on configuration.
 *
 * @param config - Pipeline configuration
 */
export function printCostEstimate(config: PipelineConfig): void {
  logNewline();
  logInfo('Cost Estimate Mode');
  logNewline();

  // Show configuration that affects cost
  logConfig({
    sources: config.sources,
    qualityProfile: config.qualityProfile,
    maxTotal: config.maxTotal,
    skipValidation: config.skipValidation,
    skipScoring: config.skipScoring,
    skipImage: config.skipImage,
  });

  // Calculate and display cost breakdown
  const costs = estimateCost(config);
  logCost(costs);

  // Add disclaimer about estimates
  logWarning('Cost estimates are approximate and may vary based on actual API usage.');
  logNewline();
}

/**
 * Print dry-run summary (config validation only).
 *
 * Used when --dry-run flag is provided.
 * Validates configuration and shows what would be executed.
 *
 * @param config - Pipeline configuration
 */
export function printDryRunSummary(config: PipelineConfig): void {
  logNewline();
  logInfo('Dry Run Mode - Validating configuration only');
  logNewline();

  // Show full configuration summary
  logConfig({
    sources: config.sources,
    qualityProfile: config.qualityProfile,
    maxTotal: config.maxTotal,
    skipValidation: config.skipValidation,
    skipScoring: config.skipScoring,
    skipImage: config.skipImage,
  });

  // Show additional configuration details
  logInfo('Additional Settings:');
  logInfo(`  Output directory: ${config.outputDir}`);
  logInfo(`  Image resolution: ${config.imageResolution}`);
  logInfo(`  Timeout: ${config.timeoutSeconds}s`);
  logInfo(`  Save raw responses: ${config.saveRaw}`);
  logInfo(`  Verbose logging: ${config.verbose}`);
  logNewline();

  // Show cost estimate in dry-run as well
  const costs = estimateCost(config);
  logCost(costs);

  logSuccess('Configuration is valid. Ready to run pipeline.');
  logNewline();
}

/**
 * Validate API keys only (without other pre-flight checks).
 *
 * Utility function for cases where only API key validation is needed.
 *
 * @param config - Pipeline configuration
 * @returns API key validation result
 */
export function validateApiKeysOnly(config: PipelineConfig): ApiKeyValidationResult {
  return validateApiKeys(config.sources);
}
