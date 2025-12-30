/**
 * Unit Tests for Scoring Router
 *
 * Tests for scoring routing logic in:
 * - src/scoring/index.ts
 *
 * Coverage includes:
 * - score() function routing based on scoringModel
 * - Default model selection
 * - Integration between router and scoring modules
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ValidatedItem, PipelineConfig, ScoredItem } from '../../src/types/index.js';
import { SCHEMA_VERSION } from '../../src/schemas/rawItem.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a test ValidatedItem with sensible defaults
 */
function createTestValidatedItem(overrides?: Partial<ValidatedItem>): ValidatedItem {
  return {
    id: uuidv4(),
    schemaVersion: SCHEMA_VERSION,
    source: 'web',
    sourceUrl: 'https://example.com/article',
    retrievedAt: new Date().toISOString(),
    content: 'Test content about AI and technology trends',
    contentHash: 'a1b2c3d4e5f67890',
    engagement: { likes: 100, comments: 10, shares: 5 },
    validation: {
      level: 'SOURCE_CONFIRMED',
      confidence: 0.85,
      checkedAt: new Date().toISOString(),
      sourcesFound: ['https://example.com/source1'],
      notes: ['Verified from web source'],
      quotesVerified: [],
    },
    ...overrides,
  };
}

/**
 * Create a mock PipelineConfig
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
    scoringModel: 'gemini',
    outputDir: './output',
    saveRaw: false,
    verbose: false,
    dryRun: false,
    ...overrides,
  };
}

/**
 * Create a mock ScoredItem
 */
function createMockScoredItem(item: ValidatedItem): ScoredItem {
  return {
    ...item,
    scores: {
      relevance: 75,
      authenticity: 80,
      recency: 70,
      engagementPotential: 65,
      overall: 72,
    },
    scoreReasoning: ['Mock score for testing'],
    rank: 1,
  };
}

// ============================================
// Mock Setup
// ============================================

// We need to mock the Gemini and OpenRouter modules
const mockScoreItems = vi.fn();
const mockScoreItemsWithKimi2 = vi.fn();

vi.mock('../../src/scoring/gemini.js', async () => {
  const actual = await vi.importActual('../../src/scoring/gemini.js');
  return {
    ...actual,
    scoreItems: mockScoreItems,
  };
});

vi.mock('../../src/scoring/openrouter.js', async () => {
  const actual = await vi.importActual('../../src/scoring/openrouter.js');
  return {
    ...actual,
    scoreItemsWithKimi2: mockScoreItemsWithKimi2,
  };
});

// ============================================
// Scoring Router Tests
// ============================================

describe('Scoring Router (score function)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock implementations
    mockScoreItems.mockImplementation(async (items: ValidatedItem[]) => {
      return items.map((item, index) => ({
        ...createMockScoredItem(item),
        rank: index + 1,
      }));
    });

    mockScoreItemsWithKimi2.mockImplementation(async (items: ValidatedItem[]) => {
      return items.map((item, index) => ({
        ...createMockScoredItem(item),
        rank: index + 1,
      }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('model routing', () => {
    it('routes to Gemini when scoringModel is gemini', async () => {
      // Import dynamically after mocking
      const { score } = await import('../../src/scoring/index.js');

      const items = [createTestValidatedItem()];
      const config = createTestConfig({ scoringModel: 'gemini' });

      await score(items, 'test prompt', config);

      expect(mockScoreItems).toHaveBeenCalledTimes(1);
      expect(mockScoreItemsWithKimi2).not.toHaveBeenCalled();
    });

    it('routes to KIMI 2 when scoringModel is kimi2', async () => {
      const { score } = await import('../../src/scoring/index.js');

      const items = [createTestValidatedItem()];
      const config = createTestConfig({ scoringModel: 'kimi2' });

      await score(items, 'test prompt', config);

      expect(mockScoreItemsWithKimi2).toHaveBeenCalledTimes(1);
      expect(mockScoreItems).not.toHaveBeenCalled();
    });

    it('defaults to Gemini when scoringModel is undefined', async () => {
      const { score } = await import('../../src/scoring/index.js');

      const items = [createTestValidatedItem()];
      // Create config and explicitly set scoringModel to undefined
      const config = createTestConfig();
      (config as Record<string, unknown>).scoringModel = undefined;

      await score(items, 'test prompt', config);

      expect(mockScoreItems).toHaveBeenCalledTimes(1);
      expect(mockScoreItemsWithKimi2).not.toHaveBeenCalled();
    });
  });

  describe('parameter passing', () => {
    it('passes items to Gemini scoreItems', async () => {
      const { score } = await import('../../src/scoring/index.js');

      const items = [
        createTestValidatedItem({ content: 'Item 1' }),
        createTestValidatedItem({ content: 'Item 2' }),
      ];
      const config = createTestConfig({ scoringModel: 'gemini' });

      await score(items, 'test prompt', config);

      expect(mockScoreItems).toHaveBeenCalledWith(items, 'test prompt', config);
    });

    it('passes items to KIMI 2 scoreItemsWithKimi2', async () => {
      const { score } = await import('../../src/scoring/index.js');

      const items = [
        createTestValidatedItem({ content: 'Item A' }),
        createTestValidatedItem({ content: 'Item B' }),
      ];
      const config = createTestConfig({ scoringModel: 'kimi2' });

      await score(items, 'special prompt', config);

      expect(mockScoreItemsWithKimi2).toHaveBeenCalledWith(items, 'special prompt', config);
    });

    it('passes config with all options to scoring function', async () => {
      const { score } = await import('../../src/scoring/index.js');

      const items = [createTestValidatedItem()];
      const config = createTestConfig({
        scoringModel: 'gemini',
        scoringBatchSize: 10,
        skipScoring: false,
        verbose: true,
      });

      await score(items, 'test', config);

      const passedConfig = mockScoreItems.mock.calls[0][2] as PipelineConfig;
      expect(passedConfig.scoringBatchSize).toBe(10);
      expect(passedConfig.verbose).toBe(true);
    });
  });

  describe('return values', () => {
    it('returns scored items from Gemini', async () => {
      const { score } = await import('../../src/scoring/index.js');

      const items = [createTestValidatedItem()];
      const config = createTestConfig({ scoringModel: 'gemini' });

      const result = await score(items, 'test', config);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('scores');
      expect(result[0]).toHaveProperty('rank');
    });

    it('returns scored items from KIMI 2', async () => {
      const { score } = await import('../../src/scoring/index.js');

      const items = [createTestValidatedItem()];
      const config = createTestConfig({ scoringModel: 'kimi2' });

      const result = await score(items, 'test', config);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('scores');
      expect(result[0]).toHaveProperty('rank');
    });

    it('handles empty items array', async () => {
      const { score } = await import('../../src/scoring/index.js');

      mockScoreItems.mockResolvedValue([]);

      const config = createTestConfig({ scoringModel: 'gemini' });

      const result = await score([], 'test', config);

      expect(result).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('propagates errors from Gemini scorer', async () => {
      const { score } = await import('../../src/scoring/index.js');

      mockScoreItems.mockRejectedValue(new Error('Gemini API error'));

      const items = [createTestValidatedItem()];
      const config = createTestConfig({ scoringModel: 'gemini' });

      await expect(score(items, 'test', config)).rejects.toThrow('Gemini API error');
    });

    it('propagates errors from KIMI 2 scorer', async () => {
      const { score } = await import('../../src/scoring/index.js');

      mockScoreItemsWithKimi2.mockRejectedValue(new Error('OpenRouter API error'));

      const items = [createTestValidatedItem()];
      const config = createTestConfig({ scoringModel: 'kimi2' });

      await expect(score(items, 'test', config)).rejects.toThrow('OpenRouter API error');
    });
  });
});

// ============================================
// Module Exports Tests
// ============================================

describe('Scoring Module Exports', () => {
  it('exports score function', async () => {
    const scoringModule = await import('../../src/scoring/index.js');
    expect(scoringModule.score).toBeDefined();
    expect(typeof scoringModule.score).toBe('function');
  });

  it('exports scoreItems for direct Gemini access', async () => {
    const scoringModule = await import('../../src/scoring/index.js');
    expect(scoringModule.scoreItems).toBeDefined();
  });

  it('exports scoreItemsWithKimi2 for direct OpenRouter access', async () => {
    const scoringModule = await import('../../src/scoring/index.js');
    expect(scoringModule.scoreItemsWithKimi2).toBeDefined();
  });

  it('exports fallbackScore', async () => {
    const scoringModule = await import('../../src/scoring/index.js');
    expect(scoringModule.fallbackScore).toBeDefined();
  });

  it('exports Gemini types and utilities', async () => {
    const scoringModule = await import('../../src/scoring/index.js');
    expect(scoringModule.GeminiScoreResponseSchema).toBeDefined();
    expect(scoringModule.buildScoringPrompt).toBeDefined();
    expect(scoringModule.parseGeminiScoringResponse).toBeDefined();
    expect(scoringModule.applyVerificationBoost).toBeDefined();
    expect(scoringModule.processScoredItems).toBeDefined();
  });

  it('exports OpenRouter constants', async () => {
    const scoringModule = await import('../../src/scoring/index.js');
    expect(scoringModule.KIMI_MODEL).toBeDefined();
    expect(scoringModule.OPENROUTER_API_URL).toBeDefined();
  });
});

// ============================================
// Integration-style Tests
// ============================================

describe('Scoring Router Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockScoreItems.mockImplementation(async (items: ValidatedItem[]) => {
      return items.map((item, index) => ({
        ...createMockScoredItem(item),
        scoreReasoning: ['Scored by Gemini'],
        rank: index + 1,
      }));
    });

    mockScoreItemsWithKimi2.mockImplementation(async (items: ValidatedItem[]) => {
      return items.map((item, index) => ({
        ...createMockScoredItem(item),
        scoreReasoning: ['Scored by KIMI 2'],
        rank: index + 1,
      }));
    });
  });

  it('produces consistent output format regardless of model', async () => {
    const { score } = await import('../../src/scoring/index.js');

    const items = [createTestValidatedItem()];

    const geminiConfig = createTestConfig({ scoringModel: 'gemini' });
    const kimi2Config = createTestConfig({ scoringModel: 'kimi2' });

    const geminiResult = await score(items, 'test', geminiConfig);
    const kimi2Result = await score(items, 'test', kimi2Config);

    // Both should have same structure
    expect(geminiResult[0]).toHaveProperty('scores');
    expect(kimi2Result[0]).toHaveProperty('scores');

    expect(geminiResult[0].scores).toHaveProperty('relevance');
    expect(kimi2Result[0].scores).toHaveProperty('relevance');

    expect(geminiResult[0].scores).toHaveProperty('authenticity');
    expect(kimi2Result[0].scores).toHaveProperty('authenticity');

    expect(geminiResult[0].scores).toHaveProperty('recency');
    expect(kimi2Result[0].scores).toHaveProperty('recency');

    expect(geminiResult[0].scores).toHaveProperty('engagementPotential');
    expect(kimi2Result[0].scores).toHaveProperty('engagementPotential');

    expect(geminiResult[0].scores).toHaveProperty('overall');
    expect(kimi2Result[0].scores).toHaveProperty('overall');

    expect(geminiResult[0]).toHaveProperty('rank');
    expect(kimi2Result[0]).toHaveProperty('rank');

    expect(geminiResult[0]).toHaveProperty('scoreReasoning');
    expect(kimi2Result[0]).toHaveProperty('scoreReasoning');
  });

  it('different models can produce different scores', async () => {
    const { score } = await import('../../src/scoring/index.js');

    // Set up different mock responses for each model
    mockScoreItems.mockResolvedValue([{
      ...createMockScoredItem(createTestValidatedItem()),
      scores: { relevance: 80, authenticity: 85, recency: 75, engagementPotential: 70, overall: 78 },
      rank: 1,
    }]);

    mockScoreItemsWithKimi2.mockResolvedValue([{
      ...createMockScoredItem(createTestValidatedItem()),
      scores: { relevance: 75, authenticity: 80, recency: 70, engagementPotential: 65, overall: 72 },
      rank: 1,
    }]);

    const items = [createTestValidatedItem()];

    const geminiResult = await score(items, 'test', createTestConfig({ scoringModel: 'gemini' }));
    const kimi2Result = await score(items, 'test', createTestConfig({ scoringModel: 'kimi2' }));

    // Different models may produce different scores
    expect(geminiResult[0].scores.overall).toBe(78);
    expect(kimi2Result[0].scores.overall).toBe(72);
  });
});
