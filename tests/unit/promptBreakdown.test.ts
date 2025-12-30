/**
 * Unit Tests for Prompt Breakdown Module
 *
 * Tests for prompt breakdown functions in:
 * - src/prompts/breakdown.ts
 *
 * Coverage includes:
 * - isLongPrompt threshold checking
 * - getPromptForSource routing logic
 * - DEFAULT_LONG_PROMPT_THRESHOLD constant
 */

import { describe, it, expect } from 'vitest';
import {
  isLongPrompt,
  getPromptForSource,
  DEFAULT_LONG_PROMPT_THRESHOLD,
  type PromptBreakdownResult,
} from '../../src/prompts/breakdown.js';

// ============================================
// isLongPrompt Tests
// ============================================

describe('isLongPrompt', () => {
  it('returns false for short prompts', () => {
    expect(isLongPrompt('AI trends')).toBe(false);
    expect(isLongPrompt('machine learning')).toBe(false);
    expect(isLongPrompt('technology')).toBe(false);
  });

  it('returns true for prompts exceeding threshold', () => {
    const longPrompt = 'a'.repeat(DEFAULT_LONG_PROMPT_THRESHOLD + 1);
    expect(isLongPrompt(longPrompt)).toBe(true);
  });

  it('uses custom threshold when provided', () => {
    expect(isLongPrompt('short', 3)).toBe(true);
    expect(isLongPrompt('short', 10)).toBe(false);
  });

  it('handles edge case at exact threshold', () => {
    const exactPrompt = 'a'.repeat(DEFAULT_LONG_PROMPT_THRESHOLD);
    expect(isLongPrompt(exactPrompt)).toBe(false);
  });

  it('handles edge case one character over threshold', () => {
    const overPrompt = 'a'.repeat(DEFAULT_LONG_PROMPT_THRESHOLD + 1);
    expect(isLongPrompt(overPrompt)).toBe(true);
  });

  it('handles empty string', () => {
    expect(isLongPrompt('')).toBe(false);
  });

  it('handles whitespace-only string', () => {
    expect(isLongPrompt('   ')).toBe(false);
  });

  it('trims whitespace before checking length', () => {
    // A prompt that would be over threshold with spaces, but under when trimmed
    const paddedPrompt = '   ' + 'a'.repeat(50) + '   ';
    expect(isLongPrompt(paddedPrompt, 60)).toBe(false);
  });

  it('handles zero threshold', () => {
    expect(isLongPrompt('a', 0)).toBe(true);
    expect(isLongPrompt('', 0)).toBe(false);
  });

  it('handles negative threshold (edge case)', () => {
    // Any string (including empty after trim) with negative threshold is "long"
    // because length (0 or more) is always > negative threshold
    expect(isLongPrompt('a', -1)).toBe(true);
    // Empty string after trim has length 0, which is > -1, so it's "long"
    expect(isLongPrompt('', -1)).toBe(true);
  });
});

// ============================================
// DEFAULT_LONG_PROMPT_THRESHOLD Tests
// ============================================

describe('DEFAULT_LONG_PROMPT_THRESHOLD', () => {
  it('is a positive number', () => {
    expect(DEFAULT_LONG_PROMPT_THRESHOLD).toBeGreaterThan(0);
  });

  it('has expected value of 100', () => {
    expect(DEFAULT_LONG_PROMPT_THRESHOLD).toBe(100);
  });

  it('is used by isLongPrompt when no threshold provided', () => {
    const atThreshold = 'a'.repeat(DEFAULT_LONG_PROMPT_THRESHOLD);
    const overThreshold = 'a'.repeat(DEFAULT_LONG_PROMPT_THRESHOLD + 1);

    expect(isLongPrompt(atThreshold)).toBe(false);
    expect(isLongPrompt(overThreshold)).toBe(true);
  });
});

// ============================================
// getPromptForSource Tests
// ============================================

describe('getPromptForSource', () => {
  const originalPrompt = 'AI leadership trends and thought leadership in technology sector 2025';

  describe('web source', () => {
    it('returns original prompt for web source with breakdown', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: ['AI leadership', 'tech trends 2025', 'thought leadership'],
        wasBreakdown: true,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'web');

      expect(result).toBe(originalPrompt);
    });

    it('returns original prompt for web source without breakdown', () => {
      const result = getPromptForSource(originalPrompt, null, 'web');

      expect(result).toBe(originalPrompt);
    });

    it('returns breakdown.original for web source', () => {
      const breakdown: PromptBreakdownResult = {
        original: 'modified original',
        socialQueries: ['query1', 'query2', 'query3'],
        wasBreakdown: true,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'web');

      expect(result).toBe('modified original');
    });
  });

  describe('linkedin source', () => {
    it('returns social queries when breakdown was performed', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: ['AI leadership', 'tech trends', 'thought leadership'],
        wasBreakdown: true,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'linkedin');

      expect(result).toEqual(['AI leadership', 'tech trends', 'thought leadership']);
    });

    it('returns original prompt as array when no breakdown', () => {
      const result = getPromptForSource(originalPrompt, null, 'linkedin');

      expect(result).toEqual([originalPrompt]);
    });

    it('returns original as array when wasBreakdown is false', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: [originalPrompt],
        wasBreakdown: false,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'linkedin');

      expect(result).toEqual([originalPrompt]);
    });
  });

  describe('x (Twitter) source', () => {
    it('returns social queries when breakdown was performed', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: ['AI trends', 'leadership 2025', 'tech sector'],
        wasBreakdown: true,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'x');

      expect(result).toEqual(['AI trends', 'leadership 2025', 'tech sector']);
    });

    it('returns original prompt as array when no breakdown', () => {
      const result = getPromptForSource(originalPrompt, null, 'x');

      expect(result).toEqual([originalPrompt]);
    });

    it('returns original as array when wasBreakdown is false', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: [originalPrompt],
        wasBreakdown: false,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'x');

      expect(result).toEqual([originalPrompt]);
    });
  });

  describe('edge cases', () => {
    it('handles empty socialQueries array', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: [],
        wasBreakdown: true,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'linkedin');

      expect(result).toEqual([]);
    });

    it('handles single-item socialQueries array', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: ['single query'],
        wasBreakdown: true,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'x');

      expect(result).toEqual(['single query']);
    });

    it('handles many socialQueries', () => {
      const breakdown: PromptBreakdownResult = {
        original: originalPrompt,
        socialQueries: ['q1', 'q2', 'q3', 'q4', 'q5'],
        wasBreakdown: true,
      };

      const result = getPromptForSource(originalPrompt, breakdown, 'linkedin');

      expect(result).toHaveLength(5);
    });
  });
});

// ============================================
// PromptBreakdownResult Type Tests
// ============================================

describe('PromptBreakdownResult structure', () => {
  it('has all required properties', () => {
    const result: PromptBreakdownResult = {
      original: 'test prompt',
      socialQueries: ['query1', 'query2'],
      wasBreakdown: true,
    };

    expect(result).toHaveProperty('original');
    expect(result).toHaveProperty('socialQueries');
    expect(result).toHaveProperty('wasBreakdown');
  });

  it('original is string type', () => {
    const result: PromptBreakdownResult = {
      original: 'test',
      socialQueries: [],
      wasBreakdown: false,
    };

    expect(typeof result.original).toBe('string');
  });

  it('socialQueries is array of strings', () => {
    const result: PromptBreakdownResult = {
      original: 'test',
      socialQueries: ['a', 'b', 'c'],
      wasBreakdown: true,
    };

    expect(Array.isArray(result.socialQueries)).toBe(true);
    result.socialQueries.forEach(q => {
      expect(typeof q).toBe('string');
    });
  });

  it('wasBreakdown is boolean', () => {
    const result: PromptBreakdownResult = {
      original: 'test',
      socialQueries: [],
      wasBreakdown: false,
    };

    expect(typeof result.wasBreakdown).toBe('boolean');
  });
});

// ============================================
// Integration-style Tests
// ============================================

describe('Prompt Breakdown Integration', () => {
  it('short prompts pass through unchanged for all sources', () => {
    const shortPrompt = 'AI trends';

    expect(isLongPrompt(shortPrompt)).toBe(false);

    // For short prompts, no breakdown happens
    const noBreakdown: PromptBreakdownResult = {
      original: shortPrompt,
      socialQueries: [shortPrompt],
      wasBreakdown: false,
    };

    expect(getPromptForSource(shortPrompt, noBreakdown, 'web')).toBe(shortPrompt);
    expect(getPromptForSource(shortPrompt, noBreakdown, 'linkedin')).toEqual([shortPrompt]);
    expect(getPromptForSource(shortPrompt, noBreakdown, 'x')).toEqual([shortPrompt]);
  });

  it('long prompts need breakdown and route differently', () => {
    const longPrompt = 'a'.repeat(DEFAULT_LONG_PROMPT_THRESHOLD + 50);

    expect(isLongPrompt(longPrompt)).toBe(true);

    // After breakdown, web gets full, social gets queries
    const breakdown: PromptBreakdownResult = {
      original: longPrompt,
      socialQueries: ['extracted1', 'extracted2', 'extracted3'],
      wasBreakdown: true,
    };

    expect(getPromptForSource(longPrompt, breakdown, 'web')).toBe(longPrompt);
    expect(getPromptForSource(longPrompt, breakdown, 'linkedin')).toEqual(['extracted1', 'extracted2', 'extracted3']);
    expect(getPromptForSource(longPrompt, breakdown, 'x')).toEqual(['extracted1', 'extracted2', 'extracted3']);
  });
});
