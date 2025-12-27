/**
 * Logger with Secrets Sanitization
 *
 * All logging functions sanitize output to prevent API key leakage.
 * Supports verbose mode for detailed debugging output.
 */

import chalk from 'chalk';
import type { CostBreakdown } from '../schemas/index.js';
import { ENV_KEYS } from '../config.js';

// ============================================
// Logger State
// ============================================

/**
 * Global verbose mode flag.
 * Set via setVerbose() before running pipeline.
 */
let verboseMode = false;

/**
 * Enable or disable verbose logging
 */
export function setVerbose(enabled: boolean): void {
  verboseMode = enabled;
}

/**
 * Check if verbose mode is enabled
 */
export function isVerbose(): boolean {
  return verboseMode;
}

// ============================================
// Secrets Sanitization
// ============================================

/**
 * Patterns that look like API keys (to catch unknown keys)
 * Matches strings that look like: sk-xxx, key-xxx, or long hex/base64 strings
 */
const API_KEY_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI style
  /pplx-[a-zA-Z0-9]{20,}/g, // Perplexity style
  /AIza[a-zA-Z0-9_-]{30,}/g, // Google style
  /[a-f0-9]{32,}/gi, // Long hex strings (potential keys)
];

/**
 * Sanitize text to remove API keys and sensitive data.
 *
 * SECURITY: This function MUST be called before any console output.
 * It removes:
 * 1. Known API keys from environment variables
 * 2. Patterns that look like API keys
 *
 * @param text - Text to sanitize
 * @returns Sanitized text with keys replaced by [REDACTED]
 */
export function sanitize(text: string): string {
  let sanitized = text;

  // Remove known API keys from environment
  for (const envKey of Object.values(ENV_KEYS)) {
    const keyValue = process.env[envKey];
    if (keyValue && keyValue.length > 0) {
      // Use global replace for all occurrences
      sanitized = sanitized.split(keyValue).join('[REDACTED]');
    }
  }

  // Remove patterns that look like API keys
  for (const pattern of API_KEY_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized;
}

// ============================================
// Timestamp Formatting
// ============================================

/**
 * Get current timestamp in HH:MM:SS format
 */
function timestamp(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

// ============================================
// Logging Functions
// ============================================

/**
 * Log a stage header with timestamp.
 * Used to mark the start of pipeline stages.
 *
 * @param name - Stage name (e.g., "Data Collection", "Validation")
 */
export function logStage(name: string): void {
  const line = '─'.repeat(50);
  console.log('');
  console.log(chalk.cyan(line));
  console.log(chalk.cyan.bold(`  ${sanitize(name)}`));
  console.log(chalk.cyan(`  ${timestamp()}`));
  console.log(chalk.cyan(line));
}

/**
 * Log progress indicator.
 * Shows current/total and optional message.
 *
 * Handles edge cases:
 * - total <= 0: Shows "0/0" without progress bar to prevent divide-by-zero
 * - current > total: Clamps percentage to 100%
 *
 * @param current - Current item number
 * @param total - Total items
 * @param message - Optional progress message
 */
export function logProgress(current: number, total: number, message?: string): void {
  const msg = message ? ` ${sanitize(message)}` : '';

  // Guard against divide-by-zero: when total is 0 or negative, show simple message
  if (total <= 0) {
    console.log(chalk.gray(`  [${' '.repeat(20)}] ${current}/${total}${msg}`));
    return;
  }

  // Clamp percent to 0-100 range to handle edge cases
  const percent = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  const filled = Math.floor(percent / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  console.log(chalk.gray(`  [${bar}] ${current}/${total} (${percent}%)${msg}`));
}

/**
 * Log success message in green.
 *
 * @param message - Success message
 */
export function logSuccess(message: string): void {
  console.log(chalk.green(`✓ ${sanitize(message)}`));
}

/**
 * Log warning message in yellow.
 *
 * @param message - Warning message
 */
export function logWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${sanitize(message)}`));
}

/**
 * Log error message in red.
 *
 * @param message - Error message
 */
export function logError(message: string): void {
  console.log(chalk.red(`✗ ${sanitize(message)}`));
}

/**
 * Log info message (default color).
 *
 * @param message - Info message
 */
export function logInfo(message: string): void {
  console.log(chalk.white(`  ${sanitize(message)}`));
}

/**
 * Log verbose message (only if verbose mode enabled).
 *
 * @param message - Verbose debug message
 */
export function logVerbose(message: string): void {
  if (verboseMode) {
    console.log(chalk.gray(`  [verbose] ${sanitize(message)}`));
  }
}

/**
 * Log cost breakdown in formatted table.
 *
 * @param costs - Cost breakdown by service
 */
export function logCost(costs: CostBreakdown): void {
  console.log('');
  console.log(chalk.cyan.bold('  Cost Breakdown:'));
  console.log(chalk.gray('  ─────────────────────────────'));

  const formatCost = (value: number) => `$${value.toFixed(4)}`;

  if (costs.perplexity > 0) {
    console.log(chalk.white(`  Perplexity:    ${formatCost(costs.perplexity)}`));
  }
  if (costs.gemini > 0) {
    console.log(chalk.white(`  Gemini:        ${formatCost(costs.gemini)}`));
  }
  if (costs.openai > 0) {
    console.log(chalk.white(`  OpenAI:        ${formatCost(costs.openai)}`));
  }
  if (costs.nanoBanana > 0) {
    console.log(chalk.white(`  Nano Banana:   ${formatCost(costs.nanoBanana)}`));
  }

  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(chalk.cyan.bold(`  Total:         ${formatCost(costs.total)}`));
  console.log('');
}

/**
 * Log a horizontal divider line
 */
export function logDivider(): void {
  console.log(chalk.gray('─'.repeat(50)));
}

/**
 * Log an empty line
 */
export function logNewline(): void {
  console.log('');
}

// ============================================
// Specialized Logging
// ============================================

/**
 * Log API key validation result
 */
export function logApiKeyStatus(valid: boolean, missing: string[], warnings: string[]): void {
  if (valid) {
    logSuccess('All required API keys configured');
  } else {
    logError('Missing required API keys:');
    for (const key of missing) {
      console.log(chalk.red(`  • ${key}`));
    }
  }

  for (const warning of warnings) {
    logWarning(warning);
  }
}

/**
 * Log pipeline configuration summary
 */
export function logConfig(config: {
  sources: string[];
  qualityProfile: string;
  maxTotal: number;
  skipValidation: boolean;
  skipScoring: boolean;
  skipImage: boolean;
}): void {
  console.log('');
  console.log(chalk.cyan.bold('  Pipeline Configuration:'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(chalk.white(`  Sources:       ${config.sources.join(', ')}`));
  console.log(chalk.white(`  Quality:       ${config.qualityProfile}`));
  console.log(chalk.white(`  Max Items:     ${config.maxTotal}`));

  const skipped: string[] = [];
  if (config.skipValidation) skipped.push('validation');
  if (config.skipScoring) skipped.push('scoring');
  if (config.skipImage) skipped.push('image');

  if (skipped.length > 0) {
    console.log(chalk.yellow(`  Skipping:      ${skipped.join(', ')}`));
  }
  console.log('');
}

/**
 * Log final pipeline result
 */
export function logPipelineResult(
  success: boolean,
  durationMs: number,
  outputDir: string,
  error?: string
): void {
  console.log('');
  logDivider();

  if (success) {
    logSuccess(`Pipeline completed in ${formatDuration(durationMs)}`);
    console.log(chalk.green(`  Output: ${sanitize(outputDir)}`));
  } else {
    logError(`Pipeline failed after ${formatDuration(durationMs)}`);
    if (error) {
      console.log(chalk.red(`  Error: ${sanitize(error)}`));
    }
  }

  logDivider();
  console.log('');
}
