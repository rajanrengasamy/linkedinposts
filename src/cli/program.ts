/**
 * Commander Program Definition
 *
 * Configures the CLI program with all options from PRD Section 12.
 * This file focuses only on Commander setup - no pipeline execution logic.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { CliOptions } from '../config.js';
import { logWarning } from '../utils/logger.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', '..', 'package.json');

function getVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/**
 * Create and configure the Commander program.
 *
 * @returns Configured Commander program instance
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('linkedin-post-generator')
    .description('Generate LinkedIn posts from web sources with full provenance tracking')
    .version(getVersion(), '-V, --version', 'Show version number')
    .argument('<prompt>', 'Topic or prompt for the post')

    // Source Control
    .option('--sources <list>', 'Comma-separated sources: web,linkedin,x', 'web')

    // Stage Control
    .option('--skip-validation', 'Skip verification stage')
    .option('--skip-scoring', 'Skip Gemini scoring (use heuristics)')
    .option('--skip-image', 'Skip infographic generation')

    // Quality Profiles
    .option('--fast', 'Fast mode: minimal processing (skips validation, scoring, image)')
    .option('--quality <level>', 'Quality level: fast|default|thorough', 'default')

    // Limits
    .option('--max-per-source <n>', 'Max items per source', '25')
    .option('--max-total <n>', 'Max total items', '75')
    .option('--max-results <n>', 'Alias for --max-total')

    // Output
    .option('--output-dir <path>', 'Output directory', './output')
    .option('--save-raw', 'Save raw API responses')
    .option('--image-resolution <res>', 'Image resolution: 2k|4k', '2k')

    // Model Selection
    .option('--scoring-model <model>', 'Scoring model: gemini|kimi2', 'gemini')

    // Prompt Refinement
    .option('--skip-refinement', 'Skip prompt refinement phase')
    .option('--refinement-model <model>',
      'Refinement model: gemini|gpt|claude|kimi2 (default: gemini)',
      'gemini')

    // Multi-Post Generation
    .option('--post-count <n>', 'Number of posts to generate (1-3)', '1')
    .option('--post-style <style>', 'Post style: series|variations', 'variations')

    // Resume from scored data
    .option('--from-scored <path>', 'Resume from scored_data.json, skip collection/validation/scoring')

    // Performance
    .option('--timeout <seconds>', 'Pipeline timeout in seconds', '600')
    .option('--print-cost-estimate', 'Print cost estimate and exit')

    // Debug
    .option('--verbose', 'Show detailed progress')
    .option('--dry-run', 'Validate config and exit without running pipeline')

    // Help customization
    .addHelpText(
      'after',
      `
Examples:
  # Safe mode: web only (recommended)
  $ npx tsx src/index.ts "AI trends in healthcare 2025"

  # Include social sources (use with caution - may violate ToS)
  $ npx tsx src/index.ts "AI trends" --sources web,linkedin,x

  # Fast draft (no validation, no scoring, no image)
  $ npx tsx src/index.ts "AI trends" --fast

  # High quality with 4K image
  $ npx tsx src/index.ts "AI trends" --quality thorough --image-resolution 4k

  # Debug: save everything with verbose output
  $ npx tsx src/index.ts "AI trends" --save-raw --verbose

  # Cost check before running
  $ npx tsx src/index.ts "AI trends" --print-cost-estimate

  # Dry run to validate config
  $ npx tsx src/index.ts "AI trends" --dry-run --verbose

  # Generate 3 post variations for A/B testing
  $ npx tsx src/index.ts "AI trends" --post-count 3

  # Generate 3-part series for deep-dive topic
  $ npx tsx src/index.ts "AI trends" --post-count 3 --post-style series

  # Resume from previous run's scored data
  $ npx tsx src/index.ts "AI trends" --from-scored output/2025-12-30/scored_data.json

Notes:
  - Web-only mode is recommended for commercial/shared use
  - LinkedIn/X sources may violate platform Terms of Service
  - The --fast flag implies --skip-validation --skip-scoring --skip-image
  - All quotes in output include source URLs for provenance
`
    );

  return program;
}

/**
 * Commander options as returned by program.opts().
 *
 * Note: This interface is intentionally NOT exported because:
 * 1. It's a Commander-specific internal type matching program.opts() structure
 * 2. External code should use CliOptions from config.ts (the normalized form)
 * 3. ParsedCliResult provides the proper public API for consuming parsed options
 */
interface CommanderOptions {
  sources?: string;
  skipValidation?: boolean;
  skipScoring?: boolean;
  skipImage?: boolean;
  fast?: boolean;
  quality?: string;
  maxPerSource?: string;
  maxTotal?: string;
  maxResults?: string;
  outputDir?: string;
  saveRaw?: boolean;
  imageResolution?: string;
  scoringModel?: string;
  skipRefinement?: boolean;
  refinementModel?: string;
  postCount?: string;
  postStyle?: string;
  fromScored?: string;
  timeout?: string;
  printCostEstimate?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Result of parsing CLI options
 */
export interface ParsedCliResult {
  prompt: string;
  options: CliOptions;
  printCostEstimate: boolean;
}

/**
 * Validate that Commander options have expected types.
 * This provides runtime type safety for the type assertion below.
 *
 * Note: We don't use Zod here because:
 * 1. Commander already validates option types via its own parsing
 * 2. Invalid options would cause Commander to error before reaching here
 * 3. This function only validates that the structure matches our expectations
 *
 * @param opts - Raw options object from Commander
 * @returns true if options match expected structure
 */
function isValidCommanderOptions(opts: Record<string, unknown>): boolean {
  // All options are optional, so we just verify that any present values
  // have the expected primitive types
  const stringOrUndef = (val: unknown): boolean =>
    val === undefined || typeof val === 'string';
  const boolOrUndef = (val: unknown): boolean =>
    val === undefined || typeof val === 'boolean';

  return (
    stringOrUndef(opts.sources) &&
    boolOrUndef(opts.skipValidation) &&
    boolOrUndef(opts.skipScoring) &&
    boolOrUndef(opts.skipImage) &&
    boolOrUndef(opts.fast) &&
    stringOrUndef(opts.quality) &&
    stringOrUndef(opts.maxPerSource) &&
    stringOrUndef(opts.maxTotal) &&
    stringOrUndef(opts.maxResults) &&
    stringOrUndef(opts.outputDir) &&
    boolOrUndef(opts.saveRaw) &&
    stringOrUndef(opts.imageResolution) &&
    stringOrUndef(opts.scoringModel) &&
    boolOrUndef(opts.skipRefinement) &&
    stringOrUndef(opts.refinementModel) &&
    stringOrUndef(opts.postCount) &&
    stringOrUndef(opts.postStyle) &&
    stringOrUndef(opts.fromScored) &&
    stringOrUndef(opts.timeout) &&
    boolOrUndef(opts.printCostEstimate) &&
    boolOrUndef(opts.verbose) &&
    boolOrUndef(opts.dryRun)
  );
}

/**
 * Parse Commander options to CliOptions interface.
 *
 * Handles the --fast shortcut which implies:
 * - --skip-validation
 * - --skip-scoring
 * - --skip-image
 *
 * @param opts - Raw options from Commander
 * @param prompt - The prompt argument
 * @returns Parsed result with prompt and normalized options
 */
export function parseCliOptions(
  opts: Record<string, unknown>,
  prompt: string
): ParsedCliResult {
  // MIN-6: Validate option structure before type assertion
  if (!isValidCommanderOptions(opts)) {
    logWarning(
      'Unexpected option types detected. Some options may be ignored.'
    );
  }

  const commanderOpts = opts as CommanderOptions;

  // Handle --fast shortcut
  const isFastMode = commanderOpts.fast === true;

  // MAJ-7: Warn about conflicting quality options
  if (
    isFastMode &&
    commanderOpts.quality !== undefined &&
    commanderOpts.quality !== 'fast'
  ) {
    logWarning(
      `Conflicting options: --fast overrides --quality ${commanderOpts.quality}. Using fast mode.`
    );
  }

  const options: CliOptions = {
    sources: commanderOpts.sources,
    skipValidation: isFastMode || commanderOpts.skipValidation,
    skipScoring: isFastMode || commanderOpts.skipScoring,
    skipImage: isFastMode || commanderOpts.skipImage,
    fast: commanderOpts.fast,
    quality: isFastMode ? 'fast' : commanderOpts.quality,
    maxPerSource: commanderOpts.maxPerSource,
    maxTotal: commanderOpts.maxTotal,
    maxResults: commanderOpts.maxResults,
    outputDir: commanderOpts.outputDir,
    saveRaw: commanderOpts.saveRaw,
    imageResolution: commanderOpts.imageResolution,
    scoringModel: commanderOpts.scoringModel,
    skipRefinement: commanderOpts.skipRefinement,
    refinementModel: commanderOpts.refinementModel,
    postCount: commanderOpts.postCount,
    postStyle: commanderOpts.postStyle,
    fromScored: commanderOpts.fromScored,
    timeout: commanderOpts.timeout,
    verbose: commanderOpts.verbose,
    dryRun: commanderOpts.dryRun,
  };

  return {
    prompt,
    options,
    printCostEstimate: commanderOpts.printCostEstimate === true,
  };
}
