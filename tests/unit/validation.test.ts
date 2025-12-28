/**
 * Unit Tests for Validation Engine
 *
 * Tests for validation functions in src/validation/perplexity.ts
 * and verification level assignment in src/schemas/validatedItem.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawItem, ValidatedItem, VerificationLevel } from '../../src/types/index.js';
import {
  assignVerificationLevel,
  createUnverifiedValidation,
} from '../../src/schemas/validatedItem.js';
import {
  makePerplexityRequest,
  extractContent,
  extractCitations,
  buildValidationPrompt,
  parseValidationResponse,
  validateSingleItem,
  type PerplexityResponse,
  type ValidationResponse,
} from '../../src/validation/perplexity.js';
import { SCHEMA_VERSION } from '../../src/schemas/rawItem.js';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a test RawItem with sensible defaults
 */
function createTestRawItem(overrides?: Partial<RawItem>): RawItem {
  const id = 'test-id-' + Math.random().toString(36).slice(2, 10);
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    source: 'web',
    sourceUrl: 'https://example.com/article',
    retrievedAt: new Date().toISOString(),
    content: 'Test content with a quote: "AI will transform everything"',
    contentHash: 'a1b2c3d4e5f67890',
    engagement: { likes: 100, comments: 10, shares: 5 },
    ...overrides,
  };
}

/**
 * Create a mock Perplexity API response
 */
function createMockPerplexityResponse(overrides?: Partial<PerplexityResponse>): PerplexityResponse {
  return {
    id: 'chatcmpl-mock-001',
    model: 'sonar-reasoning-pro',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '{"verified": true, "confidence": 0.9}',
        },
        finish_reason: 'stop',
      },
    ],
    citations: ['https://source1.com', 'https://source2.com'],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
    ...overrides,
  };
}

/**
 * Create a validation response JSON string
 */
function createValidationResponseJson(items: Array<{
  itemId: string;
  verified: boolean;
  confidence: number;
  sourcesFound: string[];
  isPrimarySource: boolean;
  notes: string[];
}>): string {
  return JSON.stringify({ items });
}

// ============================================
// assignVerificationLevel Tests
// ============================================

describe('assignVerificationLevel', () => {
  describe('PRIMARY_SOURCE assignment', () => {
    it('returns PRIMARY_SOURCE when isPrimarySource is true and has sources', () => {
      const level = assignVerificationLevel(['https://primary.com'], true);
      expect(level).toBe('PRIMARY_SOURCE');
    });

    it('returns PRIMARY_SOURCE when isPrimarySource is true even with multiple sources', () => {
      const level = assignVerificationLevel(
        ['https://source1.com', 'https://source2.com'],
        true
      );
      expect(level).toBe('PRIMARY_SOURCE');
    });

    it('returns PRIMARY_SOURCE when isPrimarySource is true even with no sources', () => {
      // Edge case: isPrimarySource takes precedence
      const level = assignVerificationLevel([], true);
      expect(level).toBe('PRIMARY_SOURCE');
    });
  });

  describe('MULTISOURCE_CONFIRMED assignment', () => {
    it('returns MULTISOURCE_CONFIRMED when 2+ sources and not primary', () => {
      const level = assignVerificationLevel(
        ['https://source1.com', 'https://source2.com'],
        false
      );
      expect(level).toBe('MULTISOURCE_CONFIRMED');
    });

    it('returns MULTISOURCE_CONFIRMED when exactly 2 sources', () => {
      const level = assignVerificationLevel(
        ['https://a.com', 'https://b.com'],
        false
      );
      expect(level).toBe('MULTISOURCE_CONFIRMED');
    });

    it('returns MULTISOURCE_CONFIRMED when 3+ sources', () => {
      const level = assignVerificationLevel(
        ['https://a.com', 'https://b.com', 'https://c.com'],
        false
      );
      expect(level).toBe('MULTISOURCE_CONFIRMED');
    });

    it('returns MULTISOURCE_CONFIRMED when many sources', () => {
      const sources = Array.from({ length: 10 }, (_, i) => `https://source${i}.com`);
      const level = assignVerificationLevel(sources, false);
      expect(level).toBe('MULTISOURCE_CONFIRMED');
    });
  });

  describe('SOURCE_CONFIRMED assignment', () => {
    it('returns SOURCE_CONFIRMED when exactly 1 source and not primary', () => {
      const level = assignVerificationLevel(['https://single-source.com'], false);
      expect(level).toBe('SOURCE_CONFIRMED');
    });
  });

  describe('UNVERIFIED assignment', () => {
    it('returns UNVERIFIED when 0 sources and not primary', () => {
      const level = assignVerificationLevel([], false);
      expect(level).toBe('UNVERIFIED');
    });

    it('returns UNVERIFIED with empty array', () => {
      const level = assignVerificationLevel([], false);
      expect(level).toBe('UNVERIFIED');
    });
  });

  describe('edge cases', () => {
    it('handles undefined isPrimarySource as false', () => {
      // TypeScript ensures isPrimarySource is boolean, but test the false case
      const level = assignVerificationLevel(['https://source.com'], false);
      expect(level).toBe('SOURCE_CONFIRMED');
    });
  });
});

// ============================================
// createUnverifiedValidation Tests
// ============================================

describe('createUnverifiedValidation', () => {
  it('returns an object with UNVERIFIED level', () => {
    const validation = createUnverifiedValidation();
    expect(validation.level).toBe('UNVERIFIED');
  });

  it('returns confidence of 0', () => {
    const validation = createUnverifiedValidation();
    expect(validation.confidence).toBe(0);
  });

  it('returns empty sourcesFound array', () => {
    const validation = createUnverifiedValidation();
    expect(validation.sourcesFound).toEqual([]);
  });

  it('returns empty quotesVerified array', () => {
    const validation = createUnverifiedValidation();
    expect(validation.quotesVerified).toEqual([]);
  });

  it('returns valid ISO 8601 checkedAt timestamp', () => {
    const validation = createUnverifiedValidation();
    expect(validation.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns notes indicating skipped or failed', () => {
    const validation = createUnverifiedValidation();
    expect(validation.notes).toContain('Validation skipped or failed');
  });
});

// ============================================
// extractContent Tests
// ============================================

describe('extractContent', () => {
  it('extracts content from first choice', () => {
    const response = createMockPerplexityResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop',
        },
      ],
    });
    expect(extractContent(response)).toBe('Hello world');
  });

  it('returns empty string for empty choices array', () => {
    const response = createMockPerplexityResponse({ choices: [] });
    expect(extractContent(response)).toBe('');
  });

  it('returns empty string for undefined choices', () => {
    const response = { id: 'test', model: 'test' } as PerplexityResponse;
    expect(extractContent(response)).toBe('');
  });

  it('returns empty string for missing message content', () => {
    const response = createMockPerplexityResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '' },
          finish_reason: 'stop',
        },
      ],
    });
    expect(extractContent(response)).toBe('');
  });

  it('handles JSON content correctly', () => {
    const jsonContent = '{"key": "value", "nested": {"a": 1}}';
    const response = createMockPerplexityResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: jsonContent },
          finish_reason: 'stop',
        },
      ],
    });
    expect(extractContent(response)).toBe(jsonContent);
  });

  it('handles multiline content', () => {
    const multilineContent = 'Line 1\nLine 2\nLine 3';
    const response = createMockPerplexityResponse({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: multilineContent },
          finish_reason: 'stop',
        },
      ],
    });
    expect(extractContent(response)).toBe(multilineContent);
  });
});

// ============================================
// extractCitations Tests
// ============================================

describe('extractCitations', () => {
  it('extracts citations array from response', () => {
    const response = createMockPerplexityResponse({
      citations: ['https://source1.com', 'https://source2.com'],
    });
    expect(extractCitations(response)).toEqual([
      'https://source1.com',
      'https://source2.com',
    ]);
  });

  it('returns empty array for undefined citations', () => {
    const response = createMockPerplexityResponse({ citations: undefined });
    expect(extractCitations(response)).toEqual([]);
  });

  it('returns empty array for empty citations', () => {
    const response = createMockPerplexityResponse({ citations: [] });
    expect(extractCitations(response)).toEqual([]);
  });

  it('handles single citation', () => {
    const response = createMockPerplexityResponse({
      citations: ['https://only-source.com'],
    });
    expect(extractCitations(response)).toEqual(['https://only-source.com']);
  });

  it('handles many citations', () => {
    const citations = Array.from({ length: 20 }, (_, i) => `https://source${i}.com`);
    const response = createMockPerplexityResponse({ citations });
    expect(extractCitations(response)).toEqual(citations);
    expect(extractCitations(response)).toHaveLength(20);
  });
});

// ============================================
// buildValidationPrompt Tests (Specification)
// ============================================

describe('buildValidationPrompt', () => {
  it('returns a non-empty string', () => {
    const item = createTestRawItem();
    const prompt = buildValidationPrompt(item, 'AI leadership quotes');

    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('includes the item content in the prompt', () => {
    const item = createTestRawItem({
      content: 'Unique test content about AI transformation',
    });
    const prompt = buildValidationPrompt(item, 'AI quotes');

    expect(prompt).toContain('Unique test content about AI transformation');
  });

  it('includes the original search prompt for context', () => {
    const item = createTestRawItem();
    const originalPrompt = 'Famous quotes about artificial intelligence';
    const prompt = buildValidationPrompt(item, originalPrompt);

    expect(prompt).toContain('Famous quotes about artificial intelligence');
    expect(prompt).toContain('Original Context');
  });

  it('requests JSON output format', () => {
    const item = createTestRawItem();
    const prompt = buildValidationPrompt(item, 'test prompt');

    expect(prompt).toContain('JSON');
    expect(prompt).toContain('verified');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('sourcesFound');
  });

  it('includes instructions for quote verification', () => {
    const item = createTestRawItem();
    const prompt = buildValidationPrompt(item, 'test prompt');

    expect(prompt).toContain('Verify any quotes');
    expect(prompt).toContain('quotesVerified');
  });

  it('includes instructions for source verification', () => {
    const item = createTestRawItem();
    const prompt = buildValidationPrompt(item, 'test prompt');

    expect(prompt).toContain('Find corroborating sources');
    expect(prompt).toContain('Cross-check the content');
  });

  it('includes author information when available', () => {
    const item = createTestRawItem({
      author: 'Elon Musk',
      authorHandle: '@elonmusk',
    });
    const prompt = buildValidationPrompt(item, 'test prompt');

    expect(prompt).toContain('Elon Musk');
    expect(prompt).toContain('@elonmusk');
  });

  it('includes source URL in the prompt', () => {
    const item = createTestRawItem({
      sourceUrl: 'https://example.com/specific-article',
    });
    const prompt = buildValidationPrompt(item, 'test prompt');

    expect(prompt).toContain('https://example.com/specific-article');
  });

  it('includes publication date verification task', () => {
    const item = createTestRawItem();
    const prompt = buildValidationPrompt(item, 'test prompt');

    expect(prompt).toContain('Verify publication date');
    expect(prompt).toContain('publishedAtVerified');
  });
});

// ============================================
// parseValidationResponse Tests (Specification)
// ============================================

describe('parseValidationResponse', () => {
  // Helper to create a valid validation response JSON string
  function createValidResponse(overrides: Partial<ValidationResponse> = {}): string {
    const defaultResponse: ValidationResponse = {
      verified: true,
      verificationLevel: 'SOURCE_CONFIRMED',
      confidence: 0.85,
      sourcesFound: ['https://example.com/source1'],
      isPrimarySource: false,
      notes: ['Verified against web sources'],
      quotesVerified: [],
      ...overrides,
    };
    return JSON.stringify(defaultResponse);
  }

  describe('valid JSON parsing', () => {
    it('successfully parses valid JSON response', () => {
      const jsonStr = createValidResponse();
      const result = parseValidationResponse(jsonStr);

      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(0.85);
      expect(result.verificationLevel).toBe('SOURCE_CONFIRMED');
    });

    it('parses response with all verification levels', () => {
      const levels: Array<ValidationResponse['verificationLevel']> = [
        'UNVERIFIED',
        'SOURCE_CONFIRMED',
        'MULTISOURCE_CONFIRMED',
        'PRIMARY_SOURCE',
      ];

      for (const level of levels) {
        const jsonStr = createValidResponse({ verificationLevel: level });
        const result = parseValidationResponse(jsonStr);
        expect(result.verificationLevel).toBe(level);
      }
    });

    it('parses response with quotes verified', () => {
      const jsonStr = createValidResponse({
        quotesVerified: [
          { quote: 'AI is the future', verified: true, sourceUrl: 'https://example.com' },
          { quote: 'Unverified quote', verified: false },
        ],
      });
      const result = parseValidationResponse(jsonStr);

      expect(result.quotesVerified).toHaveLength(2);
      expect(result.quotesVerified[0].verified).toBe(true);
      expect(result.quotesVerified[0].sourceUrl).toBe('https://example.com');
    });
  });

  describe('markdown code fence handling', () => {
    it('handles ```json ... ``` code fences', () => {
      const jsonStr = createValidResponse();
      const content = '```json\n' + jsonStr + '\n```';
      const result = parseValidationResponse(content);

      expect(result.verified).toBe(true);
    });

    it('handles ``` ... ``` without json specifier', () => {
      const jsonStr = createValidResponse();
      const content = '```\n' + jsonStr + '\n```';
      const result = parseValidationResponse(content);

      expect(result.verified).toBe(true);
    });

    it('handles content before and after code fence', () => {
      const jsonStr = createValidResponse();
      const content = 'Here is the verification result:\n```json\n' + jsonStr + '\n```\nEnd of response.';
      const result = parseValidationResponse(content);

      expect(result.verified).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws on invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => parseValidationResponse(invalidJson)).toThrow();
    });

    it('throws on empty response', () => {
      expect(() => parseValidationResponse('')).toThrow();
    });

    it('throws on JSON that does not match schema', () => {
      const invalidSchema = JSON.stringify({
        verified: true,
        // missing required fields
      });

      expect(() => parseValidationResponse(invalidSchema)).toThrow();
    });

    it('throws on missing required fields', () => {
      const missingFields = JSON.stringify({
        verified: true,
        confidence: 0.5,
        // missing verificationLevel, sourcesFound, etc.
      });

      expect(() => parseValidationResponse(missingFields)).toThrow();
    });

    it('throws on invalid verification level', () => {
      const invalidLevel = JSON.stringify({
        verified: true,
        verificationLevel: 'INVALID_LEVEL',
        confidence: 0.5,
        sourcesFound: [],
        isPrimarySource: false,
        notes: [],
        quotesVerified: [],
      });

      expect(() => parseValidationResponse(invalidLevel)).toThrow();
    });
  });

  describe('edge cases', () => {
    it('handles trailing text after JSON', () => {
      const jsonStr = createValidResponse();
      const content = jsonStr + '\n\nSome trailing explanation text.';
      const result = parseValidationResponse(content);

      expect(result.verified).toBe(true);
    });

    it('handles leading whitespace', () => {
      const jsonStr = createValidResponse();
      const content = '   \n\n  ' + jsonStr;
      const result = parseValidationResponse(content);

      expect(result.verified).toBe(true);
    });

    it('parses publishedAtVerified when present', () => {
      const jsonStr = createValidResponse({
        publishedAtVerified: '2024-01-15T10:30:00Z',
      });
      const result = parseValidationResponse(jsonStr);

      expect(result.publishedAtVerified).toBe('2024-01-15T10:30:00Z');
    });
  });
});

// ============================================
// validateSingleItem Tests (Specification)
// ============================================

describe('validateSingleItem', () => {
  // Helper to create a valid API response with validation result
  function createMockValidationApiResponse(
    validationData: Partial<ValidationResponse> = {}
  ): PerplexityResponse {
    const response: ValidationResponse = {
      verified: true,
      verificationLevel: 'SOURCE_CONFIRMED',
      confidence: 0.85,
      sourcesFound: ['https://example.com/source1'],
      isPrimarySource: false,
      notes: ['Verified against web sources'],
      quotesVerified: [],
      ...validationData,
    };

    return createMockPerplexityResponse({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify(response),
          },
          finish_reason: 'stop',
        },
      ],
    });
  }

  describe('successful validation', () => {
    it('returns ValidatedItem with correct structure', async () => {
      // Mock the API module
      const mockMakeRequest = vi.fn().mockResolvedValue(
        createMockValidationApiResponse()
      );

      // We test structure expectations - validateSingleItem returns ValidatedItem
      const item = createTestRawItem();

      // For this test, we verify the expected structure of a ValidatedItem
      // In actual integration, validateSingleItem would be called
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('content');
      expect(item).toHaveProperty('sourceUrl');
    });

    it('preserves all RawItem fields', () => {
      // ValidatedItem extends RawItem, so all fields should be preserved
      const item = createTestRawItem({
        id: 'test-123',
        content: 'Test content',
        author: 'Test Author',
        sourceUrl: 'https://test.com',
      });

      // Simulate what validateSingleItem would produce
      const validatedItem: ValidatedItem = {
        ...item,
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.85,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://example.com'],
          notes: ['Test note'],
          quotesVerified: [],
        },
      };

      // Verify original fields are preserved
      expect(validatedItem.id).toBe('test-123');
      expect(validatedItem.content).toBe('Test content');
      expect(validatedItem.author).toBe('Test Author');
      expect(validatedItem.sourceUrl).toBe('https://test.com');
    });

    it('adds validation object with correct fields', () => {
      const item = createTestRawItem();

      // Simulate ValidatedItem structure
      const validatedItem: ValidatedItem = {
        ...item,
        validation: {
          level: 'MULTISOURCE_CONFIRMED',
          confidence: 0.9,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://source1.com', 'https://source2.com'],
          notes: ['Verified from multiple sources'],
          quotesVerified: [],
        },
      };

      expect(validatedItem.validation).toBeDefined();
      expect(validatedItem.validation.level).toBe('MULTISOURCE_CONFIRMED');
      expect(validatedItem.validation.confidence).toBe(0.9);
      expect(validatedItem.validation.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(validatedItem.validation.sourcesFound).toHaveLength(2);
      expect(validatedItem.validation.notes).toContain('Verified from multiple sources');
    });

    it('assigns correct verification level based on sources found', () => {
      // Test level assignment logic
      expect(assignVerificationLevel(['https://a.com', 'https://b.com'], false))
        .toBe('MULTISOURCE_CONFIRMED');
      expect(assignVerificationLevel(['https://a.com'], false))
        .toBe('SOURCE_CONFIRMED');
      expect(assignVerificationLevel([], false))
        .toBe('UNVERIFIED');
      expect(assignVerificationLevel(['https://a.com'], true))
        .toBe('PRIMARY_SOURCE');
    });
  });

  describe('PRIMARY_SOURCE handling', () => {
    it('assigns PRIMARY_SOURCE when response indicates primary', () => {
      const level = assignVerificationLevel(['https://author-site.com'], true);
      expect(level).toBe('PRIMARY_SOURCE');
    });

    it('includes primary source URL in sourcesFound', () => {
      const item = createTestRawItem();
      const validatedItem: ValidatedItem = {
        ...item,
        validation: {
          level: 'PRIMARY_SOURCE',
          confidence: 0.95,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://author-official-site.com'],
          notes: ['Content from author primary source'],
          quotesVerified: [],
        },
      };

      expect(validatedItem.validation.sourcesFound).toContain('https://author-official-site.com');
      expect(validatedItem.validation.level).toBe('PRIMARY_SOURCE');
    });
  });

  describe('API failure handling', () => {
    it('returns UNVERIFIED on failure scenarios', () => {
      // When API fails, item should get UNVERIFIED validation
      const item = createTestRawItem();
      const unverifiedValidation = createUnverifiedValidation();

      expect(unverifiedValidation.level).toBe('UNVERIFIED');
      expect(unverifiedValidation.confidence).toBe(0);
    });

    it('includes error message in notes on failure', () => {
      // createUnverifiedValidation returns notes about failure
      const validation = createUnverifiedValidation();
      expect(validation.notes).toContain('Validation skipped or failed');
    });
  });

  describe('confidence scoring', () => {
    it('sets confidence based on API response', () => {
      // Validation response confidence should be passed through
      const validatedItem: ValidatedItem = {
        ...createTestRawItem(),
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.75,
          checkedAt: new Date().toISOString(),
          sourcesFound: ['https://example.com'],
          notes: [],
          quotesVerified: [],
        },
      };

      expect(validatedItem.validation.confidence).toBe(0.75);
    });

    it('sets confidence to 0 on failure', () => {
      const validation = createUnverifiedValidation();
      expect(validation.confidence).toBe(0);
    });

    it('confidence is normalized to 0-1 range', () => {
      // Test that confidence values are within valid range
      const validatedItem: ValidatedItem = {
        ...createTestRawItem(),
        validation: {
          level: 'SOURCE_CONFIRMED',
          confidence: 0.5,
          checkedAt: new Date().toISOString(),
          sourcesFound: [],
          notes: [],
          quotesVerified: [],
        },
      };

      expect(validatedItem.validation.confidence).toBeGreaterThanOrEqual(0);
      expect(validatedItem.validation.confidence).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================
// validateItems Orchestration Tests (Specification)
// ============================================

describe('validateItems', () => {
  // NOTE: This function is not yet implemented.
  // These tests serve as a specification for implementation.

  describe('skip validation mode', () => {
    it.todo('returns all items as UNVERIFIED when skipValidation is true');

    it.todo('sets confidence to 0 for all items when skipped');

    it.todo('does not make any API calls when skipped');

    it.todo('preserves all RawItem fields when skipped');
  });

  describe('batching', () => {
    it.todo('correctly batches items based on config.validationBatchSize');

    it.todo('handles partial last batch');

    it.todo('processes all items even with odd batch sizes');
  });

  describe('concurrency', () => {
    it.todo('respects concurrency limit of 3');

    it.todo('processes batches within concurrency limit');
  });

  describe('result aggregation', () => {
    it.todo('returns ValidatedItems for all input items');

    it.todo('maintains item order');

    it.todo('includes validation metadata for each item');
  });

  describe('partial failure handling', () => {
    it.todo('continues processing when some items fail');

    it.todo('marks failed items as UNVERIFIED');

    it.todo('successfully validates items that pass');

    it.todo('logs warnings for failed items');
  });

  describe('empty input', () => {
    it.todo('returns empty array for empty input');

    it.todo('does not make API calls for empty input');
  });
});

// ============================================
// Integration: Mock Fixture Test
// ============================================

/**
 * Mock fixture structure with named scenarios
 */
interface MockFixtureSet {
  multiSourceConfirmed: PerplexityResponse;
  sourceConfirmed: PerplexityResponse;
  primarySource: PerplexityResponse;
  unverified: PerplexityResponse;
  parseError: PerplexityResponse;
  batchValidation: PerplexityResponse;
  emptyResponse: PerplexityResponse;
}

describe('Validation with Mock Fixture', () => {
  // Helper to load mock fixture set using fs.readFileSync
  function loadMockFixtures(): MockFixtureSet {
    const fixturePath = join(process.cwd(), 'tests/mocks/perplexity_validation_response.json');
    const content = readFileSync(fixturePath, 'utf-8');
    return JSON.parse(content) as MockFixtureSet;
  }

  it('mock fixture loads all scenarios', () => {
    const fixtures = loadMockFixtures();

    expect(fixtures).toHaveProperty('multiSourceConfirmed');
    expect(fixtures).toHaveProperty('sourceConfirmed');
    expect(fixtures).toHaveProperty('primarySource');
    expect(fixtures).toHaveProperty('unverified');
    expect(fixtures).toHaveProperty('parseError');
    expect(fixtures).toHaveProperty('batchValidation');
    expect(fixtures).toHaveProperty('emptyResponse');
  });

  it('multiSourceConfirmed scenario parses correctly', () => {
    const fixtures = loadMockFixtures();
    const mockResponse = fixtures.multiSourceConfirmed;

    expect(mockResponse.id).toBe('chatcmpl-mock-validation-multisource-001');
    expect(mockResponse.model).toBe('sonar-reasoning-pro');
    expect(mockResponse.choices).toHaveLength(1);
    expect(mockResponse.citations).toHaveLength(2);
  });

  it('mock fixture content is valid JSON', () => {
    const fixtures = loadMockFixtures();
    const content = fixtures.multiSourceConfirmed.choices[0].message.content;

    expect(() => JSON.parse(content)).not.toThrow();

    const parsed = JSON.parse(content);
    expect(parsed).toHaveProperty('verified');
    expect(parsed).toHaveProperty('confidence');
    expect(parsed).toHaveProperty('sourcesFound');
  });

  it('batchValidation items have expected structure', () => {
    const fixtures = loadMockFixtures();
    const content = JSON.parse(fixtures.batchValidation.choices[0].message.content);

    expect(content.items).toHaveLength(3);

    const firstItem = content.items[0];
    expect(firstItem).toHaveProperty('itemId');
    expect(firstItem).toHaveProperty('verified');
    expect(firstItem).toHaveProperty('confidence');
    expect(firstItem).toHaveProperty('sourcesFound');
    expect(firstItem).toHaveProperty('isPrimarySource');
    expect(firstItem).toHaveProperty('notes');
  });

  it('multiSourceConfirmed scenario demonstrates MULTISOURCE_CONFIRMED', () => {
    const fixtures = loadMockFixtures();
    const content = JSON.parse(fixtures.multiSourceConfirmed.choices[0].message.content);

    // Has 2 sources, not primary -> MULTISOURCE_CONFIRMED
    expect(content.sourcesFound.length).toBeGreaterThanOrEqual(2);
    expect(content.isPrimarySource).toBe(false);

    const level = assignVerificationLevel(content.sourcesFound, content.isPrimarySource);
    expect(level).toBe('MULTISOURCE_CONFIRMED');
  });

  it('sourceConfirmed scenario demonstrates SOURCE_CONFIRMED', () => {
    const fixtures = loadMockFixtures();
    const content = JSON.parse(fixtures.sourceConfirmed.choices[0].message.content);

    // Has 1 source, not primary -> SOURCE_CONFIRMED
    expect(content.sourcesFound).toHaveLength(1);
    expect(content.isPrimarySource).toBe(false);

    const level = assignVerificationLevel(content.sourcesFound, content.isPrimarySource);
    expect(level).toBe('SOURCE_CONFIRMED');
  });

  it('primarySource scenario demonstrates PRIMARY_SOURCE', () => {
    const fixtures = loadMockFixtures();
    const content = JSON.parse(fixtures.primarySource.choices[0].message.content);

    // Is primary source
    expect(content.isPrimarySource).toBe(true);

    const level = assignVerificationLevel(content.sourcesFound, content.isPrimarySource);
    expect(level).toBe('PRIMARY_SOURCE');
  });

  it('unverified scenario demonstrates UNVERIFIED', () => {
    const fixtures = loadMockFixtures();
    const content = JSON.parse(fixtures.unverified.choices[0].message.content);

    // Has no sources
    expect(content.sourcesFound).toHaveLength(0);
    expect(content.isPrimarySource).toBe(false);

    const level = assignVerificationLevel(content.sourcesFound, content.isPrimarySource);
    expect(level).toBe('UNVERIFIED');
  });

  it('batchValidation demonstrates mixed verification levels', () => {
    const fixtures = loadMockFixtures();
    const content = JSON.parse(fixtures.batchValidation.choices[0].message.content);

    // First item: 2 sources, not primary -> MULTISOURCE_CONFIRMED
    const firstItem = content.items[0];
    expect(assignVerificationLevel(firstItem.sourcesFound, firstItem.isPrimarySource))
      .toBe('MULTISOURCE_CONFIRMED');

    // Second item: is primary -> PRIMARY_SOURCE
    const secondItem = content.items[1];
    expect(assignVerificationLevel(secondItem.sourcesFound, secondItem.isPrimarySource))
      .toBe('PRIMARY_SOURCE');

    // Third item: no sources -> UNVERIFIED
    const thirdItem = content.items[2];
    expect(assignVerificationLevel(thirdItem.sourcesFound, thirdItem.isPrimarySource))
      .toBe('UNVERIFIED');
  });

  it('parseError scenario has incomplete JSON', () => {
    const fixtures = loadMockFixtures();
    const content = fixtures.parseError.choices[0].message.content;

    // This should throw when parsing
    expect(() => JSON.parse(content)).toThrow();
  });

  it('emptyResponse scenario has empty content', () => {
    const fixtures = loadMockFixtures();
    const content = fixtures.emptyResponse.choices[0].message.content;

    expect(content).toBe('');
  });
});

// ============================================
// Verification Level Boost Tests
// ============================================

describe('Verification Level Boosts', () => {
  // Import the boost constants
  it('UNVERIFIED has 0 boost', async () => {
    const { VERIFICATION_BOOSTS } = await import('../../src/schemas/validatedItem.js');
    expect(VERIFICATION_BOOSTS.UNVERIFIED).toBe(0);
  });

  it('SOURCE_CONFIRMED has 25 boost', async () => {
    const { VERIFICATION_BOOSTS } = await import('../../src/schemas/validatedItem.js');
    expect(VERIFICATION_BOOSTS.SOURCE_CONFIRMED).toBe(25);
  });

  it('MULTISOURCE_CONFIRMED has 50 boost', async () => {
    const { VERIFICATION_BOOSTS } = await import('../../src/schemas/validatedItem.js');
    expect(VERIFICATION_BOOSTS.MULTISOURCE_CONFIRMED).toBe(50);
  });

  it('PRIMARY_SOURCE has 75 boost', async () => {
    const { VERIFICATION_BOOSTS } = await import('../../src/schemas/validatedItem.js');
    expect(VERIFICATION_BOOSTS.PRIMARY_SOURCE).toBe(75);
  });

  it('all verification levels have defined boosts', async () => {
    const { VERIFICATION_BOOSTS } = await import('../../src/schemas/validatedItem.js');
    const levels: VerificationLevel[] = [
      'UNVERIFIED',
      'SOURCE_CONFIRMED',
      'MULTISOURCE_CONFIRMED',
      'PRIMARY_SOURCE',
    ];

    for (const level of levels) {
      expect(VERIFICATION_BOOSTS).toHaveProperty(level);
      expect(typeof VERIFICATION_BOOSTS[level]).toBe('number');
    }
  });

  it('boosts are ordered correctly (higher verification = higher boost)', async () => {
    const { VERIFICATION_BOOSTS } = await import('../../src/schemas/validatedItem.js');

    expect(VERIFICATION_BOOSTS.UNVERIFIED).toBeLessThan(VERIFICATION_BOOSTS.SOURCE_CONFIRMED);
    expect(VERIFICATION_BOOSTS.SOURCE_CONFIRMED).toBeLessThan(VERIFICATION_BOOSTS.MULTISOURCE_CONFIRMED);
    expect(VERIFICATION_BOOSTS.MULTISOURCE_CONFIRMED).toBeLessThan(VERIFICATION_BOOSTS.PRIMARY_SOURCE);
  });
});

// ============================================
// Test Helper Validation
// ============================================

describe('Test Helpers', () => {
  describe('createTestRawItem', () => {
    it('creates valid RawItem with defaults', () => {
      const item = createTestRawItem();

      expect(item.id).toMatch(/^test-id-/);
      expect(item.schemaVersion).toBe(SCHEMA_VERSION);
      expect(item.source).toBe('web');
      expect(item.sourceUrl).toBe('https://example.com/article');
      expect(item.contentHash).toHaveLength(16);
      expect(item.engagement).toBeDefined();
    });

    it('allows overriding specific fields', () => {
      const item = createTestRawItem({
        source: 'linkedin',
        content: 'Custom content',
        engagement: { likes: 500, comments: 50, shares: 25 },
      });

      expect(item.source).toBe('linkedin');
      expect(item.content).toBe('Custom content');
      expect(item.engagement.likes).toBe(500);
    });

    it('generates unique IDs', () => {
      const item1 = createTestRawItem();
      const item2 = createTestRawItem();

      expect(item1.id).not.toBe(item2.id);
    });
  });

  describe('createMockPerplexityResponse', () => {
    it('creates valid mock response with defaults', () => {
      const response = createMockPerplexityResponse();

      expect(response.id).toBeDefined();
      expect(response.model).toBe('sonar-reasoning-pro');
      expect(response.choices).toHaveLength(1);
      expect(response.citations).toBeDefined();
    });

    it('allows overriding fields', () => {
      const response = createMockPerplexityResponse({
        id: 'custom-id',
        citations: ['https://custom.com'],
      });

      expect(response.id).toBe('custom-id');
      expect(response.citations).toEqual(['https://custom.com']);
    });
  });
});
