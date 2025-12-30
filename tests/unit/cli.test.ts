/**
 * CLI Unit Tests
 *
 * Tests for the CLI entry point components:
 * - program.ts: Commander setup and option parsing
 * - preflight.ts: Pre-flight checks
 * - errorHandler.ts: Error handling and exit codes
 *
 * @see docs/PRD-v2.md Section 12 - CLI Interface
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram, parseCliOptions } from '../../src/cli/program.js';
import {
  EXIT_CODES,
  isConfigError,
  getExitCode,
  createPipelineStatus,
  completePipelineStatus,
  updatePipelineStage,
  createErrorContext,
  withErrorHandling,
} from '../../src/cli/errorHandler.js';
import {
  runPreflightChecks,
  type PreflightOptions,
} from '../../src/cli/preflight.js';
import { buildConfig, type CliOptions } from '../../src/config.js';
import type { PipelineConfig } from '../../src/types/index.js';
import { validateOutputDir } from '../../src/utils/fileWriter.js';
import { sanitize } from '../../src/utils/logger.js';

// ============================================
// Program Tests
// ============================================

describe('createProgram', () => {
  it('should create Commander program with correct name', () => {
    const program = createProgram();
    expect(program.name()).toBe('linkedin-post-generator');
  });

  it('should have required prompt argument', () => {
    const program = createProgram();
    // Note: Commander.js does not expose a public API to inspect argument definitions.
    // We access the internal _args array for testing purposes only.
    // This is acceptable because:
    // 1. We're testing our configuration is correct, not Commander internals
    // 2. If Commander changes this internal API, the test will fail clearly
    // 3. There's no official public API alternative for this inspection
    // See: https://github.com/tj/commander.js/issues/1353
    const args = (program as any)._args;
    expect(args.length).toBe(1);
    expect(args[0]._name).toBe('prompt');
    expect(args[0].required).toBe(true);
  });

  it('should have all source control options', () => {
    const program = createProgram();
    const opts = program.options;
    const optNames = opts.map((o) => o.long);

    expect(optNames).toContain('--sources');
    expect(optNames).toContain('--skip-validation');
    expect(optNames).toContain('--skip-scoring');
    expect(optNames).toContain('--skip-image');
  });

  it('should have quality profile options', () => {
    const program = createProgram();
    const opts = program.options;
    const optNames = opts.map((o) => o.long);

    expect(optNames).toContain('--fast');
    expect(optNames).toContain('--quality');
  });

  it('should have limit options', () => {
    const program = createProgram();
    const opts = program.options;
    const optNames = opts.map((o) => o.long);

    expect(optNames).toContain('--max-per-source');
    expect(optNames).toContain('--max-total');
    expect(optNames).toContain('--max-results');
  });

  it('should have output options', () => {
    const program = createProgram();
    const opts = program.options;
    const optNames = opts.map((o) => o.long);

    expect(optNames).toContain('--output-dir');
    expect(optNames).toContain('--save-raw');
    expect(optNames).toContain('--image-resolution');
  });

  it('should have debug options', () => {
    const program = createProgram();
    const opts = program.options;
    const optNames = opts.map((o) => o.long);

    expect(optNames).toContain('--verbose');
    expect(optNames).toContain('--dry-run');
    expect(optNames).toContain('--print-cost-estimate');
  });
});

// ============================================
// parseCliOptions Tests
// ============================================

describe('parseCliOptions', () => {
  it('should parse sources option correctly', () => {
    const result = parseCliOptions(
      { sources: 'web,linkedin,x' },
      'test prompt'
    );

    expect(result.prompt).toBe('test prompt');
    expect(result.options.sources).toBe('web,linkedin,x');
  });

  it('should handle --fast shortcut', () => {
    const result = parseCliOptions(
      { fast: true },
      'test prompt'
    );

    expect(result.options.fast).toBe(true);
    expect(result.options.skipValidation).toBe(true);
    expect(result.options.skipScoring).toBe(true);
    expect(result.options.skipImage).toBe(true);
    expect(result.options.quality).toBe('fast');
  });

  it('should use defaults when no options provided', () => {
    const result = parseCliOptions({}, 'test prompt');

    expect(result.prompt).toBe('test prompt');
    expect(result.options.sources).toBeUndefined();
    expect(result.options.fast).toBeUndefined();
    expect(result.printCostEstimate).toBe(false);
  });

  it('should extract printCostEstimate flag', () => {
    const result = parseCliOptions(
      { printCostEstimate: true },
      'test prompt'
    );

    expect(result.printCostEstimate).toBe(true);
  });

  it('should handle verbose and dryRun flags', () => {
    const result = parseCliOptions(
      { verbose: true, dryRun: true },
      'test prompt'
    );

    expect(result.options.verbose).toBe(true);
    expect(result.options.dryRun).toBe(true);
  });

  it('should prefer maxTotal over maxResults when both provided', () => {
    const result = parseCliOptions(
      { maxTotal: '100', maxResults: '50' },
      'test prompt'
    );

    // maxTotal should be used, maxResults is just an alias
    expect(result.options.maxTotal).toBe('100');
  });

  it('should use maxResults when maxTotal is not provided', () => {
    const result = parseCliOptions(
      { maxResults: '50' },
      'test prompt'
    );

    expect(result.options.maxResults).toBe('50');
  });
});

// ============================================
// buildConfig Integration Tests
// ============================================

describe('buildConfig', () => {
  it('should build config with default values', () => {
    const options: CliOptions = {};
    const config = buildConfig(options);

    expect(config.sources).toContain('web');
    expect(config.qualityProfile).toBe('default');
    expect(config.skipValidation).toBe(false);
    expect(config.skipScoring).toBe(false);
    expect(config.skipImage).toBe(false);
  });

  it('should apply fast quality profile', () => {
    const options: CliOptions = { fast: true };
    const config = buildConfig(options);

    expect(config.qualityProfile).toBe('fast');
    expect(config.skipValidation).toBe(true);
    expect(config.skipScoring).toBe(true);
    expect(config.skipImage).toBe(true);
    expect(config.maxTotal).toBe(30);
  });

  it('should apply thorough quality profile', () => {
    const options: CliOptions = { quality: 'thorough' };
    const config = buildConfig(options);

    expect(config.qualityProfile).toBe('thorough');
    expect(config.maxTotal).toBe(150);
    expect(config.imageResolution).toBe('4k');
  });

  it('should parse sources correctly', () => {
    const options: CliOptions = { sources: 'web,linkedin' };
    const config = buildConfig(options);

    expect(config.sources).toEqual(['web', 'linkedin']);
  });

  it('should ensure web is always included in sources', () => {
    const options: CliOptions = { sources: 'linkedin,x' };
    const config = buildConfig(options);

    expect(config.sources).toContain('web');
    expect(config.sources).toContain('linkedin');
    expect(config.sources).toContain('x');
  });

  it('should apply explicit skip flags over profile defaults', () => {
    // Default profile doesn't skip validation, but we explicitly skip it
    const options: CliOptions = { quality: 'default', skipValidation: true };
    const config = buildConfig(options);

    expect(config.qualityProfile).toBe('default');
    expect(config.skipValidation).toBe(true);
  });

  it('should parse numeric options correctly', () => {
    const options: CliOptions = {
      maxPerSource: '50',
      maxTotal: '200',
      timeout: '300',
    };
    const config = buildConfig(options);

    expect(config.maxPerSource).toBe(50);
    expect(config.maxTotal).toBe(200);
    expect(config.timeoutSeconds).toBe(300);
  });

  it('should handle invalid numeric options gracefully', () => {
    const options: CliOptions = {
      maxPerSource: 'invalid',
      maxTotal: '-5',
    };
    const config = buildConfig(options);

    // Should use defaults when invalid
    expect(config.maxPerSource).toBe(25); // default
    expect(config.maxTotal).toBe(75); // default for 'default' profile
  });
});

// ============================================
// Exit Codes Tests
// ============================================

describe('EXIT_CODES', () => {
  it('should have success code of 0', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
  });

  it('should have pipeline error code of 1', () => {
    expect(EXIT_CODES.PIPELINE_ERROR).toBe(1);
  });

  it('should have config error code of 2', () => {
    expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
  });
});

// ============================================
// Error Classification Tests
// ============================================

describe('isConfigError', () => {
  it('should identify missing API key errors', () => {
    const error = new Error('Missing required API key: OPENAI_API_KEY');
    expect(isConfigError(error)).toBe(true);
  });

  it('should identify invalid option errors', () => {
    const error = new Error('Invalid option: --sources xyz');
    expect(isConfigError(error)).toBe(true);
  });

  it('should identify .env file errors', () => {
    const error = new Error('Please set this in your .env file');
    expect(isConfigError(error)).toBe(true);
  });

  it('should identify environment variable errors', () => {
    const error = new Error('Environment variable not set');
    expect(isConfigError(error)).toBe(true);
  });

  it('should not classify runtime errors as config errors', () => {
    const error = new Error('Network connection failed');
    expect(isConfigError(error)).toBe(false);
  });

  it('should not classify API errors as config errors', () => {
    const error = new Error('API rate limit exceeded');
    expect(isConfigError(error)).toBe(false);
  });
});

describe('getExitCode', () => {
  it('should return CONFIG_ERROR for config errors', () => {
    const error = new Error('Missing required API key');
    expect(getExitCode(error)).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('should return PIPELINE_ERROR for runtime errors', () => {
    const error = new Error('Network timeout');
    expect(getExitCode(error)).toBe(EXIT_CODES.PIPELINE_ERROR);
  });
});

// ============================================
// Pipeline Status Tests
// ============================================

describe('createPipelineStatus', () => {
  it('should create initial status with correct properties', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const startTime = Date.now();
    const status = createPipelineStatus(config, startTime);

    expect(status.success).toBe(false);
    expect(status.startedAt).toBeDefined();
    expect(status.config).toBe(config);
    expect(status.completedAt).toBeUndefined();
    expect(status.durationMs).toBeUndefined();
  });
});

describe('completePipelineStatus', () => {
  it('should complete status with success', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const startTime = Date.now();
    const initialStatus = createPipelineStatus(config, startTime);

    const completedStatus = completePipelineStatus(initialStatus, true, 5000);

    expect(completedStatus.success).toBe(true);
    expect(completedStatus.completedAt).toBeDefined();
    expect(completedStatus.durationMs).toBe(5000);
    expect(completedStatus.error).toBeUndefined();
  });

  it('should complete status with error', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const startTime = Date.now();
    const initialStatus = createPipelineStatus(config, startTime);

    const completedStatus = completePipelineStatus(initialStatus, false, 3000, 'Test error');

    expect(completedStatus.success).toBe(false);
    expect(completedStatus.durationMs).toBe(3000);
    expect(completedStatus.error).toBe('Test error');
  });
});

describe('updatePipelineStage', () => {
  it('should update stage name', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const status = createPipelineStatus(config, Date.now());
    const updated = updatePipelineStage(status, 'collection');

    expect(updated.stage).toBe('collection');
  });
});

describe('createErrorContext', () => {
  it('should create error context with all properties', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const startTime = Date.now();
    const context = createErrorContext(config, startTime, '/output/test', 'validation');

    expect(context.config).toBe(config);
    expect(context.startTime).toBe(startTime);
    expect(context.outputDir).toBe('/output/test');
    expect(context.stage).toBe('validation');
  });

  it('should handle missing optional properties', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const startTime = Date.now();
    const context = createErrorContext(config, startTime);

    expect(context.outputDir).toBeUndefined();
    expect(context.stage).toBeUndefined();
  });
});

// ============================================
// Integration Tests: CLI Flow
// ============================================

describe('CLI Flow Integration', () => {
  it('should parse options and build config correctly', () => {
    // Simulate full CLI parsing flow
    const rawOpts = {
      sources: 'web,linkedin',
      quality: 'thorough',
      verbose: true,
      saveRaw: true,
    };

    const { prompt, options } = parseCliOptions(rawOpts, 'AI in healthcare');
    const config = buildConfig(options);

    expect(prompt).toBe('AI in healthcare');
    expect(config.sources).toEqual(['web', 'linkedin']);
    expect(config.qualityProfile).toBe('thorough');
    expect(config.verbose).toBe(true);
    expect(config.saveRaw).toBe(true);
    expect(config.maxTotal).toBe(150); // thorough profile
    expect(config.imageResolution).toBe('4k'); // thorough profile
  });

  it('should handle fast mode correctly in full flow', () => {
    const rawOpts = { fast: true };

    const { options } = parseCliOptions(rawOpts, 'test');
    const config = buildConfig(options);

    expect(config.qualityProfile).toBe('fast');
    expect(config.skipValidation).toBe(true);
    expect(config.skipScoring).toBe(true);
    expect(config.skipImage).toBe(true);
    expect(config.maxTotal).toBe(30);
  });
});

// ============================================
// Pre-flight Checks Tests (MAJ-10)
// ============================================

describe('runPreflightChecks', () => {
  // Store original env
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set all required API keys to pass validation
    process.env.PERPLEXITY_API_KEY = 'test-perplexity-key';
    process.env.GOOGLE_AI_API_KEY = 'test-google-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should continue when API keys are valid and no special modes', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const options: PreflightOptions = {};
    const result = runPreflightChecks(config, options);

    expect(result.shouldContinue).toBe(true);
    expect(result.apiKeyValidation.valid).toBe(true);
    expect(result.exitCode).toBeUndefined();
  });

  it('should fail when required API keys are missing', () => {
    // Remove a required key
    delete process.env.OPENAI_API_KEY;

    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const options: PreflightOptions = {};
    const result = runPreflightChecks(config, options);

    expect(result.shouldContinue).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.apiKeyValidation.valid).toBe(false);
    expect(result.apiKeyValidation.missing).toContain('OPENAI_API_KEY');
  });

  it('should exit with code 0 for printCostEstimate mode', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const options: PreflightOptions = { printCostEstimate: true };
    const result = runPreflightChecks(config, options);

    expect(result.shouldContinue).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('should exit with code 0 for dryRun mode', () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const options: PreflightOptions = { dryRun: true };
    const result = runPreflightChecks(config, options);

    expect(result.shouldContinue).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('should require social API key for linkedin/x sources', () => {
    // Ensure social API key is NOT set for this test
    delete process.env.SCRAPECREATORS_API_KEY;

    const config: PipelineConfig = {
      sources: ['web', 'linkedin'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const options: PreflightOptions = {};
    const result = runPreflightChecks(config, options);

    // Should fail because SCRAPECREATORS_API_KEY is not set
    expect(result.shouldContinue).toBe(false);
    expect(result.apiKeyValidation.valid).toBe(false);
    expect(result.apiKeyValidation.missing).toContain('SCRAPECREATORS_API_KEY');
  });
});

// ============================================
// withErrorHandling Tests (MAJ-10)
// ============================================

describe('withErrorHandling', () => {
  it('should return success result when function succeeds', async () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const context = { config, startTime: Date.now() };
    const result = await withErrorHandling(
      async () => 'test-result',
      context
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe('test-result');
    }
  });

  it('should return failure with exit code when function throws', async () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const context = { config, startTime: Date.now() };
    const result = await withErrorHandling(
      async () => {
        throw new Error('Pipeline failed');
      },
      context
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.exitCode).toBe(EXIT_CODES.PIPELINE_ERROR);
    }
  });

  it('should return CONFIG_ERROR exit code for config errors', async () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const context = { config, startTime: Date.now() };
    const result = await withErrorHandling(
      async () => {
        throw new Error('Missing required API key: OPENAI_API_KEY');
      },
      context
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    }
  });

  it('should handle non-Error thrown values', async () => {
    const config: PipelineConfig = {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: false,
      qualityProfile: 'default',
      maxPerSource: 25,
      maxTotal: 75,
      validationBatchSize: 10,
      scoringBatchSize: 25,
      timeoutSeconds: 180,
      imageResolution: '2k',
      outputDir: './output',
      saveRaw: false,
      verbose: false,
      dryRun: false,
    };

    const context = { config, startTime: Date.now() };
    const result = await withErrorHandling(
      async () => {
        throw 'string error';
      },
      context
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.exitCode).toBe(EXIT_CODES.PIPELINE_ERROR);
    }
  });
});

// ============================================
// Path Validation Tests (MAJ-10)
// ============================================

describe('Path Validation', () => {
  it('should allow relative output paths', () => {
    const options: CliOptions = { outputDir: './output' };
    const config = buildConfig(options);
    expect(config.outputDir).toBe('./output');
  });

  it('should allow absolute output paths', () => {
    const options: CliOptions = { outputDir: '/tmp/output' };
    const config = buildConfig(options);
    expect(config.outputDir).toBe('/tmp/output');
  });

  it('should use default output directory when not specified', () => {
    const options: CliOptions = {};
    const config = buildConfig(options);
    expect(config.outputDir).toBe('./output');
  });
});

// ============================================
// Security Tests (MIN-9)
// ============================================

describe('Security: Path Traversal Prevention (MAJ-3)', () => {
  it('should allow relative paths within cwd', () => {
    // These should not throw
    expect(() => validateOutputDir('./output')).not.toThrow();
    expect(() => validateOutputDir('output')).not.toThrow();
    expect(() => validateOutputDir('output/subdir')).not.toThrow();
    expect(() => validateOutputDir('./deep/nested/path')).not.toThrow();
  });

  it('should reject path traversal with ../', () => {
    expect(() => validateOutputDir('../outside')).toThrow(
      /path traversal detected/i
    );
    expect(() => validateOutputDir('../../sensitive')).toThrow(
      /path traversal detected/i
    );
    expect(() => validateOutputDir('./output/../../escape')).toThrow(
      /path traversal detected/i
    );
  });

  it('should reject absolute paths outside cwd', () => {
    expect(() => validateOutputDir('/etc/passwd')).toThrow(
      /path traversal detected/i
    );
    expect(() => validateOutputDir('/tmp/malicious')).toThrow(
      /path traversal detected/i
    );
    expect(() => validateOutputDir('/var/log/app')).toThrow(
      /path traversal detected/i
    );
  });

  it('should allow absolute paths within cwd', () => {
    // Get cwd and create a path within it
    const cwd = process.cwd();
    const validAbsolutePath = `${cwd}/output`;

    // This should not throw because it's within cwd
    expect(() => validateOutputDir(validAbsolutePath)).not.toThrow();
  });

  it('should reject hidden traversal attempts', () => {
    // Attempts to disguise traversal
    expect(() => validateOutputDir('output/../../../etc')).toThrow(
      /path traversal detected/i
    );
    expect(() => validateOutputDir('./output/safe/../../..')).toThrow(
      /path traversal detected/i
    );
  });
});

describe('Security: API Key Sanitization (MAJ-4)', () => {
  // Store original env
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set mock API keys
    process.env.OPENAI_API_KEY = 'sk-test1234567890abcdef1234567890abcdef';
    process.env.PERPLEXITY_API_KEY = 'pplx-test1234567890abcdef1234567890abcd';
    process.env.GOOGLE_AI_API_KEY = 'AIzaSyTestKey1234567890abcdefghijklmnop';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should redact OpenAI API keys from error messages', () => {
    const sensitiveMessage = `Error: Invalid API key sk-test1234567890abcdef1234567890abcdef`;
    const sanitized = sanitize(sensitiveMessage);

    expect(sanitized).not.toContain('sk-test1234567890abcdef1234567890abcdef');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('should redact Perplexity API keys from error messages', () => {
    const sensitiveMessage = `API error with key pplx-test1234567890abcdef1234567890abcd`;
    const sanitized = sanitize(sensitiveMessage);

    expect(sanitized).not.toContain('pplx-test1234567890abcdef1234567890abcd');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('should redact Google API keys from error messages', () => {
    const sensitiveMessage = `Failed with key AIzaSyTestKey1234567890abcdefghijklmnop`;
    const sanitized = sanitize(sensitiveMessage);

    expect(sanitized).not.toContain('AIzaSyTestKey1234567890abcdefghijklmnop');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('should redact multiple API keys in a single message', () => {
    const sensitiveMessage =
      `Error: Keys sk-test1234567890abcdef1234567890abcdef and ` +
      `pplx-test1234567890abcdef1234567890abcd both failed`;
    const sanitized = sanitize(sensitiveMessage);

    expect(sanitized).not.toContain('sk-test1234567890abcdef1234567890abcdef');
    expect(sanitized).not.toContain('pplx-test1234567890abcdef1234567890abcd');
    expect(sanitized.match(/\[REDACTED\]/g)?.length).toBe(2);
  });

  it('should not modify messages without sensitive data', () => {
    const safeMessage = 'Connection timeout after 30 seconds';
    const sanitized = sanitize(safeMessage);

    expect(sanitized).toBe(safeMessage);
  });

  it('should redact patterns that look like API keys even if not in env', () => {
    // These match the API_KEY_PATTERNS in logger.ts
    const messageWithUnknownKey = 'Found key sk-unknownkey1234567890abcdef';
    const sanitized = sanitize(messageWithUnknownKey);

    expect(sanitized).not.toContain('sk-unknownkey1234567890abcdef');
    expect(sanitized).toContain('[REDACTED]');
  });
});
