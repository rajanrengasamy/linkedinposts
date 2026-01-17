/**
 * Unit Tests for Nano Banana Image Router
 *
 * Tests the three-tier fallback system for image generation:
 * Tier 1: CLI (subscription billing)
 * Tier 2: API (per-token billing)
 * Tier 3: Manual (instructions for user)
 *
 * @see src/image/nanoBananaRouter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger to prevent console output during tests
vi.mock('../../src/utils/logger.js', () => ({
  logVerbose: vi.fn(),
  logWarning: vi.fn(),
  logInfo: vi.fn(),
  logSuccess: vi.fn(),
  sanitize: vi.fn((s: string) => s),
}));

// Mock the CLI detector
vi.mock('../../src/llm/cli-detector.js', () => ({
  detectCLI: vi.fn(),
  getCLIPath: vi.fn(),
}));

// Mock the CLI wrapper
vi.mock('../../src/image/nanoBananaCli.js', () => ({
  getNanoBananaCLIClient: vi.fn(),
  isNanoBananaCliAvailable: vi.fn(),
  NanoBananaCLIWrapper: vi.fn(),
}));

// Mock nanoBanana functions
vi.mock('../../src/image/nanoBanana.js', () => ({
  buildInfographicPrompt: vi.fn(() => 'mock prompt'),
  makeImageRequest: vi.fn(),
  parseImageResponse: vi.fn(),
}));

// Mock retry utilities
vi.mock('../../src/utils/retry.js', () => ({
  withRetryAndTimeout: vi.fn(),
}));

// Import mocked modules
import { detectCLI } from '../../src/llm/cli-detector.js';
import { getNanoBananaCLIClient } from '../../src/image/nanoBananaCli.js';
import { withRetryAndTimeout } from '../../src/utils/retry.js';
import {
  routeImageGeneration,
  shouldUseNanoBananaCLI,
  shouldFallbackFromCLI,
  logImageRouterStatus,
} from '../../src/image/nanoBananaRouter.js';
import {
  NanoBananaError,
  NanoBananaNotFoundError,
  NanoBananaAuthError,
  NanoBananaTimeoutError,
  NanoBananaGenerationError,
} from '../../src/image/types.js';
import type { InfographicBrief } from '../../src/schemas/synthesisResult.js';
import type { PipelineConfig } from '../../src/types/index.js';

// ============================================
// Test Fixtures
// ============================================

const mockBrief: InfographicBrief = {
  title: 'Test Infographic',
  keyPoints: ['Point 1', 'Point 2', 'Point 3'],
  suggestedStyle: 'minimal',
  colorScheme: 'blue gradient',
};

const mockConfig: PipelineConfig = {
  sources: ['web'],
  skipValidation: false,
  skipScoring: false,
  skipImage: false,
  qualityProfile: 'default',
  maxPerSource: 25,
  maxTotal: 75,
  validationBatchSize: 10,
  scoringBatchSize: 25,
  timeoutSeconds: 600,
  imageResolution: '2k',
  scoringModel: 'gemini',
  synthesisModel: 'gpt',
  outputDir: './output',
  saveRaw: false,
  verbose: false,
  dryRun: false,
  postCount: 1,
  postStyle: 'variations',
  refinement: {
    skip: false,
    model: 'gemini',
    maxIterations: 3,
    timeoutMs: 30000,
  },
};

// ============================================
// shouldUseNanoBananaCLI Tests
// ============================================

describe('shouldUseNanoBananaCLI', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return true when USE_NANO_BANANA=true and CLI available', () => {
    process.env.USE_NANO_BANANA = 'true';
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(shouldUseNanoBananaCLI()).toBe(true);
  });

  it('should return false when USE_NANO_BANANA=false', () => {
    process.env.USE_NANO_BANANA = 'false';
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(shouldUseNanoBananaCLI()).toBe(false);
  });

  it('should return false when CLI not available', () => {
    process.env.USE_NANO_BANANA = 'true';
    vi.mocked(detectCLI).mockReturnValue({
      available: false,
      path: null,
      version: null,
      error: 'CLI not found',
    });

    expect(shouldUseNanoBananaCLI()).toBe(false);
  });

  it('should default to true when USE_NANO_BANANA not set', () => {
    delete process.env.USE_NANO_BANANA;
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(shouldUseNanoBananaCLI()).toBe(true);
  });

  it('should handle USE_NANO_BANANA=1 as true', () => {
    process.env.USE_NANO_BANANA = '1';
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(shouldUseNanoBananaCLI()).toBe(true);
  });

  it('should handle USE_NANO_BANANA=0 as false', () => {
    process.env.USE_NANO_BANANA = '0';
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(shouldUseNanoBananaCLI()).toBe(false);
  });

  it('should handle USE_NANO_BANANA=yes as true', () => {
    process.env.USE_NANO_BANANA = 'yes';
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(shouldUseNanoBananaCLI()).toBe(true);
  });

  it('should handle USE_NANO_BANANA=no as false', () => {
    process.env.USE_NANO_BANANA = 'no';
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(shouldUseNanoBananaCLI()).toBe(false);
  });
});

// ============================================
// shouldFallbackFromCLI Tests
// ============================================

describe('shouldFallbackFromCLI', () => {
  it('should return true for NanoBananaNotFoundError', () => {
    const error = new NanoBananaNotFoundError();
    expect(shouldFallbackFromCLI(error)).toBe(true);
  });

  it('should return true for NanoBananaAuthError', () => {
    const error = new NanoBananaAuthError('test message');
    expect(shouldFallbackFromCLI(error)).toBe(true);
  });

  it('should return true for NanoBananaTimeoutError', () => {
    const error = new NanoBananaTimeoutError(1000);
    expect(shouldFallbackFromCLI(error)).toBe(true);
  });

  it('should return true for NanoBananaGenerationError', () => {
    const error = new NanoBananaGenerationError('test');
    expect(shouldFallbackFromCLI(error)).toBe(true);
  });

  it('should return true for base NanoBananaError', () => {
    const error = new NanoBananaError('base error');
    expect(shouldFallbackFromCLI(error)).toBe(true);
  });

  it('should return false for unknown errors', () => {
    const error = new Error('random error');
    expect(shouldFallbackFromCLI(error)).toBe(false);
  });

  it('should return false for TypeError', () => {
    const error = new TypeError('type error');
    expect(shouldFallbackFromCLI(error)).toBe(false);
  });

  it('should return false for null', () => {
    expect(shouldFallbackFromCLI(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(shouldFallbackFromCLI(undefined)).toBe(false);
  });

  it('should return false for string error', () => {
    expect(shouldFallbackFromCLI('error string')).toBe(false);
  });
});

// ============================================
// routeImageGeneration Tests
// ============================================

describe('routeImageGeneration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GOOGLE_AI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return manual tier when skipImage is true', async () => {
    const configWithSkip = { ...mockConfig, skipImage: true };

    const result = await routeImageGeneration(mockBrief, configWithSkip);

    expect(result.buffer).toBeNull();
    expect(result.tier).toBe('manual');
    expect(result.tiersAttempted).toEqual([]);
  });

  it('should try CLI first when available', async () => {
    const mockBuffer = Buffer.from('PNG data');

    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    const mockClient = {
      generateImageBytes: vi.fn().mockResolvedValue(mockBuffer),
    };
    vi.mocked(getNanoBananaCLIClient).mockReturnValue(mockClient as any);

    const result = await routeImageGeneration(mockBrief, mockConfig);

    expect(result.buffer).toEqual(mockBuffer);
    expect(result.tier).toBe('cli');
    expect(result.tiersAttempted).toContain('cli');
    expect(mockClient.generateImageBytes).toHaveBeenCalled();
  });

  it('should fallback to API when CLI fails', async () => {
    const mockBuffer = Buffer.from('API PNG data');

    // CLI available but fails
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    const mockClient = {
      generateImageBytes: vi.fn().mockRejectedValue(new NanoBananaGenerationError('CLI failed')),
    };
    vi.mocked(getNanoBananaCLIClient).mockReturnValue(mockClient as any);

    // API succeeds
    vi.mocked(withRetryAndTimeout).mockResolvedValue({
      success: true,
      data: mockBuffer,
    } as any);

    const result = await routeImageGeneration(mockBrief, mockConfig);

    expect(result.buffer).toEqual(mockBuffer);
    expect(result.tier).toBe('api');
    expect(result.tiersAttempted).toContain('cli');
    expect(result.tiersAttempted).toContain('api');
  });

  it('should return manual tier when both CLI and API fail', async () => {
    // CLI available but fails
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    const mockClient = {
      generateImageBytes: vi.fn().mockRejectedValue(new NanoBananaGenerationError('CLI failed')),
    };
    vi.mocked(getNanoBananaCLIClient).mockReturnValue(mockClient as any);

    // API also fails
    vi.mocked(withRetryAndTimeout).mockResolvedValue({
      success: false,
      error: new Error('API failed'),
    } as any);

    const result = await routeImageGeneration(mockBrief, mockConfig);

    expect(result.buffer).toBeNull();
    expect(result.tier).toBe('manual');
    expect(result.tiersAttempted).toContain('cli');
    expect(result.tiersAttempted).toContain('api');
    expect(result.tiersAttempted).toContain('manual');
  });

  it('should skip CLI when enableCLI=false', async () => {
    const mockBuffer = Buffer.from('API PNG data');

    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    vi.mocked(withRetryAndTimeout).mockResolvedValue({
      success: true,
      data: mockBuffer,
    } as any);

    const result = await routeImageGeneration(mockBrief, mockConfig, {
      enableCLI: false,
    });

    expect(result.buffer).toEqual(mockBuffer);
    expect(result.tier).toBe('api');
    expect(result.tiersAttempted).not.toContain('cli');
    expect(result.tiersAttempted).toContain('api');
  });

  it('should skip API when enableAPI=false', async () => {
    // CLI not available
    vi.mocked(detectCLI).mockReturnValue({
      available: false,
      path: null,
      version: null,
    });

    const result = await routeImageGeneration(mockBrief, mockConfig, {
      enableAPI: false,
    });

    expect(result.buffer).toBeNull();
    expect(result.tier).toBe('manual');
    expect(result.tiersAttempted).not.toContain('api');
  });

  it('should track all attempted tiers', async () => {
    // CLI available but returns null
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    const mockClient = {
      generateImageBytes: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(getNanoBananaCLIClient).mockReturnValue(mockClient as any);

    // API also returns null
    vi.mocked(withRetryAndTimeout).mockResolvedValue({
      success: true,
      data: null,
    } as any);

    const result = await routeImageGeneration(mockBrief, mockConfig);

    expect(result.tiersAttempted).toContain('cli');
    expect(result.tiersAttempted).toContain('api');
    expect(result.tiersAttempted).toContain('manual');
    expect(result.tiersAttempted.length).toBe(3);
  });

  it('should not attempt API tier when GOOGLE_AI_API_KEY not set', async () => {
    delete process.env.GOOGLE_AI_API_KEY;

    // CLI not available
    vi.mocked(detectCLI).mockReturnValue({
      available: false,
      path: null,
      version: null,
    });

    const result = await routeImageGeneration(mockBrief, mockConfig);

    expect(result.buffer).toBeNull();
    expect(result.tier).toBe('manual');
    expect(result.tiersAttempted).not.toContain('api');
    expect(result.tiersAttempted).toContain('manual');
  });

  it('should rethrow unexpected errors', async () => {
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    const unexpectedError = new TypeError('Unexpected type error');
    const mockClient = {
      generateImageBytes: vi.fn().mockRejectedValue(unexpectedError),
    };
    vi.mocked(getNanoBananaCLIClient).mockReturnValue(mockClient as any);

    await expect(routeImageGeneration(mockBrief, mockConfig)).rejects.toThrow(TypeError);
  });
});

// ============================================
// logImageRouterStatus Tests
// ============================================

describe('logImageRouterStatus', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should log configuration without errors', () => {
    process.env.GOOGLE_AI_API_KEY = 'test-key';
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    // Should not throw
    expect(() => logImageRouterStatus()).not.toThrow();
  });

  it('should log when CLI is disabled', () => {
    process.env.USE_NANO_BANANA = 'false';
    process.env.GOOGLE_AI_API_KEY = 'test-key';

    expect(() => logImageRouterStatus()).not.toThrow();
  });

  it('should log when API key is missing', () => {
    delete process.env.GOOGLE_AI_API_KEY;
    vi.mocked(detectCLI).mockReturnValue({
      available: true,
      path: '/usr/local/bin/gemini',
      version: '1.0.0',
    });

    expect(() => logImageRouterStatus()).not.toThrow();
  });

  it('should log when both CLI and API are unavailable', () => {
    delete process.env.GOOGLE_AI_API_KEY;
    process.env.USE_NANO_BANANA = 'false';

    expect(() => logImageRouterStatus()).not.toThrow();
  });
});
