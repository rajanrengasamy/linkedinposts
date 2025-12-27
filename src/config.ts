/**
 * Configuration & Environment Variables
 *
 * Handles environment loading, API key validation, and configuration
 * merging with quality profiles.
 */

import 'dotenv/config';
import type { PipelineConfig, SourceOption, QualityProfile } from './types/index.js';
import {
  DEFAULT_CONFIG,
  QUALITY_PROFILES,
  API_CONCURRENCY_LIMITS,
  STAGE_TIMEOUT_MS,
} from './types/index.js';

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
 * Validate that all required API keys are present based on sources.
 *
 * Required keys:
 * - PERPLEXITY_API_KEY (always)
 * - GOOGLE_AI_API_KEY (always)
 * - OPENAI_API_KEY (always)
 * - SCRAPECREATORS_API_KEY (only if linkedin or x sources enabled)
 *
 * @param sources - The data sources that will be used
 * @returns Validation result with missing keys
 */
export function validateApiKeys(sources: SourceOption[]): ApiKeyValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check always-required keys
  for (const key of REQUIRED_KEYS) {
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
 * @param sources - The data sources that will be used
 * @throws Error with clear message listing missing keys
 */
export function requireApiKeys(sources: SourceOption[]): void {
  const result = validateApiKeys(sources);

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
  timeout?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Parse sources string into array of SourceOption
 */
function parseSources(sourcesStr: string): SourceOption[] {
  const valid: SourceOption[] = ['web', 'linkedin', 'x'];
  const sources = sourcesStr
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => valid.includes(s as SourceOption)) as SourceOption[];

  // Ensure at least 'web' is included
  if (!sources.includes('web')) {
    sources.unshift('web');
  }

  return sources;
}

/**
 * Parse quality profile string
 */
function parseQualityProfile(profileStr: string): QualityProfile {
  const valid: QualityProfile[] = ['fast', 'default', 'thorough'];
  const profile = profileStr.toLowerCase() as QualityProfile;
  return valid.includes(profile) ? profile : 'default';
}

/**
 * Parse image resolution string
 */
function parseImageResolution(resStr: string): '2k' | '4k' {
  return resStr === '4k' ? '4k' : '2k';
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

  return config;
}

/**
 * Validate a complete config and check API keys.
 * Returns validation result without throwing.
 */
export function validateConfig(config: PipelineConfig): ApiKeyValidationResult {
  return validateApiKeys(config.sources);
}

/**
 * Validate config and throw if invalid.
 * Use this for fail-fast CLI behavior.
 */
export function requireValidConfig(config: PipelineConfig): void {
  requireApiKeys(config.sources);
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

export type { PipelineConfig, QualityProfile, SourceOption } from './types/index.js';
