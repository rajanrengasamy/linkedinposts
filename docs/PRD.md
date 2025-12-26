# PRD: LinkedIn Quote Generator (Phase 0 - CLI)

## Overview

A Node.js/TypeScript CLI tool that aggregates trending content from LinkedIn, X (Twitter), and the web based on a user prompt, scores and validates them, then synthesizes a polished LinkedIn post with supporting infographics.

---

## Data Sources & APIs

### 1. ScrapeCreators.com API
- **Purpose**: Scrape LinkedIn and X (Twitter) posts
- **Endpoints**:
  - LinkedIn: profiles, posts, trending content
  - Twitter: profiles, community tweets
- **Auth**: `x-api-key` header
- **Docs**: [docs.scrapecreators.com](https://docs.scrapecreators.com/)

### 2. Perplexity Sonar Reasoning Pro API
- **Purpose**: Real-time web search with deep reasoning and citations
- **Model**: `sonar-reasoning-pro` (powered by DeepSeek R1 with Chain of Thought)
- **Context**: 200k tokens
- **Features**:
  - Multi-step reasoning with CoT
  - 2-3x more citations than standard models
  - 98% accuracy on reasoning benchmarks
  - Search modes: High/Medium/Low depth
- **Endpoint**: `https://api.perplexity.ai/chat/completions`
- **Docs**: [docs.perplexity.ai/models/sonar-pro](https://docs.perplexity.ai/getting-started/models/models/sonar-pro)

### 3. Google Gemini 3 Flash
- **Purpose**: Score/validate scraped content for relevance, authenticity, recency
- **Context**: 1M input tokens, 64k output tokens
- **Features**: `thinking_level` parameter (minimal/low/medium/high)
- **Pricing**: $0.50/1M input, $3.00/1M output
- **Docs**: [ai.google.dev/gemini-api/docs/gemini-3](https://ai.google.dev/gemini-api/docs/gemini-3)

### 4. OpenAI GPT-5.2 Thinking
- **Purpose**: Synthesis engine - create LinkedIn post from top results
- **Version**: GPT-5.2 Thinking (best for structured content creation)
- **Features**: Context compaction for long workflows
- **Docs**: [platform.openai.com/docs/models/gpt-5.2](https://platform.openai.com/docs/models/gpt-5.2)

### 5. Google Nano Banana Pro
- **Purpose**: Generate supporting infographics/images
- **Built on**: Gemini 3 Pro Image model
- **Output**: Native 4K resolution, accurate text rendering
- **Speed**: Under 10 seconds
- **Pricing**: $0.139 (2K), $0.24 (4K)
- **Docs**: [ai.google.dev/gemini-api/docs/image-generation](https://ai.google.dev/gemini-api/docs/image-generation)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INPUT                                      │
│                         (Topic/Prompt String)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STAGE 1: DATA COLLECTION                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  ScrapeCreators │  │  ScrapeCreators │  │   Perplexity    │              │
│  │   LinkedIn API  │  │    Twitter API  │  │ Sonar Reasoning │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
│           └────────────────────┴────────────────────┘                        │
│                                │                                             │
│                    Raw Results (100-200+ items)                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      STAGE 2: SCORING & VALIDATION                           │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Step 2a: Cross-check with Perplexity Sonar Reasoning Pro           │   │
│  │  • Verify claims against real-time web data                         │   │
│  │  • Check authenticity of quotes and attributions                    │   │
│  │  • Validate dates and recency of information                        │   │
│  │  • Deep reasoning with Chain of Thought                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Step 2b: Score with Google Gemini 3 Flash                          │   │
│  │  For each result, score on:                                         │   │
│  │  • Relevance to prompt (0-100)                                      │   │
│  │  • Authenticity/credibility (0-100) - informed by Perplexity check  │   │
│  │  • Recency/timeliness (0-100)                                       │   │
│  │  • Engagement potential (0-100)                                     │   │
│  │  • Overall weighted score                                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Output: Top 50 results ranked by score                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        STAGE 3: SYNTHESIS                                    │
│                      (OpenAI GPT-5.2 Thinking)                               │
│                                                                              │
│  Input: Top 50 scored results + original prompt                              │
│  Output:                                                                     │
│  • LinkedIn post (markdown)                                                  │
│  • Key quotes with attribution                                               │
│  • Infographic brief for image generation                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      STAGE 4: IMAGE GENERATION                               │
│                      (Google Nano Banana Pro)                                │
│                                                                              │
│  Input: Infographic brief from synthesis stage                               │
│  Output: High-fidelity PNG image (2K or 4K)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FINAL OUTPUT                                       │
│                                                                              │
│  📁 output/                                                                  │
│  ├── raw_data.json          # All scraped results                           │
│  ├── validated_data.json    # Results with Perplexity validation            │
│  ├── scored_data.json       # Results with Gemini scores                    │
│  ├── top_50.json            # Top 50 ranked results                         │
│  ├── synthesis.json         # GPT-5.2 synthesis output                      │
│  ├── linkedin_post.md       # Final LinkedIn post                           │
│  └── infographic.png        # Generated image                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
linkedinquotes/
├── package.json
├── tsconfig.json
├── .env.example              # Template for API keys
├── .gitignore
├── src/
│   ├── index.ts              # CLI entry point
│   ├── config.ts             # Environment & configuration
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   ├── collectors/
│   │   ├── linkedin.ts       # ScrapeCreators LinkedIn
│   │   ├── twitter.ts        # ScrapeCreators Twitter
│   │   └── web.ts            # Perplexity Sonar Reasoning Pro
│   ├── validation/
│   │   └── perplexity.ts     # Cross-check with Sonar Reasoning Pro
│   ├── scoring/
│   │   └── gemini.ts         # Gemini 3 Flash scoring
│   ├── synthesis/
│   │   └── gpt.ts            # GPT-5.2 Thinking synthesis
│   ├── image/
│   │   └── nanoBanana.ts     # Nano Banana Pro generation
│   └── utils/
│       ├── logger.ts         # Console logging
│       └── fileWriter.ts     # JSON/MD/PNG output
└── output/                   # Generated outputs
```

---

## Data Types

```typescript
// Raw scraped item
interface ScrapedItem {
  id: string;
  source: 'linkedin' | 'twitter' | 'web';
  content: string;
  author?: string;
  authorHandle?: string;
  url: string;
  timestamp?: string;
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
  };
  citations?: string[];  // For Perplexity results
}

// Scored item
interface ScoredItem extends ScrapedItem {
  scores: {
    relevance: number;      // 0-100
    authenticity: number;   // 0-100
    recency: number;        // 0-100
    engagement: number;     // 0-100
    overall: number;        // Weighted average
  };
  reasoning: string;        // Why this score
}

// Synthesis output
interface SynthesisResult {
  linkedinPost: string;
  keyQuotes: Array<{
    quote: string;
    author: string;
    source: string;
  }>;
  infographicBrief: {
    title: string;
    keyPoints: string[];
    style: string;
    colorScheme?: string;
  };
  metadata: {
    sourcesUsed: number;
    generatedAt: string;
    prompt: string;
  };
}
```

---

## Implementation Steps

### Step 1: Project Setup
- Initialize Node.js project with TypeScript
- Install dependencies: `axios`, `dotenv`, `commander`, `chalk`
- Configure `tsconfig.json` for ES2022 modules
- Create `.env.example` with API key placeholders

### Step 2: Implement Collectors
- `collectors/linkedin.ts`: ScrapeCreators LinkedIn API integration
- `collectors/twitter.ts`: ScrapeCreators Twitter API integration
- `collectors/web.ts`: Perplexity Sonar Reasoning Pro API integration (with CoT)
- All collectors return `ScrapedItem[]` with unified format

### Step 3: Implement Validation Engine
- `validation/perplexity.ts`: Cross-check with Sonar Reasoning Pro
- Verify claims and quotes against real-time web data
- Check author attributions and publication dates
- Use Chain of Thought reasoning for deep validation
- Returns validation metadata for each item

### Step 4: Implement Scoring Engine
- `scoring/gemini.ts`: Batch scoring with Gemini 3 Flash
- Score each item on 4 dimensions (using validation data)
- Calculate weighted overall score
- Return top 50 sorted by score

### Step 5: Implement Synthesis Engine
- `synthesis/gpt.ts`: GPT-5.2 Thinking integration
- Prompt engineering for LinkedIn-style content
- Generate post + infographic brief
- Handle context length with compaction

### Step 6: Implement Image Generation
- `image/nanoBanana.ts`: Nano Banana Pro integration
- Convert infographic brief to image prompt
- Request 2K or 4K resolution
- Save as PNG

### Step 7: CLI & Output
- `index.ts`: Commander-based CLI
- Accept prompt as argument or interactive input
- Progress logging with stages
- Write all outputs to `output/` directory

---

## CLI Usage

```bash
# Basic usage
npx tsx src/index.ts "AI trends in healthcare 2025"

# With options
npx tsx src/index.ts "AI trends in healthcare 2025" \
  --max-results 50 \
  --image-resolution 4k \
  --output-dir ./my-output
```

---

## Environment Variables

```env
# ScrapeCreators
SCRAPECREATORS_API_KEY=your_key_here

# Perplexity
PERPLEXITY_API_KEY=your_key_here

# Google AI (Gemini + Nano Banana)
GOOGLE_AI_API_KEY=your_key_here

# OpenAI
OPENAI_API_KEY=your_key_here
```

---

## Error Handling Strategy

1. **API Rate Limits**: Implement exponential backoff with retries
2. **Partial Failures**: Continue with available data, log failures
3. **Empty Results**: Graceful degradation with user notification
4. **API Errors**: Detailed error messages with troubleshooting hints

---

## Dependencies

```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "axios": "^1.7.0",
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "dotenv": "^16.4.0",
    "openai": "^4.70.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0"
  }
}
```

---

## Output Examples

### linkedin_post.md
```markdown
# The Future of AI in Healthcare: What Leaders Are Saying

The healthcare AI landscape is evolving rapidly. Here's what top voices
are discussing this week:

> "AI-powered diagnostics are reducing error rates by 40% in radiology"
> — Dr. Sarah Chen, Chief Medical Officer at HealthTech Inc.

**Key Trends:**
1. Predictive analytics for patient outcomes
2. AI-assisted surgical planning
3. Natural language processing for clinical notes

What's your take on AI in healthcare? Share your thoughts below.

#HealthcareAI #FutureOfMedicine #AITrends

---
*Generated from 47 sources across LinkedIn, X, and web*
```

### infographic.png
- 4K resolution PNG
- Clean, professional design
- Key statistics visualized
- Branded color scheme
- Readable text overlay

---

## Success Criteria

1. CLI accepts prompt and generates all outputs in under 2 minutes
2. Scoring provides meaningful differentiation between results
3. LinkedIn post is engaging, well-formatted, and cites sources
4. Infographic is high-quality and relevant to content
5. All intermediate data is saved for debugging/review

---

## Future Phases

- **Phase 1**: Web UI with React/Next.js
- **Phase 2**: Scheduled generation (cron/webhooks)
- **Phase 3**: Multi-platform output (Twitter threads, blog posts)
- **Phase 4**: User accounts and saved templates
