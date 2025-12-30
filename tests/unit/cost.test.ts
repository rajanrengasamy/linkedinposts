/**
 * Unit Tests for Cost Estimation
 *
 * Tests for cost estimation functions in:
 * - src/utils/cost.ts
 *
 * Coverage includes:
 * - TOKEN_COSTS and IMAGE_COSTS constants
 * - estimateCost function with various configs
 * - calculateActualCost function
 * - CostTracker class
 * - formatCost function
 * - getCostSummary function
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TOKEN_COSTS,
  IMAGE_COSTS,
  estimateCost,
  calculateActualCost,
  CostTracker,
  formatCost,
  getCostSummary,
  type TokenUsage,
} from '../../src/utils/cost.js';
import type { PipelineConfig } from '../../src/types/index.js';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a mock PipelineConfig with sensible defaults
 */
function createTestConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
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
    ...overrides,
  };
}

// ============================================
// TOKEN_COSTS Tests
// ============================================

describe('TOKEN_COSTS', () => {
  it('has correct perplexity pricing', () => {
    expect(TOKEN_COSTS.perplexity.inputPerMillion).toBe(3.0);
    expect(TOKEN_COSTS.perplexity.outputPerMillion).toBe(15.0);
  });

  it('has correct gemini pricing', () => {
    expect(TOKEN_COSTS.gemini.inputPerMillion).toBe(0.5);
    expect(TOKEN_COSTS.gemini.outputPerMillion).toBe(3.0);
  });

  it('has correct openai pricing', () => {
    expect(TOKEN_COSTS.openai.inputPerMillion).toBe(10.0);
    expect(TOKEN_COSTS.openai.outputPerMillion).toBe(30.0);
  });

  it('has all required API providers', () => {
    expect(TOKEN_COSTS).toHaveProperty('perplexity');
    expect(TOKEN_COSTS).toHaveProperty('gemini');
    expect(TOKEN_COSTS).toHaveProperty('openai');
  });

  it('all pricing values are positive', () => {
    for (const [provider, pricing] of Object.entries(TOKEN_COSTS)) {
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
    }
  });
});

// ============================================
// IMAGE_COSTS Tests
// ============================================

describe('IMAGE_COSTS', () => {
  it('has correct 2k resolution pricing', () => {
    expect(IMAGE_COSTS['2k']).toBe(0.134);
  });

  it('has correct 4k resolution pricing', () => {
    expect(IMAGE_COSTS['4k']).toBe(0.24);
  });

  it('4k costs more than 2k', () => {
    expect(IMAGE_COSTS['4k']).toBeGreaterThan(IMAGE_COSTS['2k']);
  });

  it('has all required resolutions', () => {
    expect(IMAGE_COSTS).toHaveProperty('2k');
    expect(IMAGE_COSTS).toHaveProperty('4k');
  });
});

// ============================================
// estimateCost Tests
// ============================================

describe('estimateCost', () => {
  it('estimates cost for default config', () => {
    const config = createTestConfig();
    const result = estimateCost(config);

    expect(result.total).toBeGreaterThan(0);
    expect(result.perplexity).toBeGreaterThan(0);
    expect(result.gemini).toBeGreaterThan(0);
    expect(result.openai).toBeGreaterThan(0);
    expect(result.nanoBanana).toBeGreaterThan(0);
  });

  it('estimates cost for fast profile (skip stages)', () => {
    const config = createTestConfig({
      qualityProfile: 'fast',
      skipValidation: true,
      skipScoring: true,
      skipImage: true,
      maxTotal: 30,
    });
    const result = estimateCost(config);

    // With skipped stages, some costs should be zero
    expect(result.gemini).toBe(0); // Scoring skipped
    expect(result.nanoBanana).toBe(0); // Image skipped

    // Perplexity still runs for collection (validation skipped doesn't affect collection)
    expect(result.perplexity).toBeGreaterThan(0);

    // OpenAI synthesis always runs
    expect(result.openai).toBeGreaterThan(0);

    expect(result.total).toBeGreaterThan(0);
  });

  it('estimates cost for thorough profile', () => {
    const config = createTestConfig({
      qualityProfile: 'thorough',
      maxTotal: 150,
      imageResolution: '4k',
    });
    const result = estimateCost(config);

    // All stages should run
    expect(result.perplexity).toBeGreaterThan(0);
    expect(result.gemini).toBeGreaterThan(0);
    expect(result.openai).toBeGreaterThan(0);
    expect(result.nanoBanana).toBeGreaterThan(0);

    // 4k image should cost more
    expect(result.nanoBanana).toBe(IMAGE_COSTS['4k']);
  });

  it('estimates cost with all sources enabled', () => {
    const config = createTestConfig({
      sources: ['web', 'linkedin', 'x'],
    });
    const result = estimateCost(config);

    // More sources = higher Perplexity costs
    const webOnlyConfig = createTestConfig({ sources: ['web'] });
    const webOnlyResult = estimateCost(webOnlyConfig);

    expect(result.perplexity).toBeGreaterThan(webOnlyResult.perplexity);
  });

  it('estimates cost with web-only', () => {
    const config = createTestConfig({
      sources: ['web'],
    });
    const result = estimateCost(config);

    expect(result.total).toBeGreaterThan(0);
    expect(result.perplexity).toBeGreaterThan(0);
  });

  it('breakdown includes all services', () => {
    const config = createTestConfig();
    const result = estimateCost(config);

    expect(result).toHaveProperty('perplexity');
    expect(result).toHaveProperty('gemini');
    expect(result).toHaveProperty('openai');
    expect(result).toHaveProperty('nanoBanana');
    expect(result).toHaveProperty('total');
  });

  it('total equals sum of components', () => {
    const config = createTestConfig();
    const result = estimateCost(config);

    const sum = result.perplexity + result.gemini + result.openai + result.nanoBanana;

    // Use toBeCloseTo due to floating point rounding
    expect(result.total).toBeCloseTo(sum, 4);
  });

  it('handles skipValidation correctly', () => {
    const withValidation = createTestConfig({ skipValidation: false });
    const withoutValidation = createTestConfig({ skipValidation: true });

    const withResult = estimateCost(withValidation);
    const withoutResult = estimateCost(withoutValidation);

    // Skipping validation reduces Perplexity costs
    expect(withoutResult.perplexity).toBeLessThan(withResult.perplexity);
  });

  it('handles skipScoring correctly', () => {
    const withScoring = createTestConfig({ skipScoring: false });
    const withoutScoring = createTestConfig({ skipScoring: true });

    const withResult = estimateCost(withScoring);
    const withoutResult = estimateCost(withoutScoring);

    expect(withResult.gemini).toBeGreaterThan(0);
    expect(withoutResult.gemini).toBe(0);
  });

  it('handles skipImage correctly', () => {
    const withImage = createTestConfig({ skipImage: false });
    const withoutImage = createTestConfig({ skipImage: true });

    const withResult = estimateCost(withImage);
    const withoutResult = estimateCost(withoutImage);

    expect(withResult.nanoBanana).toBeGreaterThan(0);
    expect(withoutResult.nanoBanana).toBe(0);
  });

  it('rounds costs to 4 decimal places', () => {
    const config = createTestConfig();
    const result = estimateCost(config);

    // Check each cost has at most 4 decimal places
    const checkDecimalPlaces = (value: number): boolean => {
      const str = value.toString();
      const decimalIndex = str.indexOf('.');
      if (decimalIndex === -1) return true;
      return str.length - decimalIndex - 1 <= 4;
    };

    expect(checkDecimalPlaces(result.perplexity)).toBe(true);
    expect(checkDecimalPlaces(result.gemini)).toBe(true);
    expect(checkDecimalPlaces(result.openai)).toBe(true);
    expect(checkDecimalPlaces(result.nanoBanana)).toBe(true);
    expect(checkDecimalPlaces(result.total)).toBe(true);
  });

  it('maxTotal affects scoring and validation costs', () => {
    const lowMax = createTestConfig({ maxTotal: 25 });
    const highMax = createTestConfig({ maxTotal: 150 });

    const lowResult = estimateCost(lowMax);
    const highResult = estimateCost(highMax);

    // Higher maxTotal = more items to process
    expect(highResult.perplexity).toBeGreaterThan(lowResult.perplexity);
    expect(highResult.gemini).toBeGreaterThan(lowResult.gemini);
  });
});

// ============================================
// calculateActualCost Tests
// ============================================

describe('calculateActualCost', () => {
  it('calculates cost with full token usage', () => {
    const usage: TokenUsage = {
      perplexity: { inputTokens: 10000, outputTokens: 5000 },
      gemini: { inputTokens: 8000, outputTokens: 2000 },
      openai: { inputTokens: 5000, outputTokens: 2000 },
      imageGenerated: true,
      imageResolution: '2k',
    };

    const result = calculateActualCost(usage);

    expect(result.perplexity).toBeGreaterThan(0);
    expect(result.gemini).toBeGreaterThan(0);
    expect(result.openai).toBeGreaterThan(0);
    expect(result.nanoBanana).toBe(IMAGE_COSTS['2k']);
    expect(result.total).toBeGreaterThan(0);
  });

  it('calculates cost with partial usage (some services unused)', () => {
    const usage: TokenUsage = {
      perplexity: { inputTokens: 10000, outputTokens: 5000 },
      // gemini not used
      openai: { inputTokens: 5000, outputTokens: 2000 },
      // no image
    };

    const result = calculateActualCost(usage);

    expect(result.perplexity).toBeGreaterThan(0);
    expect(result.gemini).toBe(0);
    expect(result.openai).toBeGreaterThan(0);
    expect(result.nanoBanana).toBe(0);
  });

  it('calculates cost with image generated', () => {
    const usage: TokenUsage = {
      openai: { inputTokens: 5000, outputTokens: 2000 },
      imageGenerated: true,
      imageResolution: '4k',
    };

    const result = calculateActualCost(usage);

    expect(result.nanoBanana).toBe(IMAGE_COSTS['4k']);
  });

  it('calculates cost without image', () => {
    const usage: TokenUsage = {
      openai: { inputTokens: 5000, outputTokens: 2000 },
      imageGenerated: false,
    };

    const result = calculateActualCost(usage);

    expect(result.nanoBanana).toBe(0);
  });

  it('handles empty usage', () => {
    const usage: TokenUsage = {};

    const result = calculateActualCost(usage);

    expect(result.perplexity).toBe(0);
    expect(result.gemini).toBe(0);
    expect(result.openai).toBe(0);
    expect(result.nanoBanana).toBe(0);
    expect(result.total).toBe(0);
  });

  it('correctly calculates token-based costs', () => {
    // 1 million tokens at known rates
    const usage: TokenUsage = {
      perplexity: { inputTokens: 1_000_000, outputTokens: 0 },
    };

    const result = calculateActualCost(usage);

    // Input: 1M tokens * $3/M = $3.00
    expect(result.perplexity).toBe(3.0);
  });

  it('correctly combines input and output token costs', () => {
    const usage: TokenUsage = {
      openai: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    };

    const result = calculateActualCost(usage);

    // Input: 1M * $10/M = $10
    // Output: 1M * $30/M = $30
    // Total: $40
    expect(result.openai).toBe(40.0);
  });

  it('total equals sum of components', () => {
    const usage: TokenUsage = {
      perplexity: { inputTokens: 50000, outputTokens: 25000 },
      gemini: { inputTokens: 40000, outputTokens: 10000 },
      openai: { inputTokens: 25000, outputTokens: 10000 },
      imageGenerated: true,
      imageResolution: '2k',
    };

    const result = calculateActualCost(usage);

    const sum = result.perplexity + result.gemini + result.openai + result.nanoBanana;
    expect(result.total).toBeCloseTo(sum, 4);
  });

  it('imageGenerated false ignores resolution', () => {
    const usage: TokenUsage = {
      imageGenerated: false,
      imageResolution: '4k', // Should be ignored
    };

    const result = calculateActualCost(usage);

    expect(result.nanoBanana).toBe(0);
  });
});

// ============================================
// CostTracker Tests
// ============================================

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe('addPerplexity', () => {
    it('accumulates correctly', () => {
      tracker.addPerplexity(1000, 500);
      tracker.addPerplexity(2000, 1000);

      const usage = tracker.getUsage();

      expect(usage.perplexity?.inputTokens).toBe(3000);
      expect(usage.perplexity?.outputTokens).toBe(1500);
    });

    it('initializes from zero', () => {
      tracker.addPerplexity(100, 50);

      const usage = tracker.getUsage();

      expect(usage.perplexity?.inputTokens).toBe(100);
      expect(usage.perplexity?.outputTokens).toBe(50);
    });
  });

  describe('addGemini', () => {
    it('accumulates correctly', () => {
      tracker.addGemini(500, 100);
      tracker.addGemini(500, 100);
      tracker.addGemini(500, 100);

      const usage = tracker.getUsage();

      expect(usage.gemini?.inputTokens).toBe(1500);
      expect(usage.gemini?.outputTokens).toBe(300);
    });

    it('initializes from zero', () => {
      tracker.addGemini(800, 200);

      const usage = tracker.getUsage();

      expect(usage.gemini?.inputTokens).toBe(800);
      expect(usage.gemini?.outputTokens).toBe(200);
    });
  });

  describe('addOpenAI', () => {
    it('accumulates correctly', () => {
      tracker.addOpenAI(5000, 2000);
      tracker.addOpenAI(3000, 1000);

      const usage = tracker.getUsage();

      expect(usage.openai?.inputTokens).toBe(8000);
      expect(usage.openai?.outputTokens).toBe(3000);
    });

    it('initializes from zero', () => {
      tracker.addOpenAI(1000, 500);

      const usage = tracker.getUsage();

      expect(usage.openai?.inputTokens).toBe(1000);
      expect(usage.openai?.outputTokens).toBe(500);
    });
  });

  describe('addImage', () => {
    it('records resolution', () => {
      tracker.addImage('2k');

      const usage = tracker.getUsage();

      expect(usage.imageGenerated).toBe(true);
      expect(usage.imageResolution).toBe('2k');
    });

    it('records 4k resolution', () => {
      tracker.addImage('4k');

      const usage = tracker.getUsage();

      expect(usage.imageGenerated).toBe(true);
      expect(usage.imageResolution).toBe('4k');
    });

    it('overwrites previous image resolution', () => {
      tracker.addImage('2k');
      tracker.addImage('4k');

      const usage = tracker.getUsage();

      expect(usage.imageResolution).toBe('4k');
    });
  });

  describe('getUsage', () => {
    it('returns current state', () => {
      tracker.addPerplexity(100, 50);
      tracker.addGemini(200, 100);
      tracker.addOpenAI(300, 150);
      tracker.addImage('2k');

      const usage = tracker.getUsage();

      expect(usage.perplexity).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(usage.gemini).toEqual({ inputTokens: 200, outputTokens: 100 });
      expect(usage.openai).toEqual({ inputTokens: 300, outputTokens: 150 });
      expect(usage.imageGenerated).toBe(true);
      expect(usage.imageResolution).toBe('2k');
    });

    it('returns empty state initially', () => {
      const usage = tracker.getUsage();

      expect(usage.perplexity).toBeUndefined();
      expect(usage.gemini).toBeUndefined();
      expect(usage.openai).toBeUndefined();
      expect(usage.imageGenerated).toBeUndefined();
    });

    it('returns a shallow copy of top-level properties', () => {
      tracker.addPerplexity(100, 50);
      tracker.addImage('2k');

      const usage = tracker.getUsage();

      // Modifying top-level properties doesn't affect tracker
      usage.imageGenerated = false;
      usage.imageResolution = '4k';

      const usage2 = tracker.getUsage();

      // Tracker's state should be unchanged
      expect(usage2.imageGenerated).toBe(true);
      expect(usage2.imageResolution).toBe('2k');
    });
  });

  describe('getCost', () => {
    it('calculates from usage', () => {
      tracker.addPerplexity(1_000_000, 0);

      const cost = tracker.getCost();

      // 1M input tokens * $3/M = $3.00
      expect(cost.perplexity).toBe(3.0);
    });

    it('includes all tracked services', () => {
      tracker.addPerplexity(10000, 5000);
      tracker.addGemini(8000, 2000);
      tracker.addOpenAI(5000, 2000);
      tracker.addImage('2k');

      const cost = tracker.getCost();

      expect(cost.perplexity).toBeGreaterThan(0);
      expect(cost.gemini).toBeGreaterThan(0);
      expect(cost.openai).toBeGreaterThan(0);
      expect(cost.nanoBanana).toBe(IMAGE_COSTS['2k']);
      expect(cost.total).toBeGreaterThan(0);
    });

    it('returns zero costs when empty', () => {
      const cost = tracker.getCost();

      expect(cost.perplexity).toBe(0);
      expect(cost.gemini).toBe(0);
      expect(cost.openai).toBe(0);
      expect(cost.nanoBanana).toBe(0);
      expect(cost.total).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears state', () => {
      tracker.addPerplexity(1000, 500);
      tracker.addGemini(800, 200);
      tracker.addOpenAI(500, 200);
      tracker.addImage('4k');

      tracker.reset();

      const usage = tracker.getUsage();

      expect(usage.perplexity).toBeUndefined();
      expect(usage.gemini).toBeUndefined();
      expect(usage.openai).toBeUndefined();
      expect(usage.imageGenerated).toBeUndefined();
      expect(usage.imageResolution).toBeUndefined();
    });

    it('allows re-accumulation after reset', () => {
      tracker.addPerplexity(1000, 500);
      tracker.reset();
      tracker.addPerplexity(200, 100);

      const usage = tracker.getUsage();

      expect(usage.perplexity?.inputTokens).toBe(200);
      expect(usage.perplexity?.outputTokens).toBe(100);
    });
  });

  describe('mixed operations', () => {
    it('handles interleaved calls correctly', () => {
      tracker.addPerplexity(100, 50);
      tracker.addGemini(80, 20);
      tracker.addPerplexity(100, 50);
      tracker.addOpenAI(50, 25);
      tracker.addGemini(80, 20);

      const usage = tracker.getUsage();

      expect(usage.perplexity?.inputTokens).toBe(200);
      expect(usage.gemini?.inputTokens).toBe(160);
      expect(usage.openai?.inputTokens).toBe(50);
    });
  });
});

// ============================================
// formatCost Tests
// ============================================

describe('formatCost', () => {
  it('small costs (< $0.01) show 4 decimal places', () => {
    expect(formatCost(0.0012)).toBe('$0.0012');
    expect(formatCost(0.0099)).toBe('$0.0099');
    expect(formatCost(0.001)).toBe('$0.0010');
    expect(formatCost(0.0001)).toBe('$0.0001');
  });

  it('larger costs show 2 decimal places', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(0.50)).toBe('$0.50');
    expect(formatCost(1.00)).toBe('$1.00');
    expect(formatCost(10.99)).toBe('$10.99');
    expect(formatCost(100.00)).toBe('$100.00');
  });

  it('handles zero', () => {
    expect(formatCost(0)).toBe('$0.0000');
  });

  it('handles boundary at $0.01', () => {
    expect(formatCost(0.0099)).toBe('$0.0099'); // 4 decimal places
    expect(formatCost(0.01)).toBe('$0.01'); // 2 decimal places
    expect(formatCost(0.011)).toBe('$0.01'); // 2 decimal places
  });

  it('handles very small costs', () => {
    expect(formatCost(0.00001)).toBe('$0.0000');
    expect(formatCost(0.00005)).toBe('$0.0001');
  });

  it('handles large costs', () => {
    expect(formatCost(1000.00)).toBe('$1000.00');
    expect(formatCost(9999.99)).toBe('$9999.99');
  });
});

// ============================================
// getCostSummary Tests
// ============================================

describe('getCostSummary', () => {
  it('returns formatted string', () => {
    const config = createTestConfig();
    const summary = getCostSummary(config);

    expect(typeof summary).toBe('string');
    expect(summary).toContain('Estimated cost:');
    expect(summary).toContain('$');
  });

  it('includes all non-zero components', () => {
    const config = createTestConfig();
    const summary = getCostSummary(config);

    expect(summary).toContain('Perplexity:');
    expect(summary).toContain('Gemini:');
    expect(summary).toContain('OpenAI:');
    expect(summary).toContain('Image:');
  });

  it('excludes zero components', () => {
    const config = createTestConfig({
      skipScoring: true,
      skipImage: true,
    });
    const summary = getCostSummary(config);

    expect(summary).not.toContain('Gemini:');
    expect(summary).not.toContain('Image:');

    // These should still be present
    expect(summary).toContain('Perplexity:');
    expect(summary).toContain('OpenAI:');
  });

  it('includes total cost', () => {
    const config = createTestConfig();
    const summary = getCostSummary(config);

    // Summary format: "Estimated cost: $X.XX (Perplexity: ..., ...)"
    expect(summary).toMatch(/Estimated cost: \$[\d.]+/);
  });

  it('uses correct cost format for each component', () => {
    const config = createTestConfig();
    const summary = getCostSummary(config);

    // Each component should have a $ prefix
    const dollarMatches = summary.match(/\$/g) || [];

    // At least 2: total + at least one component
    expect(dollarMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('handles all stages skipped', () => {
    const config = createTestConfig({
      skipValidation: true,
      skipScoring: true,
      skipImage: true,
    });
    const summary = getCostSummary(config);

    // Should still have Perplexity (collection) and OpenAI (synthesis)
    expect(summary).toContain('Perplexity:');
    expect(summary).toContain('OpenAI:');
  });
});

// ============================================
// Edge Cases and Boundary Tests
// ============================================

describe('Edge Cases', () => {
  describe('estimateCost edge cases', () => {
    it('handles minimal config', () => {
      const config = createTestConfig({
        maxTotal: 1,
        sources: ['web'],
      });

      const result = estimateCost(config);

      expect(result.total).toBeGreaterThan(0);
    });

    it('handles maximum items', () => {
      const config = createTestConfig({
        maxTotal: 1000,
        sources: ['web', 'linkedin', 'x'],
      });

      // Should not throw
      const result = estimateCost(config);

      expect(result.total).toBeGreaterThan(0);
    });

    it('thorough profile with all sources', () => {
      const config = createTestConfig({
        qualityProfile: 'thorough',
        sources: ['web', 'linkedin', 'x'],
        maxTotal: 150,
        imageResolution: '4k',
      });

      const result = estimateCost(config);

      // Should be significantly higher than default
      const defaultConfig = createTestConfig();
      const defaultResult = estimateCost(defaultConfig);

      expect(result.total).toBeGreaterThan(defaultResult.total);
    });
  });

  describe('calculateActualCost edge cases', () => {
    it('handles large token counts', () => {
      const usage: TokenUsage = {
        perplexity: { inputTokens: 100_000_000, outputTokens: 50_000_000 },
        gemini: { inputTokens: 50_000_000, outputTokens: 25_000_000 },
        openai: { inputTokens: 10_000_000, outputTokens: 5_000_000 },
        imageGenerated: true,
        imageResolution: '4k',
      };

      const result = calculateActualCost(usage);

      expect(result.total).toBeGreaterThan(0);
      expect(result.perplexity).toBeGreaterThan(0);
      expect(result.gemini).toBeGreaterThan(0);
      expect(result.openai).toBeGreaterThan(0);
    });

    it('handles zero tokens', () => {
      const usage: TokenUsage = {
        perplexity: { inputTokens: 0, outputTokens: 0 },
        gemini: { inputTokens: 0, outputTokens: 0 },
        openai: { inputTokens: 0, outputTokens: 0 },
      };

      const result = calculateActualCost(usage);

      expect(result.perplexity).toBe(0);
      expect(result.gemini).toBe(0);
      expect(result.openai).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('CostTracker edge cases', () => {
    it('handles adding zero tokens', () => {
      const tracker = new CostTracker();
      tracker.addPerplexity(0, 0);

      const usage = tracker.getUsage();

      expect(usage.perplexity?.inputTokens).toBe(0);
      expect(usage.perplexity?.outputTokens).toBe(0);
    });

    it('handles many small additions', () => {
      const tracker = new CostTracker();

      // Simulate many small API calls
      for (let i = 0; i < 100; i++) {
        tracker.addPerplexity(10, 5);
      }

      const usage = tracker.getUsage();

      expect(usage.perplexity?.inputTokens).toBe(1000);
      expect(usage.perplexity?.outputTokens).toBe(500);
    });
  });

  describe('formatCost edge cases', () => {
    it('handles negative costs (should not happen but be safe)', () => {
      // Should still format, even if negative
      const result = formatCost(-0.01);

      expect(result).toContain('-');
      expect(result).toContain('$');
    });

    it('handles very precise numbers', () => {
      const result = formatCost(0.123456789);

      // Should be truncated to 2 decimals since > 0.01
      expect(result).toBe('$0.12');
    });
  });
});

// ============================================
// Integration-style Tests
// ============================================

describe('Cost Estimation Integration', () => {
  it('estimates match rough reality', () => {
    // Default config should have reasonable costs
    const config = createTestConfig();
    const estimate = estimateCost(config);

    // For a typical run, total should be between $0.10 and $5.00
    expect(estimate.total).toBeGreaterThan(0.01);
    expect(estimate.total).toBeLessThan(10.0);
  });

  it('actual costs track with estimates', () => {
    // Use similar token counts to what estimation assumes
    const tracker = new CostTracker();

    // Add tokens similar to what a default run might use
    tracker.addPerplexity(50000, 75000); // ~$0.15 input + $1.125 output
    tracker.addGemini(40000, 10000); // ~$0.02 input + $0.03 output
    tracker.addOpenAI(5000, 2000); // ~$0.05 input + $0.06 output
    tracker.addImage('2k'); // $0.134

    const actual = tracker.getCost();

    // Should be in reasonable range
    expect(actual.total).toBeGreaterThan(0.5);
    expect(actual.total).toBeLessThan(5.0);
  });

  it('fast profile is cheaper than thorough', () => {
    const fastConfig = createTestConfig({
      qualityProfile: 'fast',
      skipValidation: true,
      skipScoring: true,
      skipImage: true,
      maxTotal: 30,
    });

    const thoroughConfig = createTestConfig({
      qualityProfile: 'thorough',
      maxTotal: 150,
      imageResolution: '4k',
    });

    const fastEstimate = estimateCost(fastConfig);
    const thoroughEstimate = estimateCost(thoroughConfig);

    expect(fastEstimate.total).toBeLessThan(thoroughEstimate.total);
  });
});
