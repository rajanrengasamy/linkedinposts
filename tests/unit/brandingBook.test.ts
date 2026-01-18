/**
 * Branding Book Generator Tests
 *
 * Tests for the branding book generation module that creates
 * human-readable and machine-readable branding documentation.
 */

import { describe, it, expect } from 'vitest';
import {
  generateBrandingBookData,
  renderBrandingBookMarkdown,
  inferAccentColor,
  BRANDING_BOOK_SCHEMA_VERSION,
} from '../../src/image/brandingBook.js';
import type { InfographicBrief, AccentColor } from '../../src/schemas/synthesisResult.js';

// ============================================
// Test Fixtures
// ============================================

function createMockBrief(overrides?: Partial<InfographicBrief>): InfographicBrief {
  return {
    title: 'Test Infographic Title',
    keyPoints: ['Point 1', 'Point 2', 'Point 3'],
    suggestedStyle: 'minimal',
    ...overrides,
  };
}

// ============================================
// inferAccentColor Tests
// ============================================

describe('inferAccentColor', () => {
  it('should return explicit accentColor from brief if provided', () => {
    const brief = createMockBrief({ accentColor: 'coral' });
    const result = inferAccentColor(brief, 'AI trends');
    expect(result).toBe('coral');
  });

  it('should infer violet for AI/ML topics', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'artificial intelligence trends')).toBe('violet');
    expect(inferAccentColor(brief, 'machine learning applications')).toBe('violet');
    expect(inferAccentColor(brief, 'AI strategy for business')).toBe('violet');
  });

  it('should infer lime for tech/innovation topics', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'tech startup growth')).toBe('lime');
    expect(inferAccentColor(brief, 'innovation in software development')).toBe('lime');
  });

  it('should infer cyan for data/systems topics', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'data analytics best practices')).toBe('cyan');
    expect(inferAccentColor(brief, 'systems architecture patterns')).toBe('cyan');
  });

  it('should infer coral for people/community topics', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'team building and culture')).toBe('coral');
    expect(inferAccentColor(brief, 'healthcare community initiatives')).toBe('coral');
  });

  it('should infer amber for finance/warnings topics', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'investment strategies 2025')).toBe('amber');
    expect(inferAccentColor(brief, 'finance trends and money management')).toBe('amber');
  });

  it('should infer sky for cloud/enterprise topics', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'cloud computing enterprise solutions')).toBe('sky');
    expect(inferAccentColor(brief, 'saas collaboration tools')).toBe('sky');
  });

  it('should infer emerald for sustainability topics', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'green sustainability practices')).toBe('emerald');
    expect(inferAccentColor(brief, 'wellness and health initiatives')).toBe('emerald');
  });

  it('should default to violet for ambiguous topics', () => {
    const brief = createMockBrief();
    const result = inferAccentColor(brief, 'random topic without keywords');
    expect(result).toBe('violet');
  });

  it('should handle case insensitivity', () => {
    const brief = createMockBrief();
    expect(inferAccentColor(brief, 'ARTIFICIAL INTELLIGENCE')).toBe('violet');
    expect(inferAccentColor(brief, 'Machine Learning')).toBe('violet');
  });
});

// ============================================
// generateBrandingBookData Tests
// ============================================

describe('generateBrandingBookData', () => {
  it('should include schema version', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test topic');
    expect(data.schemaVersion).toBe(BRANDING_BOOK_SCHEMA_VERSION);
  });

  it('should include generation timestamp', () => {
    const brief = createMockBrief();
    const before = new Date().toISOString();
    const data = generateBrandingBookData(brief, 'test topic');
    const after = new Date().toISOString();

    expect(data.generatedAt).toBeDefined();
    expect(data.generatedAt >= before).toBe(true);
    expect(data.generatedAt <= after).toBe(true);
  });

  it('should include topic', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'AI trends 2025');
    expect(data.topic).toBe('AI trends 2025');
  });

  it('should include background specification', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');

    expect(data.background.colorRange).toContain('#1e1e1e');
    expect(data.background.colorRange).toContain('#252525');
    expect(data.background.type).toBe('solid');
    expect(data.background.restrictions).toContain('no-gradients');
  });

  it('should include typography specification', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');

    expect(data.typography.fontFamily).toBe('geometric-sans-serif');
    expect(data.typography.titleColor).toBe('#ffffff');
    expect(data.typography.contrastMinimum).toBe('4.5:1');
  });

  it('should include icon style specification', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');

    expect(data.iconStyle.type).toBe('line-art');
    expect(data.iconStyle.fill).toBe('none');
  });

  it('should include full accent palette', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');

    expect(data.accentPalette).toHaveProperty('lime');
    expect(data.accentPalette).toHaveProperty('cyan');
    expect(data.accentPalette).toHaveProperty('coral');
    expect(data.accentPalette).toHaveProperty('amber');
    expect(data.accentPalette).toHaveProperty('violet');
    expect(data.accentPalette).toHaveProperty('sky');
    expect(data.accentPalette).toHaveProperty('emerald');
  });

  it('should include recommended accent based on topic', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'machine learning strategy');

    expect(data.recommendedAccent.color).toBe('violet');
    expect(data.recommendedAccent.hex).toBe('#a78bfa');
    expect(data.recommendedAccent.reason).toBeDefined();
  });

  it('should use explicit accentColor from brief', () => {
    const brief = createMockBrief({ accentColor: 'emerald' });
    const data = generateBrandingBookData(brief, 'random topic');

    expect(data.recommendedAccent.color).toBe('emerald');
    expect(data.recommendedAccent.hex).toBe('#34d399');
  });

  it('should include all style definitions', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');

    expect(data.styles).toHaveProperty('minimal');
    expect(data.styles).toHaveProperty('data-heavy');
    expect(data.styles).toHaveProperty('quote-focused');
  });

  it('should include restrictions', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');

    expect(data.restrictions).toContain('no-light-backgrounds');
    expect(data.restrictions).toContain('no-gradient-backgrounds');
    expect(data.restrictions).toContain('no-filled-icons');
    expect(Array.isArray(data.restrictions)).toBe(true);
    expect(data.restrictions.length).toBeGreaterThan(5);
  });
});

// ============================================
// renderBrandingBookMarkdown Tests
// ============================================

describe('renderBrandingBookMarkdown', () => {
  it('should render valid markdown', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'AI trends');
    const markdown = renderBrandingBookMarkdown(data);

    expect(markdown).toContain('# LinkedIn Infographic Branding Guide');
    expect(markdown).toContain('## Brand Foundation');
    expect(markdown).toContain('## Accent Color Palette');
    expect(markdown).toContain('## Visual Styles');
    expect(markdown).toContain('## Restrictions');
  });

  it('should include topic in markdown', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'AI trends 2025');
    const markdown = renderBrandingBookMarkdown(data);

    expect(markdown).toContain('AI trends 2025');
  });

  it('should include recommended accent color', () => {
    const brief = createMockBrief({ accentColor: 'coral' });
    const data = generateBrandingBookData(brief, 'healthcare');
    const markdown = renderBrandingBookMarkdown(data);

    expect(markdown).toContain('Coral');
    expect(markdown).toContain('#fb7185');
  });

  it('should include color palette table', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');
    const markdown = renderBrandingBookMarkdown(data);

    expect(markdown).toContain('| Color | Hex | Best For |');
    expect(markdown).toContain('| Lime |');
    expect(markdown).toContain('| Violet |');
  });

  it('should include style descriptions', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');
    const markdown = renderBrandingBookMarkdown(data);

    expect(markdown).toContain('Minimal');
    expect(markdown).toContain('Data-Heavy');
    expect(markdown).toContain('Quote-Focused');
  });

  it('should include formatted restrictions', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');
    const markdown = renderBrandingBookMarkdown(data);

    expect(markdown).toContain('NO');
    expect(markdown).toContain('Maximum');
  });

  it('should include quick reference table', () => {
    const brief = createMockBrief();
    const data = generateBrandingBookData(brief, 'test');
    const markdown = renderBrandingBookMarkdown(data);

    expect(markdown).toContain('## Quick Reference');
    expect(markdown).toContain('| Element | Value |');
  });
});
