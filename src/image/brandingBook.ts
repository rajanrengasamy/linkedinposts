/**
 * Branding Book Generator
 *
 * Generates human-readable and machine-readable branding documentation
 * from the existing BRAND_TEMPLATE and ACCENT_PALETTE constants.
 *
 * This module creates consistent branding documentation that can be used
 * for manual image generation in Gemini or other tools.
 *
 * @see docs/manual-image-generation-approach.md for full documentation
 */

import { ACCENT_PALETTE, STYLE_INSTRUCTIONS } from './nanoBanana.js';
import type { InfographicBrief, AccentColor, InfographicStyle } from '../schemas/synthesisResult.js';

// ============================================
// Types
// ============================================

/**
 * Structured branding book data for JSON export
 */
export interface BrandingBookData {
  schemaVersion: string;
  generatedAt: string;
  topic: string;

  background: {
    colorRange: string[];
    type: string;
    restrictions: string[];
  };

  frame: {
    strokeWidth: string;
    strokeColor: string;
    cornerRadius: string;
  };

  typography: {
    fontFamily: string;
    fontSuggestions: string[];
    titleWeight: string;
    titleColor: string;
    bodyWeight: string;
    bodyColor: string;
    contrastMinimum: string;
  };

  iconStyle: {
    type: string;
    strokeWeight: string;
    fill: string;
  };

  whitespace: {
    marginMinimum: string;
    negativeSpaceTarget: string;
  };

  accentPalette: typeof ACCENT_PALETTE;

  recommendedAccent: {
    color: AccentColor;
    hex: string;
    reason: string;
  };

  styles: Record<InfographicStyle, StyleDefinition>;

  restrictions: string[];
}

/**
 * Style definition for the branding book
 */
interface StyleDefinition {
  description: string;
  guidelines: string[];
}

// ============================================
// Constants
// ============================================

/**
 * Schema version for branding book files
 */
export const BRANDING_BOOK_SCHEMA_VERSION = '1.0.0';

/**
 * Keywords that map to accent colors for topic inference
 */
const COLOR_KEYWORDS: Record<AccentColor, string[]> = {
  lime: ['tech', 'innovation', 'energy', 'growth', 'startup', 'code', 'developer', 'engineering'],
  cyan: ['trust', 'clarity', 'data', 'systems', 'analytics', 'infrastructure', 'architecture'],
  coral: ['people', 'warmth', 'healthcare', 'community', 'social', 'team', 'culture', 'hr'],
  amber: ['insights', 'warnings', 'finance', 'attention', 'money', 'investment', 'economics'],
  violet: ['creative', 'ai', 'ml', 'future', 'strategy', 'artificial intelligence', 'machine learning'],
  sky: ['calm', 'enterprise', 'cloud', 'communication', 'saas', 'collaboration', 'remote'],
  emerald: ['sustainability', 'success', 'balance', 'wellness', 'green', 'eco', 'health'],
};

/**
 * Style descriptions for the branding book
 */
const STYLE_DEFINITIONS: Record<InfographicStyle, StyleDefinition> = {
  minimal: {
    description: 'Clean, typography-focused design with generous whitespace',
    guidelines: [
      'Whitespace: 40-50% of canvas',
      'Maximum 2-3 content sections',
      'Simple, elegant line-art icons (max 1-2)',
      'Typography hierarchy as primary visual interest',
      'Let the dark background do the heavy lifting',
      'Accent color used sparingly for maximum impact',
    ],
  },
  'data-heavy': {
    description: 'Data visualization-focused with clear hierarchy',
    guidelines: [
      'ONE primary data visualization as hero element',
      'Maximum 3-4 data points displayed',
      'Supporting line-art icons (not competing with data)',
      'Clear hierarchy: Title > Data Viz > Supporting text',
      'Numbers should be LARGE and in accent color',
      'Data viz elements use white fills with dark text OR accent outlines',
    ],
  },
  'quote-focused': {
    description: 'Quote-centric design with the quote as the hero element',
    guidelines: [
      'Quote text occupies 50-60% of visual weight',
      'Quote in accent color OR white with accent quotation marks',
      'Author attribution smaller, in white',
      'Minimal supporting elements - the quote IS the design',
      'Optional: Large elegant quotation marks in accent color',
      'Ensure quote is fully readable at thumbnail size',
    ],
  },
};

/**
 * List of restrictions (negative prompts)
 */
const BRAND_RESTRICTIONS = [
  'no-light-backgrounds',
  'no-gradient-backgrounds',
  'no-filled-icons',
  'no-multiple-accent-colors',
  'no-stock-imagery',
  'no-cluttered-compositions',
  'no-small-text',
  'no-clip-art',
  'no-generic-corporate-imagery',
  'no-logos-watermarks',
  'no-competing-borders',
  'max-5-visual-elements',
];

// ============================================
// Color Inference
// ============================================

/**
 * Infer the recommended accent color based on topic and brief.
 *
 * If the brief has an explicit accentColor, use that.
 * Otherwise, analyze the topic for keywords and select the best match.
 *
 * @param brief - The infographic brief (may contain accentColor)
 * @param topic - The topic string to analyze
 * @returns The recommended accent color
 */
export function inferAccentColor(brief: InfographicBrief, topic: string): AccentColor {
  // If brief has explicit color, use it
  if (brief.accentColor) {
    return brief.accentColor;
  }

  const topicLower = topic.toLowerCase();
  let bestMatch: AccentColor = 'violet'; // Default for AI/tech topics
  let maxScore = 0;

  // Score each color based on keyword matches
  for (const [color, keywords] of Object.entries(COLOR_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (topicLower.includes(keyword)) {
        score++;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatch = color as AccentColor;
    }
  }

  return bestMatch;
}

/**
 * Get the reason for recommending a specific accent color
 */
function getColorReason(color: AccentColor): string {
  return ACCENT_PALETTE[color].bestFor;
}

// ============================================
// Data Generation
// ============================================

/**
 * Generate structured branding book data from brief and topic.
 *
 * This creates a complete JSON-serializable data structure containing
 * all branding information needed for manual image generation.
 *
 * @param brief - The infographic brief from synthesis
 * @param topic - The original topic/prompt
 * @returns Structured branding book data
 */
export function generateBrandingBookData(
  brief: InfographicBrief,
  topic: string
): BrandingBookData {
  const recommendedColor = inferAccentColor(brief, topic);

  return {
    schemaVersion: BRANDING_BOOK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    topic,

    background: {
      colorRange: ['#1e1e1e', '#252525'],
      type: 'solid',
      restrictions: ['no-gradients', 'no-patterns'],
    },

    frame: {
      strokeWidth: '1-2px',
      strokeColor: 'rgba(255, 255, 255, 0.15-0.20)',
      cornerRadius: '20-30px',
    },

    typography: {
      fontFamily: 'geometric-sans-serif',
      fontSuggestions: ['Inter', 'SF Pro', 'Outfit'],
      titleWeight: 'bold',
      titleColor: '#ffffff',
      bodyWeight: 'regular',
      bodyColor: '#ffffff',
      contrastMinimum: '4.5:1',
    },

    iconStyle: {
      type: 'line-art',
      strokeWeight: '2-3px',
      fill: 'none',
    },

    whitespace: {
      marginMinimum: '8%',
      negativeSpaceTarget: '30-40%',
    },

    accentPalette: ACCENT_PALETTE,

    recommendedAccent: {
      color: recommendedColor,
      hex: ACCENT_PALETTE[recommendedColor].hex,
      reason: getColorReason(recommendedColor),
    },

    styles: STYLE_DEFINITIONS,

    restrictions: BRAND_RESTRICTIONS,
  };
}

// ============================================
// Markdown Rendering
// ============================================

/**
 * Render branding book data to human-readable Markdown format.
 *
 * Creates a comprehensive brand guide that can be read and understood
 * by humans when manually generating images.
 *
 * @param data - Structured branding book data
 * @returns Markdown string
 */
export function renderBrandingBookMarkdown(data: BrandingBookData): string {
  const accentTable = Object.entries(data.accentPalette)
    .map(([name, info]) => `| ${capitalize(name)} | ${info.hex} | ${capitalize(info.bestFor)} |`)
    .join('\n');

  return `# LinkedIn Infographic Branding Guide

Generated: ${data.generatedAt}
Topic: "${data.topic}"

---

## Brand Foundation

### Background
- **Color**: Solid dark charcoal (${data.background.colorRange[0]} to ${data.background.colorRange[1]})
- **Style**: NO gradients, NO patterns
- **Purpose**: Creates premium, professional look

### Frame/Border
- **Style**: Subtle rounded rectangle
- **Stroke**: ${data.frame.strokeWidth} at 15-20% white opacity
- **Corner Radius**: ${data.frame.cornerRadius}

### Typography
- **Font Family**: Geometric sans-serif (${data.typography.fontSuggestions.join(', ')})
- **Title**: ${data.typography.titleWeight.toUpperCase()} weight, ${data.typography.titleColor}
- **Body**: ${data.typography.bodyWeight} weight, ${data.typography.bodyColor}
- **Contrast**: WCAG AA compliant (${data.typography.contrastMinimum} minimum)

### Icon Style
- **Type**: ${data.iconStyle.type.toUpperCase()}
- **Stroke Weight**: ${data.iconStyle.strokeWeight}, NO fills
- **Color**: Primary accent color

### Whitespace
- **Minimum Margin**: ${data.whitespace.marginMinimum} on all edges
- **Target Negative Space**: ${data.whitespace.negativeSpaceTarget} of canvas

---

## Accent Color Palette

Select ONE color per infographic based on topic mood:

| Color | Hex | Best For |
|-------|-----|----------|
${accentTable}

**For this topic ("${data.topic}"):**
- **Recommended Accent**: ${capitalize(data.recommendedAccent.color)} (${data.recommendedAccent.hex})
- **Reason**: ${capitalize(data.recommendedAccent.reason)}

---

## Visual Styles

${Object.entries(data.styles)
  .map(
    ([name, style]) => `### ${formatStyleName(name)} Style
${style.description}

${style.guidelines.map((g) => `- ${g}`).join('\n')}`
  )
  .join('\n\n')}

---

## Restrictions (Negative Prompts)

These elements should NEVER appear in infographics:

${data.restrictions.map((r) => `- ${formatRestriction(r)}`).join('\n')}

---

## Quick Reference

| Element | Value |
|---------|-------|
| Background | ${data.background.colorRange[0]} |
| Recommended Accent | ${data.recommendedAccent.hex} |
| Font Style | Geometric sans-serif |
| Icon Style | Line-art, ${data.iconStyle.strokeWeight} stroke |
| Max Visual Elements | 5 |

---

*Generated by LinkedIn Post Generator - Stage 6 Prompt Export System*
`;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Capitalize the first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Format a style name for display (e.g., "data-heavy" -> "Data-Heavy")
 */
function formatStyleName(name: string): string {
  return name
    .split('-')
    .map((part) => capitalize(part))
    .join('-');
}

/**
 * Format a restriction for display (e.g., "no-light-backgrounds" -> "NO light backgrounds")
 */
function formatRestriction(restriction: string): string {
  return restriction
    .replace(/^no-/, 'NO ')
    .replace(/^max-(\d+)-/, 'Maximum $1 ')
    .replace(/-/g, ' ');
}

// ============================================
// Exports
// ============================================

export { STYLE_INSTRUCTIONS, ACCENT_PALETTE };
