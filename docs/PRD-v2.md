# PRD: LinkedIn Post Generator (Phase 0 - CLI)

**Version**: 2.3
**Last Updated**: 2025-12-31
**Status**: Draft
**Schema Version**: 1.0.0

---

## Table of Contents

1. [Overview](#overview)
2. [Compliance & Legal](#compliance--legal)
3. [Product Scope](#product-scope)
4. [Data Sources & APIs](#data-sources--apis)
5. [Architecture](#architecture)
6. [Data Types & Schemas](#data-types--schemas)
7. [Verification Framework](#verification-framework)
8. [Deduplication Strategy](#deduplication-strategy)
9. [Failure Modes & Graceful Degradation](#failure-modes--graceful-degradation)
10. [Performance & Cost Controls](#performance--cost-controls)
11. [Security & Privacy](#security--privacy)
12. [CLI Interface](#cli-interface)
13. [Multi-Post Generation](#multi-post-generation)
14. [Prompt Refinement Phase](#prompt-refinement-phase)
15. [Synthesis Model Selection](#synthesis-model-selection)
16. [Output Files](#output-files)
17. [Project Structure](#project-structure)
18. [Implementation Steps](#implementation-steps)
19. [Testing Strategy](#testing-strategy)
20. [Success Criteria](#success-criteria)
21. [Definition of Done](#definition-of-done)
22. [Open Questions](#open-questions)
23. [Future Phases](#future-phases)

---

## Overview

A Node.js/TypeScript CLI tool that aggregates content from web sources (and optionally LinkedIn/X) based on a user prompt, validates and scores the content, then synthesizes a polished LinkedIn post with optional supporting infographics.

**Primary Goal**: Generate high-quality, source-backed LinkedIn posts with full provenance tracking.

**Key Principle**: No quote or claim appears in the final output unless it has a verified source URL.

---

## Compliance & Legal

### Intended Usage

| Mode | Description | Risk Level |
|------|-------------|------------|
| **Web-Only (Default)** | Uses only Perplexity web search | Low |
| **Full Sources** | Includes LinkedIn/X via ScrapeCreators | Medium-High |

### Data Handling Policy

1. **Minimal Data Collection**: By default, only processed/scored data is persisted. Raw API responses require explicit `--save-raw` flag.

2. **Retention Guidelines**:
   - Output files: User responsibility (recommend deletion after 30 days for shared environments)
   - No cloud storage or transmission of scraped data
   - All processing is local/ephemeral

3. **Content Attribution**:
   - All quotes must include source URL
   - Author names are included only when publicly available
   - No private/DM content is accessed

### Platform ToS Considerations

| Platform | API Used | ToS Notes |
|----------|----------|-----------|
| LinkedIn | ScrapeCreators (unofficial) | May violate ToS; use at own risk; gated behind `--sources linkedin` flag |
| X/Twitter | ScrapeCreators (unofficial) | May violate ToS; use at own risk; gated behind `--sources x` flag |
| Web | Perplexity (official API) | Compliant; uses licensed search API |

### Safe Mode (Recommended for Commercial Use)

```bash
# Safe mode: web sources only (default)
npx tsx src/index.ts "AI trends in healthcare"

# Full mode: all sources (use with caution)
npx tsx src/index.ts "AI trends in healthcare" --sources web,linkedin,x
```

**Recommendation**: For commercial or shared use, stick to web-only mode (`--sources web`).

---

## Product Scope

### What This Tool Does (Phase 0 MVP)

1. **Collects** relevant content from web sources (default) or social platforms (optional)
2. **Validates** claims and quotes against real-time web data
3. **Scores** content for relevance, authenticity, recency, and engagement potential
4. **Synthesizes** a LinkedIn-ready post with proper attribution
5. **Generates** an optional infographic (can fail gracefully)

### What This Tool Does NOT Do

- Does not post directly to LinkedIn (manual copy/paste required)
- Does not guarantee factual accuracy (provides verification levels, not truth)
- Does not access private or DM content
- Does not store user credentials

### Content Definition: "Trending"

| Parameter | Default | Description |
|-----------|---------|-------------|
| Time Window | 7 days | Content published within this period |
| Min Engagement | 10 interactions | Likes + comments + shares threshold |
| Language | English | Primary language filter |
| Region | Global | No geographic restriction |

### Query Strategy

For each user prompt, the system derives 3-5 sub-queries:
1. Direct keyword search
2. "Expert opinions on {topic}"
3. "Latest news {topic} 2025"
4. "{topic} statistics data"
5. "Trending {topic}" (if social sources enabled)

---

## Data Sources & APIs

### 1. Perplexity Sonar Reasoning Pro API (Primary)

- **Purpose**: Web search + validation with deep reasoning
- **Model**: `sonar-reasoning-pro` (powered by DeepSeek R1 with CoT)
- **Context**: 200k tokens
- **Role**: Both data collection AND validation cross-checking
- **Features**:
  - Multi-step reasoning with Chain of Thought
  - 2-3x more citations than standard models
  - 98% accuracy on reasoning benchmarks
  - Search depth modes: High/Medium/Low
- **Endpoint**: `https://api.perplexity.ai/chat/completions`
- **Docs**: [docs.perplexity.ai](https://docs.perplexity.ai/)

### 2. ScrapeCreators.com API (Optional, Gated)

- **Purpose**: Scrape LinkedIn and X (Twitter) posts
- **Endpoints**:
  - LinkedIn: `/v1/linkedin/profile`, `/v1/linkedin/post`
  - Twitter: `/v1/twitter/search`
- **Note**: `/v1/twitter/community/tweets` is not currently implemented
- **Auth**: `x-api-key` header
- **Compliance**: Unofficial API; may violate platform ToS
- **Gating**: Only used when `--sources linkedin` or `--sources x` specified
- **Docs**: [docs.scrapecreators.com](https://docs.scrapecreators.com/)

### 3. Google Gemini 3 Flash

- **Purpose**: Batch scoring of content
- **Context**: 1M input tokens, 64k output tokens
- **Features**: `thinking_level` parameter (minimal/low/medium/high)
- **Pricing**: $0.50/1M input, $3.00/1M output
- **Docs**: [ai.google.dev/gemini-api/docs/gemini-3](https://ai.google.dev/gemini-api/docs/gemini-3)

### 4. OpenAI GPT-5.2 Thinking

- **Purpose**: Synthesis engine - create LinkedIn post from validated sources
- **Version**: GPT-5.2 Thinking (structured content creation)
- **Features**: Context compaction for long workflows
- **Docs**: [platform.openai.com/docs/models/gpt-5.2](https://platform.openai.com/docs/models/gpt-5.2)

### 5. Google Nano Banana Pro (Optional)

- **Purpose**: Generate supporting infographics
- **Built on**: Gemini 3 Pro Image model
- **Output**: Native 4K resolution, accurate text rendering
- **Speed**: Under 10 seconds
- **Pricing**: $0.139 (2K), $0.24 (4K)
- **Risk**: May misspell or misrender text; always optional
- **Docs**: [ai.google.dev/gemini-api/docs/image-generation](https://ai.google.dev/gemini-api/docs/image-generation)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INPUT                                      │
│                         (Topic/Prompt String)                                │
│                    + CLI Options (sources, quality, etc.)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STAGE 1: DATA COLLECTION (Parallel)                       │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   Perplexity    │  │  ScrapeCreators │  │  ScrapeCreators │              │
│  │ Sonar Reasoning │  │   LinkedIn API  │  │    Twitter API  │              │
│  │   (Default)     │  │   (Optional)    │  │   (Optional)    │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
│           └────────────────────┴────────────────────┘                        │
│                                │                                             │
│                    ┌───────────┴───────────┐                                 │
│                    │   Normalize + Dedup   │                                 │
│                    │  (Hash + Similarity)  │                                 │
│                    └───────────┬───────────┘                                 │
│                                │                                             │
│              RawItem[] (capped at MAX_ITEMS_PER_SOURCE)                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 STAGE 2: VALIDATION (Perplexity Reasoning)                   │
│                         [Can be skipped: --skip-validation]                  │
│                                                                              │
│  For each item with potential quotes/claims:                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  • Cross-check quote against web sources                            │   │
│  │  • Verify author attribution                                        │   │
│  │  • Validate publication date                                        │   │
│  │  • Assign verification level:                                       │   │
│  │    - UNVERIFIED: Could not verify                                   │   │
│  │    - SOURCE_CONFIRMED: Found in one web source                      │   │
│  │    - MULTISOURCE_CONFIRMED: Found in 2+ independent sources         │   │
│  │    - PRIMARY_SOURCE: Confirmed from original/authoritative source   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Output: ValidatedItem[]                                                     │
│  Failure: Items marked UNVERIFIED, pipeline continues                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STAGE 3: SCORING (Gemini 3 Flash)                         │
│                         [Can be skipped: --skip-scoring]                     │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  For each ValidatedItem, score on:                                   │   │
│  │  • Relevance to prompt (0-100) — weight: 35%                         │   │
│  │  • Authenticity (0-100) — weight: 30% (uses verification level)     │   │
│  │  • Recency (0-100) — weight: 20%                                     │   │
│  │  • Engagement potential (0-100) — weight: 15%                        │   │
│  │  • Overall = weighted average                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Output: Top N items as ScoredItem[] (default N=50)                          │
│  Failure: Fallback to heuristic scoring (recency + engagement only)          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STAGE 4: SYNTHESIS (GPT-5.2 Thinking)                     │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Step 4a: Extract Grounded Claims                                    │   │
│  │  • Identify quotable statements with source URLs                    │   │
│  │  • Filter: only items with verification >= SOURCE_CONFIRMED         │   │
│  │  • Extract key statistics and data points                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Step 4b: Draft LinkedIn Post                                        │   │
│  │  • Use only grounded claims from 4a                                  │   │
│  │  • Apply output constraints (length, tone, hashtags)                 │   │
│  │  • Generate infographic brief                                        │   │
│  │  • Include fact-check summary                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Output: SynthesisResult with linkedinPost, keyQuotes, infographicBrief     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 STAGE 5: IMAGE GENERATION (Nano Banana Pro)                  │
│                         [Optional: skipped with --skip-image]                │
│                                                                              │
│  Input: Infographic brief from synthesis stage                               │
│  Output: High-fidelity PNG image (2K or 4K)                                  │
│  Failure: Log warning, continue without image (non-blocking)                 │
│                                                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FINAL OUTPUT                                       │
│                                                                              │
│  📁 output/{timestamp}/                                                      │
│  ├── raw_data.json          # Only if --save-raw (RawItem[])                │
│  ├── validated_data.json    # ValidatedItem[]                               │
│  ├── scored_data.json       # ScoredItem[]                                  │
│  ├── top_50.json            # Top 50 with ID references to raw              │
│  ├── synthesis.json         # Full synthesis output + fact-check summary    │
│  ├── sources.json           # Provenance: URLs, titles, timestamps          │
│  ├── sources.md             # Human-readable source list                    │
│  ├── linkedin_post.md       # Final LinkedIn post                           │
│  └── infographic.png        # Generated image (if not skipped)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Types & Schemas

**Schema Version**: 1.0.0

All model outputs are validated using Zod schemas. Invalid responses trigger retry with "fix JSON" prompt.

### RawItem (Collected Data)

```typescript
interface RawItem {
  // Identity & Provenance
  id: string;                          // UUID, stable across pipeline
  schemaVersion: '1.0.0';
  source: 'web' | 'linkedin' | 'x';
  sourceUrl: string;                   // Original URL (required)
  retrievedAt: string;                 // ISO 8601 timestamp
  rawResponseRef?: string;             // Reference to raw API response (if --save-raw)

  // Content
  content: string;                     // Main text content
  contentHash: string;                 // Normalized hash for dedup
  title?: string;                      // Article/post title if available

  // Attribution
  author?: string;                     // Display name
  authorHandle?: string;               // @handle for social, domain for web
  authorUrl?: string;                  // Profile/author page URL
  publishedAt?: string;                // When content was published (if known)

  // Engagement (normalized across platforms)
  engagement: {
    likes: number;
    comments: number;
    shares: number;
    // X-specific (optional)
    retweets?: number;
    quotes?: number;
    replies?: number;
    impressions?: number;
    // LinkedIn-specific (optional)
    reactions?: number;
  };

  // Web-specific
  citations?: string[];                // Source URLs from Perplexity
}
```

### ValidatedItem (After Verification)

```typescript
type VerificationLevel =
  | 'UNVERIFIED'              // Could not verify
  | 'SOURCE_CONFIRMED'        // Found in one web source
  | 'MULTISOURCE_CONFIRMED'   // Found in 2+ independent sources
  | 'PRIMARY_SOURCE';         // Confirmed from authoritative source

interface ValidatedItem extends RawItem {
  validation: {
    level: VerificationLevel;
    confidence: number;               // 0.0 - 1.0
    checkedAt: string;                // ISO 8601
    sourcesFound: string[];           // URLs where verified
    notes: string[];                  // Brief bullet points (not CoT)
    quotesVerified: Array<{
      quote: string;
      verified: boolean;
      sourceUrl?: string;
    }>;
  };
}
```

### ScoredItem (After Scoring)

```typescript
interface ScoredItem extends ValidatedItem {
  scores: {
    relevance: number;                // 0-100
    authenticity: number;             // 0-100 (based on verification level)
    recency: number;                  // 0-100
    engagementPotential: number;      // 0-100
    overall: number;                  // Weighted average
  };
  scoreReasoning: string[];           // Brief bullet points
  rank: number;                       // Position in sorted list
}
```

### SynthesisResult (Final Output)

```typescript
interface SynthesisResult {
  schemaVersion: '1.0.0';
  generatedAt: string;
  prompt: string;

  linkedinPost: string;

  keyQuotes: Array<{
    quote: string;
    author: string;
    sourceUrl: string;                // Required - no quote without source
    verificationLevel: VerificationLevel;
  }>;

  infographicBrief: {
    title: string;
    keyPoints: string[];
    suggestedStyle: 'minimal' | 'data-heavy' | 'quote-focused';
    colorScheme?: string;
  };

  factCheckSummary: {
    totalSourcesUsed: number;
    verifiedQuotes: number;
    unverifiedClaims: number;
    primarySources: number;
    warnings: string[];               // Any caveats about content
  };

  metadata: {
    sourcesUsed: number;
    processingTimeMs: number;
    estimatedCost: {
      perplexity: number;
      gemini: number;
      openai: number;
      nanoBanana: number;
      total: number;
    };
  };
}
```

### SourceReference (Provenance)

```typescript
interface SourceReference {
  id: string;                         // References RawItem.id
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: string;
  verificationLevel: VerificationLevel;
  usedInPost: boolean;               // Whether quoted in final output
}
```

---

## Verification Framework

### Verification Levels Defined

| Level | Criteria | Authenticity Score Boost |
|-------|----------|--------------------------|
| `UNVERIFIED` | Could not find corroborating sources | 0 |
| `SOURCE_CONFIRMED` | Quote/claim found in 1 web source | +25 |
| `MULTISOURCE_CONFIRMED` | Found in 2+ independent sources | +50 |
| `PRIMARY_SOURCE` | Confirmed from original author/publication | +75 |

### Verification Process

1. **Extract Claims**: Identify specific quotes and factual claims
2. **Web Cross-Check**: Query Perplexity for each claim
3. **Source Matching**: Check if found sources are independent
4. **Primary Source Detection**: Check if source is original (author's site, official publication)
5. **Assign Level**: Based on criteria above

### Quote Eligibility Rules

- **For Inclusion in Final Post**: Minimum `SOURCE_CONFIRMED`
- **For "Expert Says" Attribution**: Minimum `MULTISOURCE_CONFIRMED`
- **For Statistical Claims**: Minimum `PRIMARY_SOURCE` recommended

---

## Deduplication Strategy

### Phase 1: Deterministic Hash

```typescript
function normalizeForHash(content: string): string {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')     // Remove URLs
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '') // Remove emoji
    .replace(/[^\w\s]/g, '')             // Remove punctuation
    .replace(/\s+/g, ' ')                // Collapse whitespace
    .trim();
}

function contentHash(content: string): string {
  return crypto.createHash('sha256')
    .update(normalizeForHash(content))
    .digest('hex')
    .substring(0, 16);
}
```

### Phase 2: Similarity Threshold (Optional)

If duplicates still appear after hash dedup:
- Use token-based Jaccard similarity
- Threshold: 0.85 (configurable)
- **No embeddings at Phase 0** (cost/complexity)

```typescript
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeForHash(a).split(' '));
  const setB = new Set(normalizeForHash(b).split(' '));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}
```

---

## Failure Modes & Graceful Degradation

| Stage | Failure | Behavior |
|-------|---------|----------|
| **Collection: LinkedIn** | API error/timeout | Log warning, continue with other sources |
| **Collection: Twitter** | API error/timeout | Log warning, continue with other sources |
| **Collection: Web** | API error/timeout | **FATAL**: Web is required; exit with error |
| **Collection: All fail** | No data | Exit with clear error message |
| **Validation** | Perplexity timeout | Mark all items `UNVERIFIED`, reduce authenticity weight to 0 |
| **Validation** | Parse error | Retry once, then mark `UNVERIFIED` |
| **Scoring** | Gemini error | Use fallback heuristic: `overall = (recency * 0.5) + (engagement * 0.5)` |
| **Scoring** | Parse error | Retry once with "fix JSON" prompt, then use fallback |
| **Synthesis** | GPT error | **FATAL**: Cannot generate post without synthesis |
| **Synthesis** | Parse error | Retry once, then exit with partial output saved |
| **Image Gen** | Any error | Log warning, skip image, continue (non-blocking) |

### Partial Output Handling

If pipeline fails mid-way:
- All completed stage outputs are saved
- `pipeline_status.json` written with failure details
- User can resume or debug from saved state

---

## Performance & Cost Controls

### Default Budgets

| Parameter | Default | Flag to Override |
|-----------|---------|------------------|
| Max items per source | 25 | `--max-per-source 50` |
| Max total items | 75 | `--max-total 150` |
| Validation batch size | 10 | `--validation-batch 5` |
| Scoring batch size | 25 | `--scoring-batch 10` |
| Pipeline timeout | 180s | `--timeout 300` |
| Stage timeout | 60s | (internal) |

### Quality Profiles

```bash
# Fast mode: fewer items, skip validation, skip image
npx tsx src/index.ts "topic" --fast

# Quality mode (default): balanced
npx tsx src/index.ts "topic"

# Thorough mode: more items, all stages, 4K image
npx tsx src/index.ts "topic" --quality thorough
```

| Profile | Max Items | Validation | Scoring | Image |
|---------|-----------|------------|---------|-------|
| `fast` | 30 total | Skipped | Skipped | Skipped |
| `default` | 75 total | Enabled | Enabled | 2K |
| `thorough` | 150 total | Enabled | Enabled | 4K |

### Concurrency Limits

| API | Max Concurrent Requests |
|-----|-------------------------|
| Perplexity | 3 |
| ScrapeCreators | 5 |
| Gemini | 2 |
| OpenAI | 1 |
| Nano Banana | 1 |

### Cost Estimation

```bash
# Print estimated cost before running
npx tsx src/index.ts "topic" --print-cost-estimate
```

Rough estimates per run (default profile):
- Perplexity: ~$0.05-0.15
- Gemini: ~$0.01-0.03
- OpenAI: ~$0.10-0.30
- Nano Banana: ~$0.14-0.24
- **Total**: ~$0.30-0.72 per run

---

## Security & Privacy

### Secrets Handling

1. **Never Log API Keys**: All logging sanitizes environment variables
2. **Fail Fast on Missing Keys**: Validate at startup, clear error messages
3. **Key Validation**: Test API connectivity before full pipeline run
4. **Future**: Support OS keychain (Phase 1+)

### Data Minimization

| Flag | Behavior |
|------|----------|
| Default | Only processed data saved; raw API responses discarded |
| `--save-raw` | Save raw API responses for debugging |

### Content Privacy

- No private/DM content accessed
- Only public posts and web content
- Author names included only when publicly displayed
- No PII extraction or storage beyond what's in source content

---

## CLI Interface

### Basic Usage

```bash
npx tsx src/index.ts <prompt> [options]
```

### All Options

```bash
Options:
  # Source Control
  --sources <list>           Comma-separated: web,linkedin,x (default: "web")

  # Stage Control
  --skip-validation          Skip verification stage
  --skip-scoring             Skip Gemini scoring (use heuristics)
  --skip-image               Skip infographic generation

  # Quality Profiles
  --fast                     Fast mode: minimal processing
  --quality <level>          Quality level: fast|default|thorough

  # Limits
  --max-per-source <n>       Max items per source (default: 25)
  --max-total <n>            Max total items (default: 75)
  --max-results <n>          Alias for --max-total

  # Output
  --output-dir <path>        Output directory (default: ./output)
  --save-raw                 Save raw API responses
  --image-resolution <res>   Image resolution: 2k|4k (default: 2k)

  # Multi-Post Generation
  --post-count <n>           Number of posts to generate, 1-3 (default: 1)
  --post-style <style>       Post style: series|variations (default: variations)

  # Performance
  --timeout <seconds>        Pipeline timeout (default: 180)
  --print-cost-estimate      Print cost estimate and exit

  # Debug
  --verbose                  Show detailed progress
  --dry-run                  Validate config and exit

  -h, --help                 Show help
  -V, --version              Show version
```

### Examples

```bash
# Safe mode: web only (recommended)
npx tsx src/index.ts "AI trends in healthcare 2025"

# Include social sources (use with caution)
npx tsx src/index.ts "AI trends" --sources web,linkedin,x

# Fast draft (no validation, no image)
npx tsx src/index.ts "AI trends" --fast

# High quality with 4K image
npx tsx src/index.ts "AI trends" --quality thorough --image-resolution 4k

# Debug: save everything
npx tsx src/index.ts "AI trends" --save-raw --verbose

# Cost check before running
npx tsx src/index.ts "AI trends" --print-cost-estimate

# Generate 3 post variations for A/B testing
npx tsx src/index.ts "AI trends" --post-count 3

# Generate 3-part series for deep-dive topic
npx tsx src/index.ts "AI trends" --post-count 3 --post-style series

# 3 variations without images (save costs)
npx tsx src/index.ts "AI trends" --post-count 3 --skip-image
```

---

## Multi-Post Generation

The tool supports generating multiple LinkedIn posts from a single pipeline run, useful for A/B testing hooks or creating multi-part content series.

### Post Styles

| Style | Description | Use Case |
|-------|-------------|----------|
| `variations` (default) | Same topic, different angles/hooks. Each post stands alone. | A/B testing, picking the best hook |
| `series` | Connected multi-part thread (Part 1/3, 2/3, 3/3). Posts build on each other. | Deep-dive topics needing more than 3000 chars |

### How It Works

**Variations Mode:**
- GPT generates N distinct posts about the same topic
- Each post uses a DIFFERENT opening hook/angle
- Posts use different subsets of the verified claims
- No key quotes are repeated across posts

**Series Mode:**
- GPT generates a connected N-part series
- Part 1: Introduction and context
- Part 2: Deep dive / main insights
- Part 3: Conclusions and call-to-action
- Each part references its position (e.g., "Part 1/3: ...")
- Earlier parts end with teasers for the next

### Output Files (Multi-Post)

When `--post-count` > 1:

```
output/{timestamp}/
├── synthesis.json              # Contains all posts
├── linkedin_post_1.md          # Individual post files
├── linkedin_post_2.md
├── linkedin_post_3.md
├── linkedin_posts_combined.md  # All posts in one file
├── infographic_1.png           # One infographic per post
├── infographic_2.png
├── infographic_3.png
├── sources.json
├── sources.md
└── pipeline_status.json
```

### Cost Implications

| Posts | Est. GPT Cost | Image Cost (2K) | Total |
|-------|---------------|-----------------|-------|
| 1     | ~$0.10-0.30   | ~$0.14          | ~$0.24-0.44 |
| 2     | ~$0.12-0.38   | ~$0.28          | ~$0.40-0.66 |
| 3     | ~$0.15-0.45   | ~$0.42          | ~$0.57-0.87 |

**Note:** A single GPT call generates all posts (more efficient than N separate calls). Use `--skip-image` to reduce costs when testing.

### Constraints

- Maximum 3 posts per run (cost control)
- Each post still limited to 3000 characters
- Each post must have 3-5 hashtags
- All quotes must have source URLs

---

## Prompt Refinement Phase

The pipeline includes an intelligent prompt refinement phase that runs before data collection. This phase uses LLM analysis to optimize user prompts for better search results and content generation.

### How It Works

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 0: PROMPT REFINEMENT (Interactive)            │
│                    [Skip with --skip-refinement]                 │
│                                                                  │
│  1. LLM analyzes prompt for clarity and specificity              │
│  2. If CLEAR: Suggests optimized version                         │
│  3. If AMBIGUOUS: Asks clarifying questions via CLI              │
│  4. User confirms refined prompt before proceeding               │
│                                                                  │
│  Output: Refined prompt string                                   │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
[Existing pipeline continues: Collection → Validation → ...]
```

### Refinement Models

| Model | Option Value | Provider | Use Case |
|-------|--------------|----------|----------|
| Gemini 3.0 Flash | `gemini` (default) | Google | Fast, cost-effective |
| GPT-5.2 | `gpt` | OpenAI | Most capable reasoning |
| Claude Sonnet 4.5 | `claude` | Anthropic | Balanced reasoning |
| Kimi 2 | `kimi2` | OpenRouter | Deep reasoning, extended context |

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--skip-refinement` | Skip prompt refinement phase | false (refinement ON) |
| `--refinement-model <model>` | Model: gemini\|gpt\|claude\|kimi2 | gemini |

### Prompt Analysis Criteria

The LLM evaluates prompts on:
- **Topic specificity**: Is the topic concrete enough to research?
- **Audience clarity**: Who is the LinkedIn audience?
- **Angle/perspective**: What unique angle should the post take?
- **Timeframe**: Is there a relevant time context?
- **Tone expectations**: Professional, thought-leadership, personal?

### Clarifying Questions

If the prompt is ambiguous, the system asks 2-4 targeted questions:
- Questions are displayed in the CLI
- User answers via stdin
- Answers are incorporated into the refined prompt
- Maximum 3 refinement iterations

### Example Flow

```bash
$ npx tsx src/index.ts "AI trends"

Analyzing prompt...

I need some clarification:
  1. Which industry should the AI trends focus on? (healthcare, finance, etc.)
  2. Are you looking for current trends (2025) or emerging predictions?
  3. Should this be thought-leadership style or data-driven insights?

Your answers:
1: healthcare
2: current trends with some predictions
3: data-driven with expert quotes

Refined prompt:
"AI trends in healthcare 2025: current adoption patterns and near-term
predictions, with emphasis on data-driven insights and expert perspectives"

Accept this refined prompt? [Y/n/feedback]:
```

### API Key Requirements

| Model | Required Key |
|-------|-------------|
| gemini | GOOGLE_AI_API_KEY |
| gpt | OPENAI_API_KEY |
| claude | ANTHROPIC_API_KEY |
| kimi2 | OPENROUTER_API_KEY |

### Failure Handling

| Failure | Behavior |
|---------|----------|
| LLM error | Retry 3x with backoff, then skip refinement with warning |
| Parse error | Retry with fix prompt, then skip refinement |
| User Ctrl+C | Use original prompt, continue pipeline |
| Timeout | Skip refinement with warning, use original |

---

## Output Files

### Directory Structure

```
output/{timestamp}/
├── raw_data.json          # RawItem[] (only with --save-raw)
├── validated_data.json    # ValidatedItem[]
├── scored_data.json       # ScoredItem[]
├── top_50.json            # Top 50 items with full data
├── synthesis.json         # SynthesisResult
├── sources.json           # SourceReference[] (provenance)
├── sources.md             # Human-readable source list
├── linkedin_post.md       # Final post (copy-paste ready)
├── infographic.png        # Generated image (if not skipped)
└── pipeline_status.json   # Run metadata and any errors
```

### sources.json Example

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2025-12-26T10:30:00Z",
  "totalSources": 47,
  "sources": [
    {
      "id": "abc123",
      "url": "https://example.com/article",
      "title": "AI in Healthcare: 2025 Trends",
      "author": "Dr. Jane Smith",
      "publishedAt": "2025-12-20T08:00:00Z",
      "retrievedAt": "2025-12-26T10:25:00Z",
      "verificationLevel": "PRIMARY_SOURCE",
      "usedInPost": true
    }
  ]
}
```

### sources.md Example

```markdown
# Sources

Generated: 2025-12-26 10:30:00 UTC
Total Sources: 47
Used in Post: 5

## Primary Sources (3)
1. [AI in Healthcare: 2025 Trends](https://example.com/article) - Dr. Jane Smith (2025-12-20)
2. ...

## Multi-Source Confirmed (12)
...

## Source Confirmed (25)
...

## Unverified (7)
...
```

### linkedin_post.md Constraints

| Constraint | Value |
|------------|-------|
| Max Length | 3000 characters (LinkedIn limit) |
| Hashtags | 3-5 relevant tags |
| Tone | Professional but approachable |
| Quotes | Only with source URL |
| Call to Action | Required |

---

## Project Structure

```
linkedinquotes/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── docs/
│   ├── PRD-v2.md
│   └── TODO-v2.md
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── config.ts                # Environment & configuration
│   ├── schemas/                 # Zod schemas for all types
│   │   ├── index.ts
│   │   ├── rawItem.ts
│   │   ├── validatedItem.ts
│   │   ├── scoredItem.ts
│   │   └── synthesisResult.ts
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   ├── collectors/
│   │   ├── index.ts             # Orchestrator
│   │   ├── web.ts               # Perplexity Sonar
│   │   ├── linkedin.ts          # ScrapeCreators LinkedIn
│   │   └── twitter.ts           # ScrapeCreators Twitter
│   ├── processing/
│   │   ├── normalize.ts         # Content normalization
│   │   └── dedup.ts             # Deduplication logic
│   ├── validation/
│   │   └── perplexity.ts        # Verification engine
│   ├── scoring/
│   │   ├── gemini.ts            # Gemini scoring
│   │   └── fallback.ts          # Heuristic fallback
│   ├── synthesis/
│   │   ├── claims.ts            # Claim extraction
│   │   └── gpt.ts               # Post generation
│   ├── image/
│   │   └── nanoBanana.ts        # Image generation
│   └── utils/
│       ├── logger.ts            # Console logging (sanitized)
│       ├── fileWriter.ts        # JSON/MD/PNG output
│       ├── retry.ts             # Exponential backoff
│       └── cost.ts              # Cost estimation
├── tests/
│   ├── unit/                    # Unit tests
│   ├── mocks/                   # API response fixtures
│   └── golden/                  # Golden test cases
└── output/                      # Generated outputs (gitignored)
```

---

## Implementation Steps

### Step 1: Project Setup
- Initialize Node.js + TypeScript
- Install dependencies (axios, dotenv, commander, chalk, zod, openai, @google/generative-ai)
- Configure tsconfig.json
- Create .env.example with all API keys
- Set up .gitignore

### Step 2: Schemas & Types
- Implement Zod schemas for all data types
- Add schema validation helpers
- Add JSON parsing with retry logic

### Step 3: Core Utilities
- Logger with sanitization (never log secrets)
- File writer with directory creation
- Retry wrapper with exponential backoff
- Cost estimator

### Step 4: Collectors
- Web collector (Perplexity) - required
- LinkedIn collector (ScrapeCreators) - optional, gated
- Twitter collector (ScrapeCreators) - optional, gated
- Orchestrator with parallel execution + dedup

### Step 5: Validation Engine
- Perplexity-based verification
- Verification level assignment
- Batch processing with concurrency limits

### Step 6: Scoring Engine
- Gemini batch scoring
- Fallback heuristic scoring
- Schema validation of responses

### Step 7: Synthesis Engine
- Claim extraction (grounded facts only)
- Post generation with constraints
- Infographic brief generation
- Fact-check summary

### Step 8: Image Generation
- Nano Banana Pro integration
- Graceful failure handling
- Resolution options

### Step 9: CLI
- Commander setup with all options
- Quality profiles
- Cost estimation mode
- Pipeline orchestration

### Step 10: Testing
- Unit tests for core logic
- Mocked API tests
- Golden tests for prompts
- Evaluation harness

---

## Testing Strategy

### Unit Tests (Required)
- Normalization functions
- Deduplication logic
- Schema validation
- Hash generation
- Cost calculation

### Integration Tests (Mocked APIs)
- Collector parsing with fixture responses
- Validation flow with mocked Perplexity
- Scoring flow with mocked Gemini
- Synthesis flow with mocked GPT

### Golden Tests
- Prompt → expected JSON structure
- Validate output format consistency

### Evaluation Harness
```bash
npx tsx tests/evaluate.ts
```
Checks:
- [ ] No quotes without source URLs
- [ ] Post length within limits
- [ ] All intermediate files written
- [ ] Sources.json references valid IDs
- [ ] Verification levels correctly assigned

---

## Success Criteria

1. **Reliability**: CLI completes end-to-end with `--sources web` in < 2 minutes
2. **Safety**: No quote appears without a source URL
3. **Provenance**: All outputs traceable to source via stable IDs
4. **Graceful Failure**: Partial failures don't crash pipeline
5. **Cost Visibility**: Estimated cost shown before expensive operations
6. **Compliance**: Social sources gated behind explicit flags

---

## Definition of Done (Phase 0)

- [ ] CLI runs end-to-end with `--sources web` and produces valid output
- [ ] Optional LinkedIn/X sources gated behind flags with documented compliance caveats
- [ ] No quote appears in final post unless it has source URL and verification metadata
- [ ] All model outputs are schema-validated; failures degrade gracefully
- [ ] Provenance chain: every output item links to source via stable ID
- [ ] `sources.json` and `sources.md` included in every run
- [ ] Small offline test suite passes with mocked API responses
- [ ] Cost estimation available via `--print-cost-estimate`
- [ ] README with setup instructions and usage examples

---

## Open Questions (To Resolve Before Implementation)

1. **Compliance Stance**: What is the intended usage? Personal tool vs commercial SaaS affects ToS risk tolerance.

2. **Citation Format**: Should citations appear inline in the post, or in a separate "Sources" appendix at the end?

3. **Minimum Verification Bar**: For a quote to appear in the final post, is `SOURCE_CONFIRMED` sufficient, or require `MULTISOURCE_CONFIRMED`?

4. **Cost/Latency Targets**: What's the maximum acceptable cost per run? Maximum acceptable latency?

5. **Language/Region**: English-only initially, or support for other languages? Specific regions to focus on?

6. **Error Budget**: What percentage of runs can fail? (e.g., 1 in 10 acceptable for Phase 0?)

---

## Known Limitations

The following limitations exist in the current implementation:

1. **LinkedIn Collection**: Uses a curated list of profiles rather than dynamic query search. The query parameter is used for relevance filtering but not for API search. Content is collected from profile activity feeds and articles.

2. **Web Items Missing publishedAt**: Web items collected via Perplexity API do not include `publishedAt` timestamps. This is a limitation of the Perplexity API which does not return publication dates for search results.

3. **LinkedIn Activity Items Missing publishedAt**: LinkedIn activity items (posts/shares) from the ScrapeCreators API do not include timestamps. LinkedIn articles do include `datePublished`.

4. **Twitter Community Tweets**: The `/v1/twitter/community/tweets` endpoint is not currently implemented. Only `/v1/twitter/search` is available.

---

## Synthesis Model Selection

The synthesis stage (Stage 4) now supports multiple LLM providers, similar to the refinement phase. This allows users to choose their preferred model for LinkedIn post generation based on quality, cost, or API availability.

### Available Models

| Model | Option Value | Provider | Model ID | Use Case |
|-------|--------------|----------|----------|----------|
| GPT-5.2 | `gpt` (default) | OpenAI | gpt-5.2 | Most capable, best post quality |
| Gemini 3 Flash | `gemini` | Google | gemini-3-flash-preview | Cost-effective, fast (Flash used for cost optimization) |
| Claude Sonnet 4.5 | `claude` | Anthropic | claude-sonnet-4-5-20241022 | Strong reasoning, balanced |
| Kimi 2 | `kimi2` | OpenRouter | moonshotai/kimi-k2-thinking | Deep reasoning, extended context |

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--synthesis-model <model>` | Model: gpt\|gemini\|claude\|kimi2 | gpt |

### Example Usage

```bash
# Default: GPT-5.2 (highest quality)
npx tsx src/index.ts "AI trends in healthcare"

# Cost-effective: Gemini 3 Pro
npx tsx src/index.ts "AI trends" --synthesis-model gemini

# Alternative: Claude Sonnet 4.5
npx tsx src/index.ts "AI trends" --synthesis-model claude

# Deep reasoning: Kimi 2 via OpenRouter
npx tsx src/index.ts "AI trends" --synthesis-model kimi2
```

### API Key Requirements

| Model | Required Key |
|-------|-------------|
| gpt | OPENAI_API_KEY |
| gemini | GOOGLE_AI_API_KEY |
| claude | ANTHROPIC_API_KEY |
| kimi2 | OPENROUTER_API_KEY |

### Architecture

The synthesis module follows the same pattern as refinement:

```
src/synthesis/
├── index.ts          # Orchestrator with selectSynthesizer()
├── gpt.ts            # GPT-5.2 implementation (existing)
├── gemini.ts         # Gemini 3 Pro implementation (new)
├── claude.ts         # Claude Sonnet 4.5 implementation (new)
├── kimi.ts           # Kimi 2 via OpenRouter implementation (new)
├── claims.ts         # Claim extraction (shared)
└── types.ts          # SynthesisModel type and config (new)
```

Each model-specific file implements the same `SynthesizerFn` interface:

```typescript
type SynthesizerFn = (
  claims: GroundedClaim[],
  prompt: string,
  config: PipelineConfig
) => Promise<SynthesisResult>;
```

### Cost Comparison

| Model | Est. Input Cost | Est. Output Cost | Notes |
|-------|-----------------|------------------|-------|
| GPT-5.2 | $1.75/1M tokens | $14.00/1M tokens | Highest quality |
| Gemini 3 Flash | $0.50/1M tokens | $3.00/1M tokens | Most cost-effective (Flash for cost optimization) |
| Claude Sonnet 4.5 | $3.00/1M tokens | $15.00/1M tokens | Strong reasoning |
| Kimi 2 | $0.456/1M tokens | $1.84/1M tokens | Via OpenRouter |

### Failure Handling

| Failure | Behavior |
|---------|----------|
| API error | Retry 3x with backoff, then **FATAL** |
| Parse error | Retry once with fix-JSON prompt, then **FATAL** |
| Timeout | **FATAL** (synthesis is required) |

Note: Unlike other stages, synthesis has no fallback - if the selected model fails, the pipeline cannot complete.

---

## Future Phases

- **Phase 1**: Web UI with React/Next.js, user accounts
- **Phase 2**: Scheduled generation (cron/webhooks), templates
- **Phase 3**: Multi-platform output (Twitter threads, blog posts)
- **Phase 4**: SVG/HTML infographics for guaranteed text accuracy
- **Phase 5**: Collaborative editing, team workspaces

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
    "openai": "^4.70.0",
    "zod": "^3.23.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/uuid": "^9.0.0",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.0.0"
  }
}
```

---

## Environment Variables

```env
# Required
PERPLEXITY_API_KEY=your_key_here
GOOGLE_AI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here

# Optional (only if using social sources)
SCRAPECREATORS_API_KEY=your_key_here
```

---

## Changelog

### v2.3.0 (2025-12-31)
- Added Synthesis Model Selection section (Section 15)
- New CLI option: `--synthesis-model <model>`
- Support for 4 synthesis models: GPT-5.2 (default), Gemini 3 Pro, Claude Sonnet 4.5, Kimi 2
- Architecture follows established refinement model pattern
- Updated cost estimation for synthesis model selection

### v2.2.0 (2025-12-30)
- Added Prompt Refinement Phase section (Section 14)
- New CLI options: `--skip-refinement` and `--refinement-model <model>`
- Support for 4 refinement models: Gemini 3.0 Flash (default), GPT-5.2, Claude Sonnet 4.5, Kimi 2
- Interactive prompt clarification with hybrid LLM analysis
- Always-on by default with user confirmation before proceeding

### v2.1.0 (2025-12-30)
- Added Multi-Post Generation section (Section 13)
- New CLI options: `--post-count` (1-3) and `--post-style` (series|variations)
- Support for generating multiple post variations for A/B testing
- Support for connected multi-part series posts
- Updated output structure for multi-post runs
- Added cost implications for multi-post generation

### v2.0.0 (2025-12-26)
- Added Compliance & Legal section with ToS considerations
- Defined verification levels (UNVERIFIED, SOURCE_CONFIRMED, etc.)
- Added ValidatedItem schema (was missing in v1)
- Enhanced engagement schema for X metrics
- Added provenance fields (sourceUrl, retrievedAt, rawResponseRef)
- Added deduplication strategy (hash + Jaccard similarity)
- Defined failure modes and graceful degradation
- Added performance/cost controls and budgets
- Added security/privacy section
- Expanded CLI with new flags (--sources, --fast, --save-raw, etc.)
- Added sources.json and sources.md outputs
- Added fact-check summary in synthesis output
- Added testing strategy with unit/mock/golden tests
- Added Definition of Done criteria
- Added Open Questions section
