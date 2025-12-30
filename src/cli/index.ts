/**
 * CLI Module Exports
 *
 * Barrel export for all CLI components.
 * This is the main entry point for importing CLI functionality.
 *
 * @see docs/PRD-v2.md Section 12 - CLI Interface
 */

// ============================================
// Program Configuration (Section 12.1)
// ============================================

export {
  // Main program creation
  createProgram,
  // Option parsing
  parseCliOptions,
  // Types
  type ParsedCliResult,
} from './program.js';

// ============================================
// Pre-flight Checks (Section 12.3)
// ============================================

export {
  // Main pre-flight function
  runPreflightChecks,
  // Utility functions
  printCostEstimate,
  printDryRunSummary,
  validateApiKeysOnly,
  // Types
  type PreflightResult,
  type PreflightOptions,
} from './preflight.js';

// ============================================
// Pipeline Execution (Section 12.4)
// ============================================

export {
  // Main pipeline function
  runPipeline,
  // Types
  type PipelineOptions,
} from './runPipeline.js';

// ============================================
// Error Handling (Section 12.5)
// ============================================

export {
  // Error handling wrapper
  withErrorHandling,
  // Error handler
  handlePipelineError,
  // Exit codes
  EXIT_CODES,
  // Error classification
  isConfigError,
  getExitCode,
  // Status helpers
  createPipelineStatus,
  completePipelineStatus,
  updatePipelineStage,
  createErrorContext,
  // Types
  type ExitCode,
  type ErrorContext,
  type ErrorHandlingResult,
} from './errorHandler.js';
