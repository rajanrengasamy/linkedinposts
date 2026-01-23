# LinkedIn Post Generator

A **provenance-first** CLI tool that transforms topic prompts into LinkedIn-ready posts with full source attribution and optional infographic generation.

> **Status:** Phase 0 proof-of-concept. Demonstrates the architectural approach for multi-model content pipelines. Functional but would benefit from refactoring before production use.

## The Problem

AI-generated content often suffers from hallucinations and lacks verifiable sources. This tool addresses that by enforcing a core principle:

> No quote or claim should appear in the final output unless it has a verified source URL.

## Features

- **Multi-Source Collection** — Web research (Perplexity), Google Trends, LinkedIn posts, X/Twitter
- **Claim Verification** — Cross-checks quotes against live sources with 4-level confidence
- **Intelligent Scoring** — Multi-dimensional ranking: relevance, authenticity, recency, engagement
- **Multi-Model Synthesis** — Choose from GPT-5.2, Gemini, Claude, or KIMI
- **Infographic Generation** — Optional AI-generated visuals
- **Cost Tracking** — Per-stage breakdown with `--print-cost-estimate` preview
- **Quality Profiles** — Fast, default, and thorough modes

## Quick Start

```bash
# Install
npm install
cp .env.example .env
# Add API keys: PERPLEXITY_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY

# Run
npm run dev -- "AI trends in healthcare 2025"

# Output in: output/session_{timestamp}/linkedin_post.md
```

## Architecture

```
User Prompt
    ↓
[Stage 0] Prompt Refinement (optional, interactive)
    ↓
[Stage 1] Data Collection (parallel: web, social, trends)
    ↓
[Stage 2] Normalization & Deduplication
    ↓
[Stage 3] Validation (cross-check claims against sources)
    ↓
[Stage 4] Scoring & Ranking
    ↓
[Stage 5] Synthesis (generate LinkedIn post)
    ↓
[Stage 6] Image Generation (optional)
    ↓
Output: linkedin_post.md + sources.json + infographic.png
```

**Design Principles:**
- Pipeline/ETL-style workflow with Zod schema validation
- Fail-open for optional stages (social, refinement, image)
- Fail-closed for required stages (web collection)
- Strong provenance tracking throughout

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript 5.9 (strict mode) |
| CLI | Commander |
| Validation | Zod |
| Web Research | Perplexity Sonar Reasoning Pro |
| Scoring | Gemini 3 Flash |
| Synthesis | OpenAI GPT-5.2 (default) |
| Image Gen | Google Nano Banana Pro |

## Usage Examples

```bash
# Basic
npm run dev -- "AI trends in healthcare 2025"

# With quality profile
npm run dev -- "Leadership lessons from tech CEOs" --quality thorough

# Multiple sources (requires pytrends: pip install pytrends)
npm run dev -- "AI agents" --sources web,googletrends

# Skip image generation
npm run dev -- "Startup trends" --skip-image

# Generate multiple variations
npm run dev -- "Topic" --post-count 3 --post-style series

# Preview cost
npm run dev -- "Topic" --print-cost-estimate --dry-run

# Different synthesis model
npm run dev -- "Topic" --synthesis-model claude
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--sources` | Comma-separated: web, googletrends, linkedin, x |
| `--quality` | fast \| default \| thorough |
| `--skip-validation` | Skip claim verification |
| `--skip-scoring` | Use heuristic scoring |
| `--skip-image` | Skip infographic generation |
| `--synthesis-model` | gpt \| gemini \| claude \| kimi2 |
| `--post-count` | Generate 1-3 variations |
| `--print-cost-estimate` | Preview API costs |
| `--verbose` | Detailed logging |

## Output

Each run creates a timestamped folder:

```
output/session_20260113T143512/
├── linkedin_post.md      # Ready-to-post content
├── sources.json          # Machine-readable provenance
├── sources.md            # Human-readable source list
├── synthesis.json        # Full synthesis metadata
├── validated_data.json   # Verification results
├── scored_data.json      # Ranking scores
├── infographic.png       # Generated image (if enabled)
└── pipeline_status.json  # Timing, costs, errors
```

## Verification Levels

Content is tagged with verification confidence:

| Level | Description |
|-------|-------------|
| `UNVERIFIED` | No source confirmation |
| `SOURCE_CONFIRMED` | Single source verified |
| `MULTISOURCE_CONFIRMED` | Multiple sources agree |
| `PRIMARY_SOURCE` | Original publication found |

## Project Structure

```
src/
├── cli/           # CLI interface & pipeline orchestration
├── collectors/    # Data collection (web, social, trends)
├── processing/    # Normalization & deduplication
├── validation/    # Claim verification
├── scoring/       # Content ranking
├── synthesis/     # Post generation
├── refinement/    # Prompt clarification
├── image/         # Infographic generation
├── schemas/       # Zod validation schemas
└── utils/         # Logging, retry, concurrency

python/
├── trends_collector.py  # PyTrends subprocess
└── requirements.txt

docs/
├── PRD-v2.md           # Product requirements
└── TODO-v2.md          # Implementation checklist
```

## API Keys Required

| Key | Purpose | Required |
|-----|---------|----------|
| `PERPLEXITY_API_KEY` | Web collection & validation | Yes |
| `GOOGLE_AI_API_KEY` | Scoring & image generation | Yes |
| `OPENAI_API_KEY` | Synthesis | Yes |
| `SCRAPECREATORS_API_KEY` | LinkedIn/X scraping | Optional |
| `OPENROUTER_API_KEY` | Alternative models | Optional |
| `ANTHROPIC_API_KEY` | Claude synthesis | Optional |

## Compliance Notes

- Default mode is **web-only** using Perplexity's official API
- LinkedIn/X sources use unofficial scraping APIs (may violate ToS)
- Social sources require explicit `--sources linkedin,x` flag
- Your prompts are sent to third-party APIs (Perplexity/Google/OpenAI)

## Roadmap

- **Phase 0 (Current):** CLI pipeline with 6 stages
- **Phase 1:** Web UI with authentication
- **Phase 2:** Background job queues
- **Phase 3:** Scheduled runs, templates
- **Phase 4:** Multi-platform outputs

## License

Private project.
