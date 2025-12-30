/**
 * Unit Tests for Refinement Module Zod Schemas
 *
 * Comprehensive tests for all schema definitions in src/refinement/schemas.ts:
 * - RefinementModelSchema
 * - RefinementConfigSchema
 * - PromptAnalysisSchema
 * - RefinementResponseSchema
 * - UserActionSchema
 * - UserResponseSchema
 * - UserAnswersSchema
 * - RefinementResultSchema
 * - Validation helpers
 */

import { describe, it, expect } from 'vitest';
import {
  RefinementModelSchema,
  RefinementConfigSchema,
  PromptAnalysisSchema,
  RefinementResponseSchema,
  UserActionSchema,
  UserResponseSchema,
  UserAnswersSchema,
  RefinementResultSchema,
  isValidRefinementModel,
  parsePromptAnalysis,
  parseRefinementResponse,
  formatValidationError,
} from '../../src/refinement/schemas.js';

// ============================================
// Test Helpers
// ============================================

/**
 * Create a valid PromptAnalysis for testing (clear case)
 */
function createValidClearAnalysis() {
  return {
    isClear: true,
    confidence: 0.9,
    suggestedRefinement: 'Find recent AI leadership quotes from tech executives for a LinkedIn post about innovation.',
    reasoning: 'The prompt is clear with specific topic and intent for professional content creation.',
  };
}

/**
 * Create a valid PromptAnalysis for testing (unclear case)
 */
function createValidUnclearAnalysis() {
  return {
    isClear: false,
    confidence: 0.4,
    clarifyingQuestions: [
      'What specific industry or sector should the quotes focus on?',
      'Do you want recent quotes from the past year or all-time notable quotes?',
    ],
    reasoning: 'The prompt lacks specificity about the target audience and timeframe for quotes.',
  };
}

/**
 * Create a valid RefinementConfig for testing
 */
function createValidConfig() {
  return {
    skip: false,
    model: 'gemini' as const,
    maxIterations: 3,
    timeoutMs: 30000,
  };
}

/**
 * Create a valid RefinementResponse for testing
 */
function createValidRefinementResponse() {
  return {
    refinedPrompt: 'Find AI leadership quotes from Fortune 500 tech CEOs from the past 6 months for a LinkedIn post.',
    reasoning: 'Incorporated user preference for Fortune 500 companies and recent timeframe of 6 months.',
  };
}

/**
 * Create a valid RefinementResult for testing
 */
function createValidRefinementResult() {
  return {
    refinedPrompt: 'Find AI leadership quotes from tech executives for a LinkedIn post.',
    originalPrompt: 'AI quotes for LinkedIn',
    wasRefined: true,
    iterationCount: 2,
    modelUsed: 'gemini' as const,
    processingTimeMs: 5432,
  };
}

// ============================================
// RefinementModelSchema Tests
// ============================================

describe('RefinementModelSchema', () => {
  describe('valid model values', () => {
    it('accepts gemini', () => {
      expect(RefinementModelSchema.safeParse('gemini').success).toBe(true);
    });

    it('accepts gpt', () => {
      expect(RefinementModelSchema.safeParse('gpt').success).toBe(true);
    });

    it('accepts claude', () => {
      expect(RefinementModelSchema.safeParse('claude').success).toBe(true);
    });

    it('accepts kimi2', () => {
      expect(RefinementModelSchema.safeParse('kimi2').success).toBe(true);
    });
  });

  describe('invalid model values', () => {
    it('rejects openai', () => {
      expect(RefinementModelSchema.safeParse('openai').success).toBe(false);
    });

    it('rejects anthropic', () => {
      expect(RefinementModelSchema.safeParse('anthropic').success).toBe(false);
    });

    it('rejects empty string', () => {
      expect(RefinementModelSchema.safeParse('').success).toBe(false);
    });

    it('rejects gpt-4', () => {
      expect(RefinementModelSchema.safeParse('gpt-4').success).toBe(false);
    });

    it('rejects numeric values', () => {
      expect(RefinementModelSchema.safeParse(123).success).toBe(false);
    });

    it('rejects null', () => {
      expect(RefinementModelSchema.safeParse(null).success).toBe(false);
    });

    it('rejects undefined', () => {
      expect(RefinementModelSchema.safeParse(undefined).success).toBe(false);
    });
  });
});

// ============================================
// RefinementConfigSchema Tests
// ============================================

describe('RefinementConfigSchema', () => {
  describe('valid configurations', () => {
    it('validates config with all fields', () => {
      const config = createValidConfig();
      expect(RefinementConfigSchema.safeParse(config).success).toBe(true);
    });

    it('validates config with skip=true', () => {
      const config = { ...createValidConfig(), skip: true };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(true);
    });

    it('validates config with maxIterations=1 (min)', () => {
      const config = { ...createValidConfig(), maxIterations: 1 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(true);
    });

    it('validates config with maxIterations=10 (max)', () => {
      const config = { ...createValidConfig(), maxIterations: 10 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(true);
    });

    it('validates config with timeoutMs=5000 (min)', () => {
      const config = { ...createValidConfig(), timeoutMs: 5000 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(true);
    });

    it('validates config with timeoutMs=120000 (max)', () => {
      const config = { ...createValidConfig(), timeoutMs: 120000 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(true);
    });

    it('validates config with all model types', () => {
      const models = ['gemini', 'gpt', 'claude', 'kimi2'] as const;
      for (const model of models) {
        const config = { ...createValidConfig(), model };
        expect(RefinementConfigSchema.safeParse(config).success).toBe(true);
      }
    });
  });

  describe('invalid maxIterations', () => {
    it('rejects maxIterations=0', () => {
      const config = { ...createValidConfig(), maxIterations: 0 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects maxIterations=11', () => {
      const config = { ...createValidConfig(), maxIterations: 11 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects negative maxIterations', () => {
      const config = { ...createValidConfig(), maxIterations: -1 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects non-integer maxIterations', () => {
      const config = { ...createValidConfig(), maxIterations: 5.5 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });
  });

  describe('invalid timeoutMs', () => {
    it('rejects timeoutMs below 5000', () => {
      const config = { ...createValidConfig(), timeoutMs: 4999 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects timeoutMs above 120000', () => {
      const config = { ...createValidConfig(), timeoutMs: 120001 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects negative timeoutMs', () => {
      const config = { ...createValidConfig(), timeoutMs: -1000 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects non-integer timeoutMs', () => {
      const config = { ...createValidConfig(), timeoutMs: 30000.5 };
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });
  });

  describe('missing required fields', () => {
    it('rejects missing skip', () => {
      const { skip: _, ...config } = createValidConfig();
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects missing model', () => {
      const { model: _, ...config } = createValidConfig();
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects missing maxIterations', () => {
      const { maxIterations: _, ...config } = createValidConfig();
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });

    it('rejects missing timeoutMs', () => {
      const { timeoutMs: _, ...config } = createValidConfig();
      expect(RefinementConfigSchema.safeParse(config).success).toBe(false);
    });
  });
});

// ============================================
// PromptAnalysisSchema Tests
// ============================================

describe('PromptAnalysisSchema', () => {
  describe('valid clear prompt analysis', () => {
    it('validates clear prompt with suggestedRefinement', () => {
      const analysis = createValidClearAnalysis();
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('validates clear prompt without suggestedRefinement', () => {
      const analysis = {
        isClear: true,
        confidence: 0.95,
        reasoning: 'The prompt is perfectly clear and specific enough to proceed.',
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('validates clear prompt with detectedIntents', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        detectedIntents: ['content creation', 'professional networking'],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });
  });

  describe('valid ambiguous prompt analysis', () => {
    it('validates unclear prompt with 2 clarifying questions', () => {
      const analysis = createValidUnclearAnalysis();
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('validates unclear prompt with 3 clarifying questions', () => {
      const analysis = {
        ...createValidUnclearAnalysis(),
        clarifyingQuestions: [
          'What specific industry should the quotes focus on?',
          'Do you want quotes from the past year or all-time?',
          'Should the quotes be from CEOs only or any executives?',
        ],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('validates unclear prompt with 4 clarifying questions (max)', () => {
      const analysis = {
        ...createValidUnclearAnalysis(),
        clarifyingQuestions: [
          'What specific industry should the quotes focus on?',
          'Do you want quotes from the past year or all-time?',
          'Should the quotes be from CEOs only or any executives?',
          'What tone are you looking for - inspirational or data-driven?',
        ],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });
  });

  describe('invalid confidence values', () => {
    it('rejects confidence below 0', () => {
      const analysis = { ...createValidClearAnalysis(), confidence: -0.1 };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects confidence above 1', () => {
      const analysis = { ...createValidClearAnalysis(), confidence: 1.1 };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });
  });

  describe('edge cases for confidence', () => {
    it('accepts confidence at exactly 0.0', () => {
      const analysis = { ...createValidClearAnalysis(), confidence: 0.0 };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('accepts confidence at exactly 1.0', () => {
      const analysis = { ...createValidClearAnalysis(), confidence: 1.0 };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('accepts confidence at 0.5', () => {
      const analysis = { ...createValidClearAnalysis(), confidence: 0.5 };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });
  });

  describe('unclear prompt without clarifyingQuestions', () => {
    it('rejects isClear=false without clarifyingQuestions', () => {
      const analysis = {
        isClear: false,
        confidence: 0.3,
        reasoning: 'The prompt needs more details to proceed effectively.',
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects isClear=false with empty clarifyingQuestions array', () => {
      const analysis = {
        isClear: false,
        confidence: 0.3,
        clarifyingQuestions: [],
        reasoning: 'The prompt needs more details to proceed effectively.',
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects isClear=false with only 1 clarifying question', () => {
      const analysis = {
        isClear: false,
        confidence: 0.4,
        clarifyingQuestions: [
          'What specific industry should the quotes focus on?',
        ],
        reasoning: 'The prompt needs more details to proceed effectively.',
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });
  });

  describe('clarifyingQuestions validation', () => {
    it('rejects question shorter than 10 characters', () => {
      const analysis = {
        ...createValidUnclearAnalysis(),
        clarifyingQuestions: [
          'Short?', // Too short
          'What specific industry should the quotes focus on?',
        ],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects question longer than 500 characters', () => {
      const analysis = {
        ...createValidUnclearAnalysis(),
        clarifyingQuestions: [
          'A'.repeat(501), // Too long
          'What specific industry should the quotes focus on?',
        ],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects more than 4 clarifying questions', () => {
      const analysis = {
        ...createValidUnclearAnalysis(),
        clarifyingQuestions: [
          'What specific industry should the quotes focus on?',
          'Do you want quotes from the past year or all-time?',
          'Should the quotes be from CEOs only or any executives?',
          'What tone are you looking for - inspirational or data-driven?',
          'Do you need quotes with source links or just text?', // 5th - too many
        ],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });
  });

  describe('suggestedRefinement validation', () => {
    it('rejects suggestedRefinement shorter than 10 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        suggestedRefinement: 'Too short',
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects suggestedRefinement longer than 3000 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        suggestedRefinement: 'A'.repeat(3001),
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('accepts suggestedRefinement at exactly 3000 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        suggestedRefinement: 'A'.repeat(3000),
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });
  });

  describe('reasoning validation', () => {
    it('rejects reasoning shorter than 10 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        reasoning: 'Short',
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects reasoning longer than 1500 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        reasoning: 'A'.repeat(1501),
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('accepts reasoning at exactly 1500 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        reasoning: 'A'.repeat(1500),
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('rejects missing reasoning', () => {
      const { reasoning: _, ...analysis } = createValidClearAnalysis();
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });
  });

  describe('detectedIntents validation', () => {
    it('accepts detectedIntents with valid entries', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        detectedIntents: ['content creation', 'professional networking', 'thought leadership'],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('rejects intent shorter than 2 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        detectedIntents: ['a'], // Too short
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('rejects intent longer than 300 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        detectedIntents: ['A'.repeat(301)], // Too long
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('accepts intent at exactly 300 characters', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        detectedIntents: ['A'.repeat(300)],
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });

    it('rejects more than 10 detected intents', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        detectedIntents: Array(11).fill('valid intent text'),
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(false);
    });

    it('accepts up to 10 detected intents', () => {
      const analysis = {
        ...createValidClearAnalysis(),
        detectedIntents: Array(10).fill('valid intent text'),
      };
      expect(PromptAnalysisSchema.safeParse(analysis).success).toBe(true);
    });
  });
});

// ============================================
// RefinementResponseSchema Tests
// ============================================

describe('RefinementResponseSchema', () => {
  describe('valid responses', () => {
    it('validates response with all required fields', () => {
      const response = createValidRefinementResponse();
      expect(RefinementResponseSchema.safeParse(response).success).toBe(true);
    });

    it('validates response with detectedIntents', () => {
      const response = {
        ...createValidRefinementResponse(),
        detectedIntents: ['leadership content', 'tech industry'],
      };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('invalid refinedPrompt', () => {
    it('rejects refinedPrompt shorter than 10 characters', () => {
      const response = { ...createValidRefinementResponse(), refinedPrompt: 'Too short' };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(false);
    });

    it('rejects refinedPrompt longer than 3000 characters', () => {
      const response = { ...createValidRefinementResponse(), refinedPrompt: 'A'.repeat(3001) };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(false);
    });

    it('accepts refinedPrompt at exactly 10 characters', () => {
      const response = { ...createValidRefinementResponse(), refinedPrompt: 'A'.repeat(10) };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(true);
    });

    it('accepts refinedPrompt at exactly 3000 characters', () => {
      const response = { ...createValidRefinementResponse(), refinedPrompt: 'A'.repeat(3000) };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('missing required fields', () => {
    it('rejects missing refinedPrompt', () => {
      const { refinedPrompt: _, ...response } = createValidRefinementResponse();
      expect(RefinementResponseSchema.safeParse(response).success).toBe(false);
    });

    it('rejects missing reasoning', () => {
      const { reasoning: _, ...response } = createValidRefinementResponse();
      expect(RefinementResponseSchema.safeParse(response).success).toBe(false);
    });
  });

  describe('invalid reasoning', () => {
    it('rejects reasoning shorter than 10 characters', () => {
      const response = { ...createValidRefinementResponse(), reasoning: 'Short' };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(false);
    });

    it('rejects reasoning longer than 1500 characters', () => {
      const response = { ...createValidRefinementResponse(), reasoning: 'A'.repeat(1501) };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(false);
    });
  });

  describe('detectedIntents validation', () => {
    it('accepts empty detectedIntents array', () => {
      const response = { ...createValidRefinementResponse(), detectedIntents: [] };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(true);
    });

    it('rejects intent longer than 300 characters', () => {
      const response = {
        ...createValidRefinementResponse(),
        detectedIntents: ['A'.repeat(301)],
      };
      expect(RefinementResponseSchema.safeParse(response).success).toBe(false);
    });
  });
});

// ============================================
// UserActionSchema Tests
// ============================================

describe('UserActionSchema', () => {
  describe('valid actions', () => {
    it('accepts accept', () => {
      expect(UserActionSchema.safeParse('accept').success).toBe(true);
    });

    it('accepts reject', () => {
      expect(UserActionSchema.safeParse('reject').success).toBe(true);
    });

    it('accepts feedback', () => {
      expect(UserActionSchema.safeParse('feedback').success).toBe(true);
    });
  });

  describe('invalid actions', () => {
    it('rejects cancel', () => {
      expect(UserActionSchema.safeParse('cancel').success).toBe(false);
    });

    it('rejects skip', () => {
      expect(UserActionSchema.safeParse('skip').success).toBe(false);
    });

    it('rejects empty string', () => {
      expect(UserActionSchema.safeParse('').success).toBe(false);
    });

    it('rejects uppercase variants', () => {
      expect(UserActionSchema.safeParse('Accept').success).toBe(false);
      expect(UserActionSchema.safeParse('ACCEPT').success).toBe(false);
    });

    it('rejects numeric values', () => {
      expect(UserActionSchema.safeParse(1).success).toBe(false);
    });

    it('rejects null', () => {
      expect(UserActionSchema.safeParse(null).success).toBe(false);
    });
  });
});

// ============================================
// UserResponseSchema Tests
// ============================================

describe('UserResponseSchema', () => {
  describe('valid accept response', () => {
    it('validates accept action without feedback', () => {
      const response = { action: 'accept' as const };
      expect(UserResponseSchema.safeParse(response).success).toBe(true);
    });

    it('validates accept action with optional feedback', () => {
      const response = { action: 'accept' as const, feedback: 'Looks good!' };
      expect(UserResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('valid reject response', () => {
    it('validates reject action without feedback', () => {
      const response = { action: 'reject' as const };
      expect(UserResponseSchema.safeParse(response).success).toBe(true);
    });

    it('validates reject action with optional feedback', () => {
      const response = { action: 'reject' as const, feedback: 'Not what I wanted' };
      expect(UserResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('valid feedback response', () => {
    it('validates feedback action with feedback text', () => {
      const response = { action: 'feedback' as const, feedback: 'Please make it more specific' };
      expect(UserResponseSchema.safeParse(response).success).toBe(true);
    });

    it('validates feedback action with long feedback text', () => {
      const response = { action: 'feedback' as const, feedback: 'A'.repeat(1000) };
      expect(UserResponseSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('invalid feedback response', () => {
    it('rejects feedback action without feedback text', () => {
      const response = { action: 'feedback' as const };
      expect(UserResponseSchema.safeParse(response).success).toBe(false);
    });

    it('rejects feedback action with empty feedback text', () => {
      const response = { action: 'feedback' as const, feedback: '' };
      expect(UserResponseSchema.safeParse(response).success).toBe(false);
    });

    it('rejects feedback action with whitespace-only feedback', () => {
      const response = { action: 'feedback' as const, feedback: '   ' };
      expect(UserResponseSchema.safeParse(response).success).toBe(false);
    });

    it('rejects feedback longer than 1000 characters', () => {
      const response = { action: 'feedback' as const, feedback: 'A'.repeat(1001) };
      expect(UserResponseSchema.safeParse(response).success).toBe(false);
    });
  });

  describe('missing required fields', () => {
    it('rejects missing action', () => {
      const response = { feedback: 'Some feedback' };
      expect(UserResponseSchema.safeParse(response).success).toBe(false);
    });
  });
});

// ============================================
// UserAnswersSchema Tests
// ============================================

describe('UserAnswersSchema', () => {
  describe('valid answers', () => {
    it('validates with one non-empty answer', () => {
      const answers = { q1: 'Technology sector' };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(true);
    });

    it('validates with multiple answers', () => {
      const answers = {
        q1: 'Technology sector',
        q2: 'Past 6 months',
        q3: 'CEOs and CTOs',
      };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(true);
    });

    it('validates with some empty answers if at least one is non-empty', () => {
      const answers = {
        q1: '',
        q2: 'Valid answer here',
        q3: '',
      };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(true);
    });

    it('validates answers with string keys', () => {
      const answers = {
        'What industry?': 'Technology',
        'What timeframe?': 'Recent',
      };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(true);
    });
  });

  describe('invalid answers', () => {
    it('rejects all empty answers', () => {
      const answers = {
        q1: '',
        q2: '',
      };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(false);
    });

    it('rejects all whitespace-only answers', () => {
      const answers = {
        q1: '   ',
        q2: '\t\n',
      };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(false);
    });

    it('rejects empty object', () => {
      const answers = {};
      expect(UserAnswersSchema.safeParse(answers).success).toBe(false);
    });

    it('rejects answer longer than 1000 characters', () => {
      const answers = { q1: 'A'.repeat(1001) };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(false);
    });

    it('accepts answer at exactly 1000 characters', () => {
      const answers = { q1: 'A'.repeat(1000) };
      expect(UserAnswersSchema.safeParse(answers).success).toBe(true);
    });
  });
});

// ============================================
// RefinementResultSchema Tests
// ============================================

describe('RefinementResultSchema', () => {
  describe('valid results', () => {
    it('validates complete result', () => {
      const result = createValidRefinementResult();
      expect(RefinementResultSchema.safeParse(result).success).toBe(true);
    });

    it('validates result with wasRefined=false', () => {
      const result = {
        ...createValidRefinementResult(),
        wasRefined: false,
        iterationCount: 0,
      };
      expect(RefinementResultSchema.safeParse(result).success).toBe(true);
    });

    it('validates result with all model types', () => {
      const models = ['gemini', 'gpt', 'claude', 'kimi2'] as const;
      for (const modelUsed of models) {
        const result = { ...createValidRefinementResult(), modelUsed };
        expect(RefinementResultSchema.safeParse(result).success).toBe(true);
      }
    });

    it('validates result with iterationCount=0 (no refinement)', () => {
      const result = { ...createValidRefinementResult(), iterationCount: 0 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(true);
    });

    it('validates result with iterationCount=10 (max)', () => {
      const result = { ...createValidRefinementResult(), iterationCount: 10 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('invalid iterationCount', () => {
    it('rejects negative iterationCount', () => {
      const result = { ...createValidRefinementResult(), iterationCount: -1 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects non-integer iterationCount', () => {
      const result = { ...createValidRefinementResult(), iterationCount: 2.5 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects iterationCount above 10', () => {
      const result = { ...createValidRefinementResult(), iterationCount: 11 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });
  });

  describe('invalid processingTimeMs', () => {
    it('rejects negative processingTimeMs', () => {
      const result = { ...createValidRefinementResult(), processingTimeMs: -100 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects non-integer processingTimeMs', () => {
      const result = { ...createValidRefinementResult(), processingTimeMs: 1234.56 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('accepts processingTimeMs=0', () => {
      const result = { ...createValidRefinementResult(), processingTimeMs: 0 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(true);
    });

    it('accepts large processingTimeMs', () => {
      const result = { ...createValidRefinementResult(), processingTimeMs: 999999999 };
      expect(RefinementResultSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('prompt validation', () => {
    it('rejects empty refinedPrompt', () => {
      const result = { ...createValidRefinementResult(), refinedPrompt: '' };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects empty originalPrompt', () => {
      const result = { ...createValidRefinementResult(), originalPrompt: '' };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects refinedPrompt longer than 5000 characters', () => {
      const result = { ...createValidRefinementResult(), refinedPrompt: 'A'.repeat(5001) };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects originalPrompt longer than 5000 characters', () => {
      const result = { ...createValidRefinementResult(), originalPrompt: 'A'.repeat(5001) };
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('accepts prompts at exactly 5000 characters', () => {
      const result = {
        ...createValidRefinementResult(),
        refinedPrompt: 'A'.repeat(5000),
        originalPrompt: 'B'.repeat(5000),
      };
      expect(RefinementResultSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('missing required fields', () => {
    it('rejects missing refinedPrompt', () => {
      const { refinedPrompt: _, ...result } = createValidRefinementResult();
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects missing originalPrompt', () => {
      const { originalPrompt: _, ...result } = createValidRefinementResult();
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects missing wasRefined', () => {
      const { wasRefined: _, ...result } = createValidRefinementResult();
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects missing modelUsed', () => {
      const { modelUsed: _, ...result } = createValidRefinementResult();
      expect(RefinementResultSchema.safeParse(result).success).toBe(false);
    });
  });
});

// ============================================
// Validation Helper Tests
// ============================================

describe('Validation Helpers', () => {
  describe('isValidRefinementModel', () => {
    it('returns true for valid models', () => {
      expect(isValidRefinementModel('gemini')).toBe(true);
      expect(isValidRefinementModel('gpt')).toBe(true);
      expect(isValidRefinementModel('claude')).toBe(true);
      expect(isValidRefinementModel('kimi2')).toBe(true);
    });

    it('returns false for invalid models', () => {
      expect(isValidRefinementModel('openai')).toBe(false);
      expect(isValidRefinementModel('anthropic')).toBe(false);
      expect(isValidRefinementModel('')).toBe(false);
      expect(isValidRefinementModel('gpt-4')).toBe(false);
    });

    it('can be used as type guard', () => {
      const model = 'gemini';
      if (isValidRefinementModel(model)) {
        // TypeScript should recognize model as RefinementModelValidated here
        const validModel: 'gemini' | 'gpt' | 'claude' | 'kimi2' = model;
        expect(validModel).toBe('gemini');
      }
    });
  });

  describe('parsePromptAnalysis', () => {
    it('returns validated data for valid input', () => {
      const input = createValidClearAnalysis();
      const result = parsePromptAnalysis(input);
      expect(result).not.toBeNull();
      expect(result?.isClear).toBe(true);
      expect(result?.confidence).toBe(0.9);
    });

    it('returns null for invalid input', () => {
      const input = { isClear: 'not-a-boolean' };
      const result = parsePromptAnalysis(input);
      expect(result).toBeNull();
    });

    it('returns null for missing required fields', () => {
      const input = { isClear: true };
      const result = parsePromptAnalysis(input);
      expect(result).toBeNull();
    });

    it('returns null for unclear prompt without questions', () => {
      const input = {
        isClear: false,
        confidence: 0.3,
        reasoning: 'The prompt needs clarification.',
      };
      const result = parsePromptAnalysis(input);
      expect(result).toBeNull();
    });

    it('returns validated data for valid unclear input', () => {
      const input = createValidUnclearAnalysis();
      const result = parsePromptAnalysis(input);
      expect(result).not.toBeNull();
      expect(result?.isClear).toBe(false);
      expect(result?.clarifyingQuestions?.length).toBe(2);
    });
  });

  describe('parseRefinementResponse', () => {
    it('returns validated data for valid input', () => {
      const input = createValidRefinementResponse();
      const result = parseRefinementResponse(input);
      expect(result).not.toBeNull();
      expect(result?.refinedPrompt).toBeDefined();
      expect(result?.reasoning).toBeDefined();
    });

    it('returns null for invalid input', () => {
      const input = { refinedPrompt: 'short' }; // Too short and missing reasoning
      const result = parseRefinementResponse(input);
      expect(result).toBeNull();
    });

    it('returns null for missing refinedPrompt', () => {
      const input = { reasoning: 'A valid reasoning that explains the refinement process.' };
      const result = parseRefinementResponse(input);
      expect(result).toBeNull();
    });

    it('returns null for missing reasoning', () => {
      const input = { refinedPrompt: 'A valid refined prompt with enough characters.' };
      const result = parseRefinementResponse(input);
      expect(result).toBeNull();
    });

    it('returns validated data with detectedIntents', () => {
      const input = {
        ...createValidRefinementResponse(),
        detectedIntents: ['content creation', 'thought leadership'],
      };
      const result = parseRefinementResponse(input);
      expect(result).not.toBeNull();
      expect(result?.detectedIntents).toHaveLength(2);
    });
  });

  describe('formatValidationError', () => {
    it('formats single error correctly', () => {
      const result = RefinementModelSchema.safeParse('invalid');
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(typeof formatted).toBe('string');
        expect(formatted.length).toBeGreaterThan(0);
      }
    });

    it('formats multiple errors with semicolon separator', () => {
      const result = RefinementConfigSchema.safeParse({
        skip: 'not-boolean',
        model: 'invalid',
        maxIterations: 0,
        timeoutMs: 100,
      });
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted).toContain(';');
      }
    });

    it('includes field paths in error message', () => {
      const result = RefinementConfigSchema.safeParse({
        skip: false,
        model: 'gemini',
        maxIterations: 100, // Invalid - too high
        timeoutMs: 30000,
      });
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted).toContain('maxIterations');
      }
    });

    it('handles nested path errors', () => {
      const result = PromptAnalysisSchema.safeParse({
        isClear: true,
        confidence: 0.5,
        reasoning: 'Valid reasoning with enough characters.',
        detectedIntents: ['a'], // Too short - should fail
      });
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted).toContain('detectedIntents');
      }
    });

    it('handles refinement-level errors', () => {
      const result = UserResponseSchema.safeParse({
        action: 'feedback',
        // Missing feedback text
      });
      if (!result.success) {
        const formatted = formatValidationError(result.error);
        expect(formatted.length).toBeGreaterThan(0);
      }
    });
  });
});
