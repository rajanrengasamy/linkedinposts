# Manual Image Generation Approach

A cost-effective pattern for generating AI images without API fees by exporting structured prompts and branding assets for manual generation via consumer subscriptions (Gemini, ChatGPT, etc.).

---

## Problem Statement

API-based image generation is expensive at scale:

| Service | Cost per Image | 100 Images/Month |
|---------|----------------|------------------|
| DALL-E 3 | $0.04-0.12 | $4-12 |
| Gemini Imagen 3 | $0.02-0.04 | $2-4 |
| Midjourney API | ~$0.10 | $10 |

For personal or small-scale projects, these costs add up quickly. Meanwhile, consumer subscriptions (Gemini Advanced, ChatGPT Plus) offer unlimited image generation for a flat monthly fee.

**The Solution**: Export structured prompts and branding guidelines that can be copy-pasted into consumer AI interfaces.

---

## Solution Overview

Instead of calling image generation APIs, the pipeline exports:

1. **Branding Book** - Complete visual identity guidelines
2. **Ready-to-Use Prompts** - Copy-paste prompts for each image
3. **Metadata** - JSON files for programmatic access
4. **Quick-Start Guide** - Instructions for manual workflow

This approach trades automation for cost savings, making it ideal for:
- Personal projects
- Low-volume production (1-10 images/day)
- Projects where human review of images is desired anyway

---

## Architecture

### Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Content Pipeline                             │
├─────────────────────────────────────────────────────────────────────┤
│  Collection → Validation → Scoring → Synthesis → Image Stage        │
│                                                      │               │
│                                          ┌───────────┴───────────┐  │
│                                          │                       │  │
│                                   [--image-mode]                 │  │
│                                          │                       │  │
│                              ┌───────────┴───────────┐           │  │
│                              ▼                       ▼           │  │
│                         "export"                   "api"         │  │
│                              │                       │           │  │
│                    ┌─────────┴─────────┐    ┌───────┴───────┐   │  │
│                    │  Export Prompts   │    │  Call Gemini  │   │  │
│                    │  & Branding Book  │    │  Imagen API   │   │  │
│                    └─────────┬─────────┘    └───────┬───────┘   │  │
│                              │                       │           │  │
│                              ▼                       ▼           │  │
│                    image-assets/            infographic.png      │  │
└─────────────────────────────────────────────────────────────────────┘
```

### Output Structure

```
output/2025-12-30_14-43-11/
├── linkedin_post.md              # Generated post content
├── synthesis.json                # Full synthesis output
├── sources.json                  # Source provenance
├── pipeline_status.json          # Execution metadata
└── image-assets/                 # NEW: Image generation assets
    ├── branding-book.md          # Human-readable brand guide
    ├── branding-book.json        # Machine-readable brand data
    ├── prompts/
    │   ├── infographic-1.txt     # Full prompt for image 1
    │   ├── infographic-2.txt     # Full prompt for image 2 (multi-post)
    │   └── infographic-3.txt     # Full prompt for image 3 (multi-post)
    ├── metadata.json             # Generation metadata
    └── README.md                 # Quick-start instructions
```

---

## Output File Specifications

### branding-book.md

Human-readable markdown containing:

```markdown
# LinkedIn Infographic Branding Guide

## Brand Foundation
- **Background**: Dark charcoal (#1e1e1e to #252525)
- **Frame**: 1-2px rounded border at 15-20% white opacity
- **Typography**: Geometric sans-serif, white text, WCAG AA compliant
- **Icons**: LINE-ART ONLY, 2-3px stroke, accent color

## Accent Color Palette
| Color   | Hex     | Best For                          |
|---------|---------|-----------------------------------|
| Lime    | #a3e635 | Tech, innovation, energy          |
| Cyan    | #22d3ee | Trust, clarity, data              |
| Coral   | #fb7185 | People, community, warmth         |
| Amber   | #fbbf24 | Finance, warnings, attention      |
| Violet  | #a78bfa | AI/ML, creative, future-focused   |
| Sky     | #38bdf8 | Cloud, enterprise, reliability    |
| Emerald | #34d399 | Sustainability, health, growth    |

## Recommended Accent: **Violet** (#a78bfa)
_Selected for: AI and machine learning topics_

## Visual Styles
### Minimal
- Maximum 3 key points
- Large negative space
- Single accent color
- Best for: Simple concepts, quotes

### Data-Heavy
- Charts, graphs, statistics
- Multiple data visualizations
- Numerical emphasis
- Best for: Research findings, surveys

### Quote-Focused
- Large quotation marks
- Attribution styling
- Elegant typography
- Best for: Expert quotes, testimonials
```

### branding-book.json

Machine-readable JSON schema:

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-01-18T10:30:00.000Z",
  "topic": "AI trends in healthcare 2025",
  "background": {
    "colorRange": ["#1e1e1e", "#252525"],
    "type": "solid",
    "restrictions": ["no-gradients", "no-patterns"]
  },
  "typography": {
    "fontFamily": "geometric-sans-serif",
    "titleColor": "#ffffff",
    "bodyColor": "rgba(255,255,255,0.9)",
    "contrastMinimum": "4.5:1"
  },
  "iconStyle": {
    "type": "line-art",
    "strokeWidth": "2-3px",
    "fill": "none",
    "color": "accent"
  },
  "accentPalette": {
    "lime": { "hex": "#a3e635", "usage": "tech, innovation" },
    "cyan": { "hex": "#22d3ee", "usage": "trust, data" },
    "coral": { "hex": "#fb7185", "usage": "people, community" },
    "amber": { "hex": "#fbbf24", "usage": "finance, warnings" },
    "violet": { "hex": "#a78bfa", "usage": "AI/ML, creative" },
    "sky": { "hex": "#38bdf8", "usage": "cloud, enterprise" },
    "emerald": { "hex": "#34d399", "usage": "sustainability" }
  },
  "recommendedAccent": {
    "color": "violet",
    "hex": "#a78bfa",
    "reason": "AI and machine learning topics"
  },
  "styles": {
    "minimal": { "maxPoints": 3, "emphasis": "negative-space" },
    "data-heavy": { "charts": true, "emphasis": "numerical" },
    "quote-focused": { "quotation": true, "emphasis": "typography" }
  },
  "restrictions": [
    "no-light-backgrounds",
    "no-gradient-backgrounds",
    "no-filled-icons",
    "no-stock-photos",
    "no-3d-elements",
    "maximum-3-colors"
  ]
}
```

### prompts/infographic-N.txt

Complete, ready-to-paste prompt:

```
Generate a professional LinkedIn infographic with these specifications:

TITLE: "5 AI Trends Reshaping Healthcare in 2025"

KEY POINTS:
1. Predictive diagnostics reducing misdiagnosis by 40%
2. AI-powered drug discovery cutting development time in half
3. Virtual health assistants handling 60% of routine queries

STYLE: minimal

BRAND REQUIREMENTS:
- Background: Solid dark charcoal (#1e1e1e to #252525)
- Frame: 1-2px rounded border, 15-20% white opacity
- Typography: Geometric sans-serif, white (#ffffff)
- Icons: LINE-ART ONLY with 2-3px stroke
- Accent Color: Violet (#a78bfa)

COMPOSITION:
- Square format (1080x1080 or 2160x2160)
- Title at top, 20-25% of height
- Key points in middle section with icons
- Clean footer area

RESTRICTIONS:
- NO gradients
- NO stock photos
- NO 3D elements
- NO filled icons
- Maximum 3 colors total
```

### metadata.json

Generation context and instructions:

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-01-18T10:30:00.000Z",
  "topic": "AI trends in healthcare 2025",
  "prompts": [
    {
      "postNumber": 1,
      "file": "prompts/infographic-1.txt",
      "charCount": 847,
      "infographicBrief": {
        "title": "5 AI Trends Reshaping Healthcare in 2025",
        "keyPoints": ["Point 1", "Point 2", "Point 3"],
        "suggestedStyle": "minimal",
        "accentColor": "violet"
      }
    }
  ],
  "resolution": {
    "configured": "2k",
    "recommendedPixels": "1080x1080"
  },
  "geminiInstructions": {
    "webUrl": "https://gemini.google.com/",
    "model": "Gemini with Imagen 3",
    "howToUse": [
      "Open gemini.google.com in your browser",
      "Copy the contents of prompts/infographic-1.txt",
      "Paste into Gemini chat",
      "Review generated image",
      "Click download or right-click to save",
      "Rename to infographic-1.png"
    ]
  }
}
```

---

## Branding System

### Accent Color Inference

Colors are automatically selected based on topic keywords:

| Keywords | Inferred Color |
|----------|----------------|
| ai, ml, machine learning, artificial intelligence | Violet |
| tech, innovation, startup, software | Lime |
| data, analytics, systems, architecture | Cyan |
| team, community, people, health, healthcare | Coral |
| finance, investment, money, budget, warning | Amber |
| cloud, enterprise, saas, collaboration | Sky |
| green, sustainability, wellness, eco | Emerald |
| (default) | Violet |

### Implementation

```typescript
function inferAccentColor(brief: InfographicBrief, topic: string): AccentColor {
  // Explicit override takes precedence
  if (brief.accentColor) return brief.accentColor;

  const lowerTopic = topic.toLowerCase();

  // AI/ML topics → Violet
  if (/\b(ai|ml|machine learning|artificial intelligence)\b/.test(lowerTopic)) {
    return 'violet';
  }

  // Tech/Innovation → Lime
  if (/\b(tech|innovation|startup|software)\b/.test(lowerTopic)) {
    return 'lime';
  }

  // ... additional patterns ...

  return 'violet'; // Default
}
```

### Brand Template Constants

The branding system is built on three core constants from `nanoBanana.ts`:

1. **ACCENT_PALETTE** - Color definitions with hex values and usage guidance
2. **BRAND_TEMPLATE** - Visual identity rules (background, typography, icons)
3. **STYLE_INSTRUCTIONS** - Style-specific composition rules (minimal, data-heavy, quote-focused)

---

## Usage Instructions

### Basic Workflow

1. **Run the pipeline** with default export mode:
   ```bash
   npx tsx src/index.ts "AI trends in healthcare 2025"
   ```

2. **Navigate to output**:
   ```bash
   cd output/2025-01-18_10-30-00/image-assets/
   ```

3. **Review branding book** (optional):
   ```bash
   cat branding-book.md
   ```

4. **Copy prompt to Gemini**:
   ```bash
   cat prompts/infographic-1.txt | pbcopy  # macOS
   # Then paste into gemini.google.com
   ```

5. **Generate and download** the image from Gemini

6. **Save to output folder**:
   ```bash
   mv ~/Downloads/gemini-image.png ./infographic-1.png
   ```

### Multi-Post Workflow

For generating multiple variations:

```bash
# Generate 3 post variations
npx tsx src/index.ts "AI trends" --post-count 3

# This creates:
# - prompts/infographic-1.txt
# - prompts/infographic-2.txt
# - prompts/infographic-3.txt

# Generate each image manually, then download
```

### API Mode (When Needed)

For automated workflows where cost is acceptable:

```bash
npx tsx src/index.ts "AI trends" --image-mode api
```

This reverts to the original API-based image generation.

---

## Adaptation Guide

To apply this pattern to other projects:

### 1. Define Your Branding Constants

Create a module with your visual identity:

```typescript
// brandConstants.ts
export const ACCENT_PALETTE = {
  primary: { hex: '#3B82F6', usage: 'main actions' },
  secondary: { hex: '#10B981', usage: 'success states' },
  // ...
};

export const BRAND_TEMPLATE = {
  background: { color: '#0F172A', type: 'solid' },
  typography: { family: 'Inter', titleColor: '#FFFFFF' },
  // ...
};
```

### 2. Create Topic-Based Inference

Map your domain keywords to appropriate styles:

```typescript
function inferStyle(topic: string): StyleType {
  const lower = topic.toLowerCase();
  if (/tutorial|guide|how-to/.test(lower)) return 'step-by-step';
  if (/comparison|vs|versus/.test(lower)) return 'comparison';
  return 'standard';
}
```

### 3. Build Prompt Templates

Create templates that incorporate branding:

```typescript
function buildPrompt(content: Content, brand: BrandData): string {
  return `
Generate an image with these specifications:

CONTENT: ${content.title}
${content.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}

BRAND REQUIREMENTS:
- Background: ${brand.background.color}
- Primary Color: ${brand.accentPalette.primary.hex}
- Typography: ${brand.typography.family}

RESTRICTIONS:
${brand.restrictions.map(r => `- ${r}`).join('\n')}
  `.trim();
}
```

### 4. Export Files

Write branding and prompts to files:

```typescript
async function exportAssets(content: Content, outputDir: string) {
  const brand = generateBrandData(content);

  await writeFile(join(outputDir, 'branding.json'), JSON.stringify(brand));
  await writeFile(join(outputDir, 'branding.md'), renderMarkdown(brand));
  await writeFile(join(outputDir, 'prompt.txt'), buildPrompt(content, brand));
}
```

### 5. Add CLI Toggle

Allow switching between export and API modes:

```typescript
program
  .option('--image-mode <mode>', 'export or api', 'export');

// In pipeline:
if (config.imageMode === 'export') {
  await exportAssets(content, outputDir);
} else {
  await generateViaApi(content);
}
```

---

## Trade-offs

### Advantages

- **Zero marginal cost** - Uses existing subscriptions
- **Human review built-in** - Every image is manually reviewed
- **Flexible iteration** - Easy to regenerate with tweaks
- **No API key management** - Works with browser authentication
- **Consistent branding** - Documented guidelines ensure consistency

### Disadvantages

- **Manual effort** - Requires copy-paste workflow
- **Not scalable** - Impractical for high-volume generation
- **No automation** - Can't be fully automated in CI/CD
- **Time overhead** - Adds 1-2 minutes per image

### When to Use Each Mode

| Scenario | Recommended Mode |
|----------|------------------|
| Personal blog, 1-5 images/week | Export |
| A/B testing variations | Export |
| Client deliverables needing review | Export |
| Automated content pipeline | API |
| High-volume production (50+/day) | API |
| CI/CD integration required | API |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-18 | Initial implementation |

---

## Related Files

- `src/image/promptExport.ts` - Main export orchestration
- `src/image/brandingBook.ts` - Branding book generation
- `src/image/nanoBanana.ts` - Prompt building and API generation
- `src/image/types.ts` - Type definitions
- `tests/unit/promptExport.test.ts` - Export tests
- `tests/unit/brandingBook.test.ts` - Branding book tests
