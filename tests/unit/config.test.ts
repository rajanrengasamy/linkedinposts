/**
 * Configuration Unit Tests
 *
 * Tests for configuration parsing functions.
 *
 * @see docs/PRD-v2.md Section 17 - Multi-Post Generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parsePostCount,
  parsePostStyle,
  parseRefinementModel,
  buildConfig,
  validateApiKeys,
  type CliOptions,
} from '../../src/config.js';

// Mock logger to prevent console output during tests
vi.mock('../../src/utils/logger.js', () => ({
  logWarning: vi.fn(),
  logVerbose: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logSuccess: vi.fn(),
  logStage: vi.fn(),
  logProgress: vi.fn(),
  setVerbose: vi.fn(),
}));

// ============================================
// parsePostCount Tests (Section 17.9)
// ============================================

describe('parsePostCount', () => {
  it('should return 1 for undefined', () => {
    expect(parsePostCount(undefined)).toBe(1);
  });

  it('should parse valid values', () => {
    expect(parsePostCount('1')).toBe(1);
    expect(parsePostCount('2')).toBe(2);
    expect(parsePostCount('3')).toBe(3);
  });

  it('should return 1 for invalid values', () => {
    expect(parsePostCount('0')).toBe(1);
    expect(parsePostCount('4')).toBe(1);
    expect(parsePostCount('abc')).toBe(1);
  });

  it('should return 1 for negative values', () => {
    expect(parsePostCount('-1')).toBe(1);
    expect(parsePostCount('-5')).toBe(1);
  });

  it('should return 1 for empty string', () => {
    expect(parsePostCount('')).toBe(1);
  });

  it('should return 1 for whitespace', () => {
    expect(parsePostCount('  ')).toBe(1);
  });

  it('should return 1 for floating point values', () => {
    expect(parsePostCount('1.5')).toBe(1);
    expect(parsePostCount('2.9')).toBe(2);
  });
});

// ============================================
// parsePostStyle Tests (Section 17.9)
// ============================================

describe('parsePostStyle', () => {
  it('should return variations for undefined', () => {
    expect(parsePostStyle(undefined)).toBe('variations');
  });

  it('should parse valid values', () => {
    expect(parsePostStyle('series')).toBe('series');
    expect(parsePostStyle('variations')).toBe('variations');
  });

  it('should be case-insensitive', () => {
    expect(parsePostStyle('SERIES')).toBe('series');
    expect(parsePostStyle('Variations')).toBe('variations');
    expect(parsePostStyle('VARIATIONS')).toBe('variations');
    expect(parsePostStyle('Series')).toBe('series');
  });

  it('should return variations for invalid', () => {
    expect(parsePostStyle('invalid')).toBe('variations');
    expect(parsePostStyle('both')).toBe('variations');
    expect(parsePostStyle('')).toBe('variations');
  });

  it('should return variations for numeric input', () => {
    expect(parsePostStyle('123')).toBe('variations');
  });
});

// ============================================
// parseRefinementModel Tests (Section 18.9)
// ============================================

describe('parseRefinementModel', () => {
  it('should return gemini for undefined', () => {
    expect(parseRefinementModel(undefined)).toBe('gemini');
  });

  it('should parse valid values', () => {
    expect(parseRefinementModel('gemini')).toBe('gemini');
    expect(parseRefinementModel('gpt')).toBe('gpt');
    expect(parseRefinementModel('claude')).toBe('claude');
    expect(parseRefinementModel('kimi2')).toBe('kimi2');
  });

  it('should handle case-insensitive input', () => {
    expect(parseRefinementModel('GEMINI')).toBe('gemini');
    expect(parseRefinementModel('GPT')).toBe('gpt');
    expect(parseRefinementModel('Claude')).toBe('claude');
    expect(parseRefinementModel('KIMI2')).toBe('kimi2');
    expect(parseRefinementModel('Gemini')).toBe('gemini');
  });

  it('should return gemini for invalid values', () => {
    expect(parseRefinementModel('invalid')).toBe('gemini');
    expect(parseRefinementModel('openai')).toBe('gemini');
    expect(parseRefinementModel('anthropic')).toBe('gemini');
    expect(parseRefinementModel('')).toBe('gemini');
  });

  it('should return gemini for numeric input', () => {
    expect(parseRefinementModel('123')).toBe('gemini');
    expect(parseRefinementModel('4')).toBe('gemini');
  });

  it('should return gemini for whitespace input', () => {
    expect(parseRefinementModel('  ')).toBe('gemini');
    expect(parseRefinementModel('\t')).toBe('gemini');
  });
});

// ============================================
// buildConfig with refinement Tests (Section 18.9)
// ============================================

describe('buildConfig with refinement', () => {
  it('should include default refinement config', () => {
    const options: CliOptions = {};
    const config = buildConfig(options);

    expect(config.refinement).toBeDefined();
    expect(config.refinement!.skip).toBe(false);
    expect(config.refinement!.model).toBe('gemini');
  });

  it('should apply skipRefinement option', () => {
    const options: CliOptions = { skipRefinement: true };
    const config = buildConfig(options);

    expect(config.refinement!.skip).toBe(true);
  });

  it('should apply refinementModel option', () => {
    const options: CliOptions = { refinementModel: 'claude' };
    const config = buildConfig(options);

    expect(config.refinement!.model).toBe('claude');
  });

  it('should apply gpt as refinement model', () => {
    const options: CliOptions = { refinementModel: 'gpt' };
    const config = buildConfig(options);

    expect(config.refinement!.model).toBe('gpt');
  });

  it('should apply kimi2 as refinement model', () => {
    const options: CliOptions = { refinementModel: 'kimi2' };
    const config = buildConfig(options);

    expect(config.refinement!.model).toBe('kimi2');
  });

  it('should combine skipRefinement and refinementModel options', () => {
    const options: CliOptions = {
      skipRefinement: true,
      refinementModel: 'claude',
    };
    const config = buildConfig(options);

    expect(config.refinement!.skip).toBe(true);
    expect(config.refinement!.model).toBe('claude');
  });

  it('should include default maxIterations and timeoutMs', () => {
    const options: CliOptions = {};
    const config = buildConfig(options);

    expect(config.refinement!.maxIterations).toBe(3);
    expect(config.refinement!.timeoutMs).toBe(30000);
  });

  it('should handle invalid refinementModel gracefully', () => {
    const options: CliOptions = { refinementModel: 'invalid-model' };
    const config = buildConfig(options);

    expect(config.refinement!.model).toBe('gemini');
  });

  it('should preserve other config options with refinement', () => {
    const options: CliOptions = {
      sources: 'web,linkedin',
      refinementModel: 'gpt',
      quality: 'thorough',
    };
    const config = buildConfig(options);

    expect(config.sources).toEqual(['web', 'linkedin']);
    expect(config.refinement!.model).toBe('gpt');
    expect(config.qualityProfile).toBe('thorough');
  });
});

// ============================================
// validateApiKeys for refinement models Tests (Section 18.9)
// ============================================

describe('validateApiKeys for refinement models', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set base required keys
    process.env.PERPLEXITY_API_KEY = 'test-perplexity-key';
    process.env.GOOGLE_AI_API_KEY = 'test-google-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should validate ANTHROPIC_API_KEY when claude refinement model selected', () => {
    // Ensure ANTHROPIC_API_KEY is not set
    delete process.env.ANTHROPIC_API_KEY;

    const result = validateApiKeys({
      sources: ['web'],
      refinementModel: 'claude',
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('ANTHROPIC_API_KEY');
  });

  it('should pass when ANTHROPIC_API_KEY is set for claude model', () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

    const result = validateApiKeys({
      sources: ['web'],
      refinementModel: 'claude',
    });

    expect(result.valid).toBe(true);
    expect(result.missing).not.toContain('ANTHROPIC_API_KEY');
  });

  it('should validate OPENROUTER_API_KEY when kimi2 refinement model selected', () => {
    // Ensure OPENROUTER_API_KEY is not set
    delete process.env.OPENROUTER_API_KEY;

    const result = validateApiKeys({
      sources: ['web'],
      refinementModel: 'kimi2',
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('OPENROUTER_API_KEY');
  });

  it('should pass when OPENROUTER_API_KEY is set for kimi2 model', () => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    const result = validateApiKeys({
      sources: ['web'],
      refinementModel: 'kimi2',
    });

    expect(result.valid).toBe(true);
    expect(result.missing).not.toContain('OPENROUTER_API_KEY');
  });

  it('should not require extra keys for gemini refinement model', () => {
    const result = validateApiKeys({
      sources: ['web'],
      refinementModel: 'gemini',
    });

    expect(result.valid).toBe(true);
  });

  it('should not require extra keys for gpt refinement model', () => {
    const result = validateApiKeys({
      sources: ['web'],
      refinementModel: 'gpt',
    });

    expect(result.valid).toBe(true);
  });

  it('should not duplicate OPENROUTER_API_KEY check when both scoring and refinement use kimi2', () => {
    delete process.env.OPENROUTER_API_KEY;

    const result = validateApiKeys({
      sources: ['web'],
      scoringModel: 'kimi2',
      refinementModel: 'kimi2',
    });

    expect(result.valid).toBe(false);
    // Should only appear once in missing array
    const openrouterCount = result.missing.filter(
      (k) => k === 'OPENROUTER_API_KEY'
    ).length;
    expect(openrouterCount).toBe(1);
  });

  it('should validate OPENROUTER for kimi2 refinement even when scoring uses gemini', () => {
    delete process.env.OPENROUTER_API_KEY;

    const result = validateApiKeys({
      sources: ['web'],
      scoringModel: 'gemini',
      refinementModel: 'kimi2',
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('OPENROUTER_API_KEY');
  });

  it('should handle undefined refinementModel', () => {
    const result = validateApiKeys({
      sources: ['web'],
      refinementModel: undefined,
    });

    expect(result.valid).toBe(true);
  });

  it('should combine refinement and social source validations', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.SCRAPECREATORS_API_KEY;

    const result = validateApiKeys({
      sources: ['web', 'linkedin'],
      refinementModel: 'claude',
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('ANTHROPIC_API_KEY');
    expect(result.missing).toContain('SCRAPECREATORS_API_KEY');
  });
});
