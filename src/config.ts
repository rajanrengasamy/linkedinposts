/**
 * Configuration & Environment Variables
 *
 * Handles environment loading, API key validation, and configuration
 * merging with quality profiles.
 */

import 'dotenv/config';
import type { PipelineConfig, SourceOption, QualityProfile, ScoringModel } from './types/index.js';
import type { RefinementModel, RefinementConfig } from './refinement/types.js';
import type { SynthesisModel } from './synthesis/types.js';
import { SYNTHESIS_MODELS } from './synthesis/types.js';
import {
  DEFAULT_CONFIG,
  QUALITY_PROFILES,
  API_CONCURRENCY_LIMITS,
  STAGE_TIMEOUT_MS,
} from './types/index.js';
import { DEFAULT_REFINEMENT_CONFIG, REFINEMENT_MODELS } from './refinement/types.js';
import { logWarning } from './utils/logger.js';

// ============================================
// Environment Variable Names
// ============================================

/**
 * Environment variable names for API keys
 */
export const ENV_KEYS = {
  PERPLEXITY_API_KEY: 'PERPLEXITY_API_KEY',
  GOOGLE_AI_API_KEY: 'GOOGLE_AI_API_KEY',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  SCRAPECREATORS_API_KEY: 'SCRAPECREATORS_API_KEY',
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
} as const;

/**
 * API keys that are always required (web-only mode)
 */
const REQUIRED_KEYS: (keyof typeof ENV_KEYS)[] = [
  'PERPLEXITY_API_KEY',
  'GOOGLE_AI_API_KEY',
  'OPENAI_API_KEY',
];

/**
 * API keys required for social sources (LinkedIn/X)
 */
const SOCIAL_SOURCE_KEYS: (keyof typeof ENV_KEYS)[] = ['SCRAPECREATORS_API_KEY'];

// ============================================
// API Key Access (Sanitized)
// ============================================

/**
 * Get an API key from environment.
 * SECURITY: Keys are retrieved but never logged.
 *
 * @param key - The environment variable name
 * @returns The API key value or undefined
 */
export function getApiKey(key: keyof typeof ENV_KEYS): string | undefined {
  return process.env[ENV_KEYS[key]];
}

/**
 * Check if an API key is set (non-empty)
 */
export function hasApiKey(key: keyof typeof ENV_KEYS): boolean {
  const value = getApiKey(key);
  return value !== undefined && value.trim().length > 0;
}

// ============================================
// Validation
// ============================================

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Options for API key validation
 */
export interface ValidateApiKeysOptions {
  sources: SourceOption[];
  scoringModel?: ScoringModel;
  refinementModel?: RefinementModel;
  synthesisModel?: SynthesisModel;
}

/**
 * Validate that all required API keys are present based on sources and config.
 *
 * Required keys:
 * - PERPLEXITY_API_KEY (always)
 * - GOOGLE_AI_API_KEY (always, unless scoringModel is 'kimi2' and skipScoring isn't relevant here)
 * - OPENAI_API_KEY (always)
 * - SCRAPECREATORS_API_KEY (only if linkedin or x sources enabled)
 * - OPENROUTER_API_KEY (only if scoringModel is 'kimi2')
 *
 * @param options - Validation options with sources and optional scoringModel
 * @returns Validation result with missing keys
 */
export function validateApiKeys(options: SourceOption[] | ValidateApiKeysOptions): ApiKeyValidationResult {
  // Handle both old (array) and new (object) signatures for backward compatibility
  const sources = Array.isArray(options) ? options : options.sources;
  const scoringModel = Array.isArray(options) ? 'gemini' : (options.scoringModel ?? 'gemini');

  const missing: string[] = [];
  const warnings: string[] = [];

  // Check always-required keys
  for (const key of REQUIRED_KEYS) {
    // Skip GOOGLE_AI_API_KEY check if using kimi2 for scoring
    if (key === 'GOOGLE_AI_API_KEY' && scoringModel === 'kimi2') {
      continue;
    }
    if (!hasApiKey(key)) {
      missing.push(ENV_KEYS[key]);
    }
  }

  // Check social source keys if needed
  const needsSocialKey = sources.includes('linkedin') || sources.includes('x');
  if (needsSocialKey) {
    for (const key of SOCIAL_SOURCE_KEYS) {
      if (!hasApiKey(key)) {
        missing.push(ENV_KEYS[key]);
      }
    }

    // Add compliance warning for social sources
    warnings.push(
      'Using LinkedIn/X sources may violate platform Terms of Service. ' +
        'Use at your own risk. Recommended for personal use only.'
    );
  }

  // Check OpenRouter key if using kimi2 scoring model
  if (scoringModel === 'kimi2') {
    if (!hasApiKey('OPENROUTER_API_KEY')) {
      missing.push(ENV_KEYS.OPENROUTER_API_KEY);
    }
  }

  // Check Anthropic key if using claude for refinement
  const refinementModel = Array.isArray(options) ? undefined : options.refinementModel;
  if (refinementModel === 'claude') {
    if (!hasApiKey('ANTHROPIC_API_KEY')) {
      missing.push(ENV_KEYS.ANTHROPIC_API_KEY);
    }
  }

  // Check OpenRouter key if using kimi2 for refinement (and not already checked for scoring)
  if (refinementModel === 'kimi2' && scoringModel !== 'kimi2') {
    if (!hasApiKey('OPENROUTER_API_KEY')) {
      missing.push(ENV_KEYS.OPENROUTER_API_KEY);
    }
  }

  // Check for synthesis model API keys
  const synthesisModel = Array.isArray(options) ? 'gpt' : (options.synthesisModel ?? 'gpt');

  // Claude synthesis requires ANTHROPIC_API_KEY (only add if not already checked for refinement)
  if (synthesisModel === 'claude' && refinementModel !== 'claude') {
    if (!hasApiKey('ANTHROPIC_API_KEY')) {
      missing.push(ENV_KEYS.ANTHROPIC_API_KEY);
    }
  }

  // Kimi2 synthesis requires OPENROUTER_API_KEY (only add if not already checked)
  if (synthesisModel === 'kimi2' && scoringModel !== 'kimi2' && refinementModel !== 'kimi2') {
    if (!hasApiKey('OPENROUTER_API_KEY')) {
      missing.push(ENV_KEYS.OPENROUTER_API_KEY);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Validate API keys and throw if any are missing.
 * Fail-fast behavior for CLI startup.
 *
 * @param options - Validation options (sources array or full options object)
 * @throws Error with clear message listing missing keys
 */
export function requireApiKeys(options: SourceOption[] | ValidateApiKeysOptions): void {
  const result = validateApiKeys(options);

  if (!result.valid) {
    const keyList = result.missing.join(', ');
    throw new Error(
      `Missing required API keys: ${keyList}\n` +
        `Please set these in your .env file or environment.\n` +
        `See .env.example for reference.`
    );
  }
}

// ============================================
// Configuration Building
// ============================================

/**
 * CLI options that can be parsed from command line
 */
export interface CliOptions {
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
  synthesisModel?: string;
  skipRefinement?: boolean;
  refinementModel?: string;
  postCount?: string;
  postStyle?: string;
  fromScored?: string;
  timeout?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Parse sources string into array of SourceOption.
 * CODEX-3: Warns about invalid source tokens.
 */
function parseSources(sourcesStr: string): SourceOption[] {
  const valid: SourceOption[] = ['web', 'linkedin', 'x'];
  const tokens = sourcesStr.split(',').map((s) => s.trim().toLowerCase());

  // CODEX-3: Identify and warn about invalid tokens
  const invalidTokens = tokens.filter(
    (s) => s.length > 0 && !valid.includes(s as SourceOption)
  );
  if (invalidTokens.length > 0) {
    logWarning(
      `Invalid source(s) ignored: ${invalidTokens.join(', ')}. Valid options: web, linkedin, x`
    );
  }

  const sources = tokens.filter((s) => valid.includes(s as SourceOption)) as SourceOption[];

  // Ensure at least 'web' is included
  if (!sources.includes('web')) {
    if (tokens.length > 0 && tokens[0].length > 0) {
      // User specified sources but none were valid or 'web' was not included
      logWarning("'web' source automatically added (required).");
    }
    sources.unshift('web');
  }

  return sources;
}

/**
 * Parse quality profile string.
 * CODEX-3: Warns about invalid quality profile values.
 */
function parseQualityProfile(profileStr: string): QualityProfile {
  const valid: QualityProfile[] = ['fast', 'default', 'thorough'];
  const profile = profileStr.toLowerCase() as QualityProfile;
  if (!valid.includes(profile)) {
    logWarning(
      `Invalid quality profile '${profileStr}' ignored. Using 'default'. Valid options: fast, default, thorough`
    );
    return 'default';
  }
  return profile;
}

/**
 * Parse image resolution string.
 * CODEX-3: Warns about invalid image resolution values.
 */
function parseImageResolution(resStr: string): '2k' | '4k' {
  const normalized = resStr.toLowerCase();
  if (normalized !== '2k' && normalized !== '4k') {
    logWarning(
      `Invalid image resolution '${resStr}' ignored. Using '2k'. Valid options: 2k, 4k`
    );
    return '2k';
  }
  return normalized as '2k' | '4k';
}

/**
 * Parse scoring model string.
 * Warns about invalid scoring model values and defaults to 'gemini'.
 */
function parseScoringModel(modelStr: string): ScoringModel {
  const normalized = modelStr.toLowerCase();
  if (normalized !== 'gemini' && normalized !== 'kimi2') {
    logWarning(
      `Invalid scoring model '${modelStr}' ignored. Using 'gemini'. Valid options: gemini, kimi2`
    );
    return 'gemini';
  }
  return normalized as ScoringModel;
}

/**
 * Parse refinement model from string, defaulting to 'gemini'.
 * Warns about invalid refinement model values.
 *
 * @param modelStr - Model string from CLI option
 * @returns Valid RefinementModel
 */
export function parseRefinementModel(modelStr: string | undefined): RefinementModel {
  if (!modelStr) return 'gemini';
  const model = modelStr.toLowerCase();
  if (REFINEMENT_MODELS.includes(model as RefinementModel)) {
    return model as RefinementModel;
  }
  logWarning(
    `Invalid refinement model '${modelStr}' ignored. Using 'gemini'. Valid options: ${REFINEMENT_MODELS.join(', ')}`
  );
  return 'gemini';
}

/**
 * Parse synthesis model from string, defaulting to 'gpt'.
 * Warns about invalid synthesis model values.
 *
 * MAJ-10: Fixed type assertion - now validates model is in SYNTHESIS_MODELS array
 * before asserting the type, using readonly string[] comparison.
 *
 * @param modelStr - Model string from CLI option
 * @returns Valid SynthesisModel
 */
export function parseSynthesisModel(modelStr: string | undefined): SynthesisModel {
  if (!modelStr) return 'gpt';
  const model = modelStr.toLowerCase();
  // MAJ-10: Cast SYNTHESIS_MODELS to readonly string[] for safe comparison
  if ((SYNTHESIS_MODELS as readonly string[]).includes(model)) {
    return model as SynthesisModel;
  }
  logWarning(
    `Invalid synthesis model '${modelStr}' ignored. Using 'gpt'. Valid options: ${SYNTHESIS_MODELS.join(', ')}`
  );
  return 'gpt';
}

/**
 * Build a complete PipelineConfig from CLI options.
 *
 * Merging order (later overrides earlier):
 * 1. DEFAULT_CONFIG
 * 2. Quality profile overrides
 * 3. Explicit CLI options
 *
 * @param options - Parsed CLI options
 * @returns Complete, resolved PipelineConfig
 */
export function buildConfig(options: CliOptions): PipelineConfig {
  // Start with defaults
  let config: PipelineConfig = { ...DEFAULT_CONFIG };

  // Handle --fast shortcut (implies quality: 'fast')
  const qualityProfile = options.fast
    ? 'fast'
    : options.quality
      ? parseQualityProfile(options.quality)
      : 'default';

  // Apply quality profile overrides
  const profileOverrides = QUALITY_PROFILES[qualityProfile];
  config = { ...config, ...profileOverrides, qualityProfile };

  // Apply explicit CLI options (these override profile)
  if (options.sources !== undefined) {
    config.sources = parseSources(options.sources);
  }

  if (options.skipValidation !== undefined) {
    config.skipValidation = options.skipValidation;
  }

  if (options.skipScoring !== undefined) {
    config.skipScoring = options.skipScoring;
  }

  if (options.skipImage !== undefined) {
    config.skipImage = options.skipImage;
  }

  if (options.maxPerSource !== undefined) {
    const parsed = parseInt(options.maxPerSource, 10);
    if (!isNaN(parsed) && parsed > 0) {
      config.maxPerSource = parsed;
    }
  }

  // --max-results is alias for --max-total
  const maxTotalStr = options.maxTotal ?? options.maxResults;
  if (maxTotalStr !== undefined) {
    const parsed = parseInt(maxTotalStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      config.maxTotal = parsed;
    }
  }

  if (options.outputDir !== undefined) {
    config.outputDir = options.outputDir;
  }

  if (options.saveRaw !== undefined) {
    config.saveRaw = options.saveRaw;
  }

  if (options.imageResolution !== undefined) {
    config.imageResolution = parseImageResolution(options.imageResolution);
  }

  if (options.scoringModel !== undefined) {
    config.scoringModel = parseScoringModel(options.scoringModel);
  }

  if (options.synthesisModel !== undefined) {
    config.synthesisModel = parseSynthesisModel(options.synthesisModel);
  }

  // Build refinement config
  const refinement: RefinementConfig = {
    skip: options.skipRefinement ?? DEFAULT_REFINEMENT_CONFIG.skip,
    model: parseRefinementModel(options.refinementModel),
    maxIterations: DEFAULT_REFINEMENT_CONFIG.maxIterations,
    timeoutMs: DEFAULT_REFINEMENT_CONFIG.timeoutMs,
  };
  config.refinement = refinement;

  // Parse multi-post options
  const postCount = parsePostCount(options.postCount);
  const postStyle = parsePostStyle(options.postStyle);
  config.postCount = postCount;
  config.postStyle = postStyle;

  // Resume from scored data (skips collection/validation/scoring)
  if (options.fromScored !== undefined) {
    config.fromScored = options.fromScored;
  }

  if (options.timeout !== undefined) {
    const parsed = parseInt(options.timeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      config.timeoutSeconds = parsed;
    }
  }

  if (options.verbose !== undefined) {
    config.verbose = options.verbose;
  }

  if (options.dryRun !== undefined) {
    config.dryRun = options.dryRun;
  }

  // MIN-2: Validate maxPerSource vs maxTotal relationship
  const numSources = config.sources.length;
  const maxPossible = config.maxPerSource * numSources;
  if (maxPossible < config.maxTotal) {
    logWarning(
      `maxPerSource (${config.maxPerSource}) * sources (${numSources}) = ${maxPossible} ` +
        `is less than maxTotal (${config.maxTotal}). Effective max will be ${maxPossible}.`
    );
  }

  // MIN-4: Warn when numeric values fall back to defaults
  if (options.maxPerSource !== undefined) {
    const parsed = parseInt(options.maxPerSource, 10);
    if (isNaN(parsed) || parsed <= 0) {
      logWarning(
        `Invalid --max-per-source value '${options.maxPerSource}'. Using default: ${config.maxPerSource}`
      );
    }
  }

  const maxTotalInput = options.maxTotal ?? options.maxResults;
  if (maxTotalInput !== undefined) {
    const parsed = parseInt(maxTotalInput, 10);
    if (isNaN(parsed) || parsed <= 0) {
      logWarning(
        `Invalid --max-total value '${maxTotalInput}'. Using default: ${config.maxTotal}`
      );
    }
  }

  if (options.timeout !== undefined) {
    const parsed = parseInt(options.timeout, 10);
    if (isNaN(parsed) || parsed <= 0) {
      logWarning(
        `Invalid --timeout value '${options.timeout}'. Using default: ${config.timeoutSeconds}`
      );
    }
  }

  return config;
}

/**
 * Validate a complete config and check API keys.
 * Returns validation result without throwing.
 */
export function validateConfig(config: PipelineConfig): ApiKeyValidationResult {
  return validateApiKeys({
    sources: config.sources,
    scoringModel: config.scoringModel,
    refinementModel: config.refinement?.model,
    synthesisModel: config.synthesisModel,
  });
}

/**
 * Validate config and throw if invalid.
 * Use this for fail-fast CLI behavior.
 */
export function requireValidConfig(config: PipelineConfig): void {
  requireApiKeys({
    sources: config.sources,
    scoringModel: config.scoringModel,
    refinementModel: config.refinement?.model,
    synthesisModel: config.synthesisModel,
  });
}

// ============================================
// Re-exports for convenience
// ============================================

export {
  DEFAULT_CONFIG,
  QUALITY_PROFILES,
  API_CONCURRENCY_LIMITS,
  STAGE_TIMEOUT_MS,
} from './types/index.js';

export type { PipelineConfig, QualityProfile, SourceOption, ScoringModel, PostStyle } from './types/index.js';

// ============================================
// Multi-Post Parsing Functions
// ============================================

/**
 * Parse post count from CLI option.
 * Valid range: 1-3. Invalid values default to 1.
 *
 * @param countStr - String value from CLI (e.g., '2')
 * @returns Parsed post count (1-3)
 */
export function parsePostCount(countStr: string | undefined): number {
  if (countStr === undefined) {
    return 1;
  }

  const parsed = parseInt(countStr, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 3) {
    logWarning(
      `Invalid --post-count value '${countStr}'. Using default: 1. Valid range: 1-3`
    );
    return 1;
  }

  return parsed;
}

/**
 * Parse post style from CLI option.
 * Valid values: 'series' | 'variations'. Invalid values default to 'variations'.
 *
 * @param styleStr - String value from CLI
 * @returns Parsed post style
 */
export function parsePostStyle(styleStr: string | undefined): 'series' | 'variations' {
  if (styleStr === undefined) {
    return 'variations';
  }

  const normalized = styleStr.toLowerCase();
  if (normalized !== 'series' && normalized !== 'variations') {
    logWarning(
      `Invalid --post-style value '${styleStr}'. Using default: variations. Valid options: series, variations`
    );
    return 'variations';
  }

  return normalized as 'series' | 'variations';
}
