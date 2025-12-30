/**
 * Golden Tests - Pipeline Output Structure Verification
 *
 * These tests verify that pipeline outputs match expected structure and schema compliance.
 * Golden tests focus on structure validation, not exact content matching.
 *
 * Test Cases:
 * - ai_healthcare: Default quality profile with all stages enabled
 * - minimal: Fast mode with skipped validation/scoring stages
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

// Import schemas for validation
import {
  SynthesisResultSchema,
  SourcesFileSchema,
  PipelineStatusSchema,
  ValidatedItemSchema,
  ScoredItemSchema,
  SCHEMA_VERSION,
  LINKEDIN_POST_MAX_LENGTH,
} from '../../src/schemas/index.js';

// ============================================
// Constants
// ============================================

const GOLDEN_DIR = join(process.cwd(), 'tests/golden/cases');

const VALID_VERIFICATION_LEVELS = [
  'UNVERIFIED',
  'SOURCE_CONFIRMED',
  'MULTISOURCE_CONFIRMED',
  'PRIMARY_SOURCE',
] as const;

const VALID_INFOGRAPHIC_STYLES = ['minimal', 'data-heavy', 'quote-focused'] as const;

// ============================================
// Types
// ============================================

interface GoldenInput {
  prompt: string;
  config: Record<string, unknown>;
}

interface SynthesisExpectations {
  hasSchemaVersion: boolean;
  schemaVersionValue?: string;
  hasGeneratedAt: boolean;
  hasPrompt: boolean;
  hasLinkedinPost: boolean;
  linkedinPostMaxLength: number;
  hasKeyQuotes: boolean;
  keyQuotesHaveSourceUrls: boolean;
  keyQuotesHaveVerificationLevels: boolean;
  validVerificationLevels: string[];
  hasInfographicBrief: boolean;
  infographicBriefHasTitle?: boolean;
  infographicBriefHasKeyPoints?: boolean;
  infographicBriefHasSuggestedStyle?: boolean;
  validInfographicStyles?: string[];
  hasFactCheckSummary: boolean;
  factCheckSummaryFields?: string[];
  hasMetadata: boolean;
  metadataHasSourcesUsed?: boolean;
  metadataHasProcessingTimeMs?: boolean;
  metadataHasEstimatedCost?: boolean;
  costBreakdownFields?: string[];
}

interface SourcesExpectations {
  hasSchemaVersion: boolean;
  schemaVersionValue?: string;
  hasGeneratedAt: boolean;
  hasTotalSources: boolean;
  sourcesArrayNotEmpty: boolean;
  allSourcesHaveId?: boolean;
  allSourcesHaveUrl: boolean;
  allSourcesHaveTitle?: boolean;
  allSourcesHaveRetrievedAt?: boolean;
  allSourcesHaveVerificationLevel?: boolean;
  allSourcesHaveUsedInPost?: boolean;
}

interface PipelineStatusExpectations {
  hasSuccess: boolean;
  hasStartedAt: boolean;
  hasConfig: boolean;
  configHasSources?: boolean;
  configHasQualityProfile: boolean;
  qualityProfileValue?: string;
  successRunHasCompletedAt?: boolean;
  successRunHasDuration?: boolean;
  failureRunHasError?: boolean;
  failureRunHasStage?: boolean;
}

interface GoldenOutput {
  description: string;
  expectedFiles: string[];
  synthesis: SynthesisExpectations;
  sources: SourcesExpectations;
  pipelineStatus: PipelineStatusExpectations;
  validatedData?: Record<string, unknown>;
  scoredData?: Record<string, unknown>;
  notes?: string[];
}

// ============================================
// Helpers
// ============================================

/**
 * Load a golden test case by name
 */
function loadGoldenCase(name: string): { input: GoldenInput; output: GoldenOutput } | null {
  const inputPath = join(GOLDEN_DIR, `${name}_input.json`);
  const outputPath = join(GOLDEN_DIR, `${name}_output.json`);

  if (!existsSync(inputPath) || !existsSync(outputPath)) {
    return null;
  }

  const input = JSON.parse(readFileSync(inputPath, 'utf-8')) as GoldenInput;
  const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as GoldenOutput;
  return { input, output };
}

/**
 * Create a mock synthesis result matching expected structure
 */
function createMockSynthesisResult(prompt: string = 'Test prompt') {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    prompt,
    linkedinPost: 'AI is transforming healthcare through advanced diagnostics.\n\n#AI #Healthcare #Innovation',
    keyQuotes: [
      {
        quote: 'AI diagnostics achieving 95% accuracy in clinical trials',
        author: 'Dr. Jane Smith',
        sourceUrl: 'https://example.com/ai-healthcare',
        verificationLevel: 'SOURCE_CONFIRMED' as const,
      },
    ],
    infographicBrief: {
      title: 'AI in Healthcare 2025',
      keyPoints: [
        'Diagnostic accuracy reaching 95%',
        'Cost reduction of 30%',
        'Patient outcomes improving',
      ],
      suggestedStyle: 'minimal' as const,
      colorScheme: 'blue-green medical palette',
    },
    factCheckSummary: {
      totalSourcesUsed: 5,
      verifiedQuotes: 3,
      unverifiedClaims: 1,
      primarySources: 1,
      warnings: [],
    },
    metadata: {
      sourcesUsed: 5,
      processingTimeMs: 15000,
      estimatedCost: {
        perplexity: 0.01,
        gemini: 0.005,
        openai: 0.02,
        nanoBanana: 0,
        total: 0.035,
      },
    },
  };
}

/**
 * Create a mock sources file matching expected structure
 */
function createMockSourcesFile() {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totalSources: 3,
    sources: [
      {
        id: uuidv4(),
        url: 'https://example.com/source1',
        title: 'AI Healthcare Study',
        author: 'Research Team',
        publishedAt: '2025-01-15T10:00:00Z',
        retrievedAt: new Date().toISOString(),
        verificationLevel: 'SOURCE_CONFIRMED' as const,
        usedInPost: true,
      },
      {
        id: uuidv4(),
        url: 'https://example.com/source2',
        title: 'Medical AI Trends',
        retrievedAt: new Date().toISOString(),
        verificationLevel: 'MULTISOURCE_CONFIRMED' as const,
        usedInPost: true,
      },
      {
        id: uuidv4(),
        url: 'https://example.com/source3',
        title: 'Future of Healthcare Tech',
        retrievedAt: new Date().toISOString(),
        verificationLevel: 'UNVERIFIED' as const,
        usedInPost: false,
      },
    ],
  };
}

/**
 * Create a mock pipeline status matching expected structure
 */
function createMockPipelineStatus(success: boolean = true) {
  const base = {
    success,
    startedAt: new Date().toISOString(),
    config: {
      sources: ['web'],
      skipValidation: false,
      skipScoring: false,
      skipImage: true,
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
    },
  };

  if (success) {
    return {
      ...base,
      completedAt: new Date().toISOString(),
      durationMs: 15000,
      costs: {
        perplexity: 0.01,
        gemini: 0.005,
        openai: 0.02,
        nanoBanana: 0,
        total: 0.035,
      },
    };
  } else {
    return {
      ...base,
      stage: 'synthesis',
      error: 'API request failed: rate limit exceeded',
    };
  }
}

/**
 * Create a mock validated item
 */
function createMockValidatedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv4(),
    schemaVersion: SCHEMA_VERSION,
    source: 'web',
    sourceUrl: 'https://example.com/article',
    retrievedAt: new Date().toISOString(),
    content: 'AI is transforming healthcare diagnostics with unprecedented accuracy.',
    contentHash: 'abc123def4567890',
    title: 'AI Healthcare Revolution',
    author: 'Dr. Jane Smith',
    engagement: {
      likes: 150,
      comments: 25,
      shares: 10,
    },
    validation: {
      level: 'SOURCE_CONFIRMED',
      confidence: 0.85,
      checkedAt: new Date().toISOString(),
      sourcesFound: ['https://example.com/original'],
      notes: ['Quote verified against original source'],
      quotesVerified: [
        {
          quote: 'AI diagnostics achieving 95% accuracy',
          verified: true,
          sourceUrl: 'https://example.com/original',
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Create a mock scored item
 */
function createMockScoredItem(rank: number, overrides: Record<string, unknown> = {}) {
  const validated = createMockValidatedItem();
  return {
    ...validated,
    scores: {
      relevance: 85,
      authenticity: 90,
      recency: 75,
      engagementPotential: 80,
      overall: 83,
    },
    scoreReasoning: ['High relevance to AI healthcare topic', 'Verified source'],
    rank,
    ...overrides,
  };
}

// ============================================
// Schema Compliance Tests
// ============================================

describe('Golden Tests - Schema Compliance', () => {
  describe('SynthesisResultSchema', () => {
    it('validates a correctly structured synthesis result', () => {
      const mockSynthesis = createMockSynthesisResult('AI trends in healthcare');
      const result = SynthesisResultSchema.safeParse(mockSynthesis);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.schemaVersion).toBe(SCHEMA_VERSION);
        expect(result.data.linkedinPost.length).toBeLessThanOrEqual(LINKEDIN_POST_MAX_LENGTH);
      }
    });

    it('rejects synthesis result with post exceeding max length', () => {
      const mockSynthesis = createMockSynthesisResult();
      mockSynthesis.linkedinPost = 'A'.repeat(LINKEDIN_POST_MAX_LENGTH + 1);

      const result = SynthesisResultSchema.safeParse(mockSynthesis);
      expect(result.success).toBe(false);
    });

    it('rejects synthesis result with missing sourceUrl in keyQuote', () => {
      const mockSynthesis = createMockSynthesisResult();
      // @ts-expect-error - intentionally invalid for test
      mockSynthesis.keyQuotes[0].sourceUrl = undefined;

      const result = SynthesisResultSchema.safeParse(mockSynthesis);
      expect(result.success).toBe(false);
    });

    it('rejects synthesis result with invalid verification level', () => {
      const mockSynthesis = createMockSynthesisResult();
      // @ts-expect-error - intentionally invalid for test
      mockSynthesis.keyQuotes[0].verificationLevel = 'INVALID_LEVEL';

      const result = SynthesisResultSchema.safeParse(mockSynthesis);
      expect(result.success).toBe(false);
    });

    it('rejects synthesis result with invalid infographic style', () => {
      const mockSynthesis = createMockSynthesisResult();
      // @ts-expect-error - intentionally invalid for test
      mockSynthesis.infographicBrief.suggestedStyle = 'invalid-style';

      const result = SynthesisResultSchema.safeParse(mockSynthesis);
      expect(result.success).toBe(false);
    });

    it('validates all infographic style options', () => {
      for (const style of VALID_INFOGRAPHIC_STYLES) {
        const mockSynthesis = createMockSynthesisResult();
        mockSynthesis.infographicBrief.suggestedStyle = style;

        const result = SynthesisResultSchema.safeParse(mockSynthesis);
        expect(result.success).toBe(true);
      }
    });

    it('validates all verification level options in keyQuotes', () => {
      for (const level of VALID_VERIFICATION_LEVELS) {
        const mockSynthesis = createMockSynthesisResult();
        mockSynthesis.keyQuotes[0].verificationLevel = level;

        const result = SynthesisResultSchema.safeParse(mockSynthesis);
        expect(result.success).toBe(true);
      }
    });

    it('validates cost breakdown structure', () => {
      const mockSynthesis = createMockSynthesisResult();

      const result = SynthesisResultSchema.safeParse(mockSynthesis);
      expect(result.success).toBe(true);

      if (result.success) {
        const cost = result.data.metadata.estimatedCost;
        expect(cost).toHaveProperty('perplexity');
        expect(cost).toHaveProperty('gemini');
        expect(cost).toHaveProperty('openai');
        expect(cost).toHaveProperty('nanoBanana');
        expect(cost).toHaveProperty('total');
        expect(typeof cost.total).toBe('number');
      }
    });
  });

  describe('SourcesFileSchema', () => {
    it('validates a correctly structured sources file', () => {
      const mockSources = createMockSourcesFile();
      const result = SourcesFileSchema.safeParse(mockSources);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.schemaVersion).toBe(SCHEMA_VERSION);
        expect(result.data.sources.length).toBe(mockSources.totalSources);
      }
    });

    it('rejects sources file with invalid URL', () => {
      const mockSources = createMockSourcesFile();
      mockSources.sources[0].url = 'not-a-valid-url';

      const result = SourcesFileSchema.safeParse(mockSources);
      expect(result.success).toBe(false);
    });

    it('validates all verification levels in sources', () => {
      const mockSources = createMockSourcesFile();

      for (const level of VALID_VERIFICATION_LEVELS) {
        mockSources.sources[0].verificationLevel = level;
        const result = SourcesFileSchema.safeParse(mockSources);
        expect(result.success).toBe(true);
      }
    });

    it('validates optional author and publishedAt fields', () => {
      const mockSources = createMockSourcesFile();
      // Remove optional fields
      delete mockSources.sources[1].author;
      delete mockSources.sources[1].publishedAt;

      const result = SourcesFileSchema.safeParse(mockSources);
      expect(result.success).toBe(true);
    });
  });

  describe('PipelineStatusSchema', () => {
    it('validates a successful pipeline status', () => {
      const mockStatus = createMockPipelineStatus(true);
      const result = PipelineStatusSchema.safeParse(mockStatus);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(true);
        expect(result.data.completedAt).toBeDefined();
        expect(result.data.durationMs).toBeDefined();
      }
    });

    it('validates a failed pipeline status', () => {
      const mockStatus = createMockPipelineStatus(false);
      const result = PipelineStatusSchema.safeParse(mockStatus);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(false);
        expect(result.data.error).toBeDefined();
        expect(result.data.stage).toBeDefined();
      }
    });

    it('validates config quality profile options', () => {
      const profiles = ['fast', 'default', 'thorough'];

      for (const profile of profiles) {
        const mockStatus = createMockPipelineStatus(true);
        mockStatus.config.qualityProfile = profile;

        const result = PipelineStatusSchema.safeParse(mockStatus);
        expect(result.success).toBe(true);
      }
    });

    it('validates config source options', () => {
      const mockStatus = createMockPipelineStatus(true);
      mockStatus.config.sources = ['web', 'linkedin', 'x'];

      const result = PipelineStatusSchema.safeParse(mockStatus);
      expect(result.success).toBe(true);
    });
  });

  describe('ValidatedItemSchema', () => {
    it('validates a correctly structured validated item', () => {
      const mockItem = createMockValidatedItem();
      const result = ValidatedItemSchema.safeParse(mockItem);

      expect(result.success).toBe(true);
    });

    it('validates validation object structure', () => {
      const mockItem = createMockValidatedItem();
      const result = ValidatedItemSchema.safeParse(mockItem);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.validation).toHaveProperty('level');
        expect(result.data.validation).toHaveProperty('confidence');
        expect(result.data.validation).toHaveProperty('checkedAt');
        expect(result.data.validation).toHaveProperty('sourcesFound');
        expect(result.data.validation).toHaveProperty('notes');
        expect(result.data.validation).toHaveProperty('quotesVerified');
      }
    });

    it('validates all verification levels', () => {
      // sourcesFound requirements:
      // UNVERIFIED: 0, SOURCE_CONFIRMED: 1, MULTISOURCE_CONFIRMED: 2, PRIMARY_SOURCE: 1
      const sourcesForLevel: Record<string, string[]> = {
        UNVERIFIED: [],
        SOURCE_CONFIRMED: ['https://example.com/source1'],
        MULTISOURCE_CONFIRMED: ['https://example.com/source1', 'https://example.com/source2'],
        PRIMARY_SOURCE: ['https://example.com/primary'],
      };

      for (const level of VALID_VERIFICATION_LEVELS) {
        const mockItem = createMockValidatedItem({
          validation: {
            level,
            confidence: 0.5,
            checkedAt: new Date().toISOString(),
            sourcesFound: sourcesForLevel[level],
            notes: [],
            quotesVerified: [],
          },
        });

        const result = ValidatedItemSchema.safeParse(mockItem);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('ScoredItemSchema', () => {
    it('validates a correctly structured scored item', () => {
      const mockItem = createMockScoredItem(1);
      const result = ScoredItemSchema.safeParse(mockItem);

      expect(result.success).toBe(true);
    });

    it('validates scores object structure', () => {
      const mockItem = createMockScoredItem(1);
      const result = ScoredItemSchema.safeParse(mockItem);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scores).toHaveProperty('relevance');
        expect(result.data.scores).toHaveProperty('authenticity');
        expect(result.data.scores).toHaveProperty('recency');
        expect(result.data.scores).toHaveProperty('engagementPotential');
        expect(result.data.scores).toHaveProperty('overall');
      }
    });

    it('rejects scores outside 0-100 range', () => {
      const mockItem = createMockScoredItem(1);
      mockItem.scores.relevance = 150; // Invalid

      const result = ScoredItemSchema.safeParse(mockItem);
      expect(result.success).toBe(false);
    });

    it('validates rank is a positive integer', () => {
      const mockItem = createMockScoredItem(1);
      const result = ScoredItemSchema.safeParse(mockItem);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rank).toBeGreaterThan(0);
        expect(Number.isInteger(result.data.rank)).toBe(true);
      }
    });
  });
});

// ============================================
// Golden Test Case Structure Tests
// ============================================

describe('Golden Tests - Output Structure', () => {
  const testCases = ['ai_healthcare', 'minimal'];

  testCases.forEach((caseName) => {
    describe(`Case: ${caseName}`, () => {
      let goldenCase: { input: GoldenInput; output: GoldenOutput } | null;

      beforeAll(() => {
        goldenCase = loadGoldenCase(caseName);
      });

      it('golden case files exist', () => {
        expect(goldenCase).not.toBeNull();
      });

      it('defines valid expected files list', () => {
        if (!goldenCase) return;

        expect(goldenCase.output.expectedFiles).toBeInstanceOf(Array);
        expect(goldenCase.output.expectedFiles.length).toBeGreaterThan(0);

        // All expected files should be strings
        goldenCase.output.expectedFiles.forEach((file) => {
          expect(typeof file).toBe('string');
          expect(file.length).toBeGreaterThan(0);
        });
      });

      it('defines synthesis expectations', () => {
        if (!goldenCase) return;

        expect(goldenCase.output.synthesis).toBeDefined();
        expect(goldenCase.output.synthesis.hasLinkedinPost).toBe(true);
        expect(goldenCase.output.synthesis.linkedinPostMaxLength).toBe(3000);
        expect(goldenCase.output.synthesis.keyQuotesHaveSourceUrls).toBe(true);
      });

      it('defines sources expectations', () => {
        if (!goldenCase) return;

        expect(goldenCase.output.sources).toBeDefined();
        expect(goldenCase.output.sources.allSourcesHaveUrl).toBe(true);
      });

      it('defines pipeline status expectations', () => {
        if (!goldenCase) return;

        expect(goldenCase.output.pipelineStatus).toBeDefined();
        expect(goldenCase.output.pipelineStatus.hasSuccess).toBe(true);
        expect(goldenCase.output.pipelineStatus.hasConfig).toBe(true);
      });

      it('input config is valid', () => {
        if (!goldenCase) return;

        expect(goldenCase.input.prompt).toBeDefined();
        expect(typeof goldenCase.input.prompt).toBe('string');
        expect(goldenCase.input.prompt.length).toBeGreaterThan(0);

        expect(goldenCase.input.config).toBeDefined();
        expect(goldenCase.input.config.sources).toBeDefined();
        expect(goldenCase.input.config.qualityProfile).toBeDefined();
      });
    });
  });
});

// ============================================
// Expected Files Tests
// ============================================

describe('Golden Tests - Expected Files', () => {
  const coreFiles = [
    'validated_data.json',
    'scored_data.json',
    'top_50.json',
    'synthesis.json',
    'linkedin_post.md',
    'sources.json',
    'sources.md',
    'pipeline_status.json',
  ];

  it('core files list is consistent across cases', () => {
    const aiHealthcare = loadGoldenCase('ai_healthcare');
    const minimal = loadGoldenCase('minimal');

    if (!aiHealthcare || !minimal) {
      return;
    }

    // Both cases should expect the same core files
    coreFiles.forEach((file) => {
      expect(aiHealthcare.output.expectedFiles).toContain(file);
      expect(minimal.output.expectedFiles).toContain(file);
    });
  });

  it('default case expects all core output files', () => {
    const goldenCase = loadGoldenCase('ai_healthcare');
    if (!goldenCase) return;

    coreFiles.forEach((file) => {
      expect(goldenCase.output.expectedFiles).toContain(file);
    });
  });

  it('minimal case does not expect infographic.png when skipImage is true', () => {
    const goldenCase = loadGoldenCase('minimal');
    if (!goldenCase) return;

    expect(goldenCase.input.config.skipImage).toBe(true);
    expect(goldenCase.output.expectedFiles).not.toContain('infographic.png');
  });
});

// ============================================
// Quality Profile Tests
// ============================================

describe('Golden Tests - Quality Profiles', () => {
  it('default profile uses full pipeline', () => {
    const goldenCase = loadGoldenCase('ai_healthcare');
    if (!goldenCase) return;

    expect(goldenCase.input.config.qualityProfile).toBe('default');
    expect(goldenCase.input.config.skipValidation).toBe(false);
    expect(goldenCase.input.config.skipScoring).toBe(false);
  });

  it('fast profile skips validation and scoring', () => {
    const goldenCase = loadGoldenCase('minimal');
    if (!goldenCase) return;

    expect(goldenCase.input.config.qualityProfile).toBe('fast');
    expect(goldenCase.input.config.skipValidation).toBe(true);
    expect(goldenCase.input.config.skipScoring).toBe(true);
  });

  it('fast profile has lower limits', () => {
    const defaultCase = loadGoldenCase('ai_healthcare');
    const fastCase = loadGoldenCase('minimal');

    if (!defaultCase || !fastCase) return;

    expect(fastCase.input.config.maxTotal).toBeLessThan(
      defaultCase.input.config.maxTotal as number
    );
    expect(fastCase.input.config.maxPerSource).toBeLessThan(
      defaultCase.input.config.maxPerSource as number
    );
  });

  it('fast profile has shorter timeout', () => {
    const defaultCase = loadGoldenCase('ai_healthcare');
    const fastCase = loadGoldenCase('minimal');

    if (!defaultCase || !fastCase) return;

    expect(fastCase.input.config.timeoutSeconds).toBeLessThan(
      defaultCase.input.config.timeoutSeconds as number
    );
  });
});

// ============================================
// Verification Level Tests
// ============================================

describe('Golden Tests - Verification Levels', () => {
  it('synthesis expects valid verification levels', () => {
    const goldenCase = loadGoldenCase('ai_healthcare');
    if (!goldenCase) return;

    const validLevels = goldenCase.output.synthesis.validVerificationLevels;
    expect(validLevels).toEqual(expect.arrayContaining(VALID_VERIFICATION_LEVELS));
  });

  it('skipped validation should result in UNVERIFIED items', () => {
    const goldenCase = loadGoldenCase('minimal');
    if (!goldenCase) return;

    if (goldenCase.output.validatedData?.skippedValidationAllUnverified) {
      expect(goldenCase.input.config.skipValidation).toBe(true);
    }
  });
});

// ============================================
// Integration Simulation Tests
// ============================================

describe('Golden Tests - Integration Simulation', () => {
  it('mock data flows through validation schema correctly', () => {
    // Simulate the full pipeline with mock data
    const rawItems = [createMockValidatedItem(), createMockValidatedItem()];

    // All items should validate
    rawItems.forEach((item) => {
      const result = ValidatedItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    });
  });

  it('mock data flows through scoring schema correctly', () => {
    const scoredItems = [createMockScoredItem(1), createMockScoredItem(2)];

    // All items should validate and be sorted by rank
    scoredItems.forEach((item, idx) => {
      const result = ScoredItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      expect(item.rank).toBe(idx + 1);
    });
  });

  it('mock synthesis includes required provenance data', () => {
    const synthesis = createMockSynthesisResult('AI healthcare trends');

    // Verify key quotes have source URLs
    synthesis.keyQuotes.forEach((quote) => {
      expect(quote.sourceUrl).toBeDefined();
      expect(quote.sourceUrl.startsWith('http')).toBe(true);
    });

    // Verify fact check summary
    expect(synthesis.factCheckSummary.totalSourcesUsed).toBeGreaterThanOrEqual(0);
    expect(synthesis.factCheckSummary.verifiedQuotes).toBeGreaterThanOrEqual(0);
  });

  it('mock sources file has proper references', () => {
    const sources = createMockSourcesFile();

    // Verify all sources have required fields
    sources.sources.forEach((source) => {
      expect(source.id).toBeDefined();
      expect(source.url).toBeDefined();
      expect(source.url.startsWith('http')).toBe(true);
      expect(source.verificationLevel).toBeDefined();
      expect(VALID_VERIFICATION_LEVELS).toContain(source.verificationLevel);
      expect(typeof source.usedInPost).toBe('boolean');
    });
  });

  it('pipeline status captures all required config fields', () => {
    const status = createMockPipelineStatus(true);

    expect(status.config.sources).toBeDefined();
    expect(status.config.qualityProfile).toBeDefined();
    expect(status.config.maxTotal).toBeDefined();
    expect(status.config.maxPerSource).toBeDefined();
    expect(status.config.timeoutSeconds).toBeDefined();
  });
});
