# LinkedIn Post Generator - How To Guide

> **Maintainer Note**: Keep this document updated whenever new CLI options or features are added.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Basic Usage](#basic-usage)
3. [Prompt Refinement](#prompt-refinement)
4. [Source Options](#source-options)
5. [Quality Profiles](#quality-profiles)
6. [Scoring Models](#scoring-models)
7. [Synthesis Models](#synthesis-models)
8. [Stage Control](#stage-control)
9. [Multi-Post Generation](#multi-post-generation)
10. [Resume from Scored Data](#resume-from-scored-data)
11. [Output Options](#output-options)
12. [Performance Options](#performance-options)
13. [Debug Options](#debug-options)
14. [Common Workflows](#common-workflows)
15. [All CLI Options Reference](#all-cli-options-reference)

---

## Quick Start

```bash
# Minimal run (web sources only, default settings)
npx tsx src/index.ts "Your topic here"

# Example with a real topic
npx tsx src/index.ts "AI agents in 2025"
```

---

## Basic Usage

```bash
npx tsx src/index.ts "<prompt>" [options]
```

The `<prompt>` is your topic or question. The tool will:
1. **Refine your prompt** (analyze and optimize for better results)
2. Collect relevant content from sources
3. Validate quotes and claims
4. Score content for relevance
5. Synthesize a LinkedIn post
6. Generate an infographic (optional)

---

## Prompt Refinement

The pipeline includes an intelligent prompt refinement phase (Stage 0) that runs before data collection. An LLM analyzes your prompt for clarity and specificity, then either suggests an optimized version or asks clarifying questions.

### How It Works

1. **Clear prompts**: LLM suggests an optimized version → you approve or provide feedback
2. **Ambiguous prompts**: LLM asks 2-4 clarifying questions → you answer → refined prompt generated

Refinement is **ON by default** for better results.

### Skip Refinement
```bash
# Skip refinement for faster runs
npx tsx src/index.ts "AI trends" --skip-refinement
```

### Refinement Models

| Model | Option | Provider | Use Case |
|-------|--------|----------|----------|
| Gemini 3.0 Flash | `gemini` (default) | Google | Fast, cost-effective |
| GPT-5.2 | `gpt` | OpenAI | Most capable reasoning |
| Claude Sonnet 4.5 | `claude` | Anthropic | Balanced reasoning |
| Kimi 2 | `kimi2` | OpenRouter | Deep reasoning |

### Choose Refinement Model
```bash
# Use GPT-5.2 for refinement
npx tsx src/index.ts "AI trends" --refinement-model gpt

# Use Claude Sonnet 4.5
npx tsx src/index.ts "AI trends" --refinement-model claude

# Use Kimi 2 (requires OPENROUTER_API_KEY)
npx tsx src/index.ts "AI trends" --refinement-model kimi2
```

### Example: Ambiguous Prompt

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

Accept this refined prompt? [Y/n/feedback]: Y
```

### Example: Clear Prompt

```bash
$ npx tsx src/index.ts "AI agents for enterprise automation in 2025"

Analyzing prompt...

Refined prompt:
"Enterprise AI agents and automation trends in 2025: focusing on productivity
gains, implementation patterns, and real-world adoption across Fortune 500
companies with expert analysis and data-driven insights"

Accept this refined prompt? [Y/n/feedback]: Y
```

### User Response Options

When prompted "Accept this refined prompt?":
- **Y** (or Enter): Accept the refined prompt
- **n**: Reject and use original prompt
- **feedback**: Type your feedback to adjust the refinement

### API Key Requirements

| Model | Required Key |
|-------|-------------|
| gemini | GOOGLE_AI_API_KEY |
| gpt | OPENAI_API_KEY |
| claude | ANTHROPIC_API_KEY |
| kimi2 | OPENROUTER_API_KEY |

---

## Source Options

### Web Only (Default - Safest)
```bash
npx tsx src/index.ts "AI trends" --sources web
```

### Web + LinkedIn
```bash
npx tsx src/index.ts "AI trends" --sources web,linkedin
```

### Web + X/Twitter
```bash
npx tsx src/index.ts "AI trends" --sources web,x
```

### All Sources
```bash
npx tsx src/index.ts "AI trends" --sources web,linkedin,x
```

> **Warning**: LinkedIn and X sources use unofficial APIs and may violate platform ToS. Use at your own risk.

---

## Quality Profiles

### Fast Mode (Quickest, ~30s)
Skips validation, scoring, and image generation.
```bash
npx tsx src/index.ts "AI trends" --fast
# or
npx tsx src/index.ts "AI trends" --quality fast
```

### Default Mode (~2 min)
Balanced quality and speed.
```bash
npx tsx src/index.ts "AI trends"
# or
npx tsx src/index.ts "AI trends" --quality default
```

### Thorough Mode (~3+ min)
Maximum items, full processing, 4K image.
```bash
npx tsx src/index.ts "AI trends" --quality thorough
```

| Profile | Max Items | Validation | Scoring | Image |
|---------|-----------|------------|---------|-------|
| fast | 30 | Skipped | Skipped | Skipped |
| default | 75 | Enabled | Enabled | 2K |
| thorough | 150 | Enabled | Enabled | 4K |

---

## Scoring Models

### Gemini (Default)
```bash
npx tsx src/index.ts "AI trends" --scoring-model gemini
```

### KIMI 2 (via OpenRouter)
Requires `OPENROUTER_API_KEY` in .env file.
```bash
npx tsx src/index.ts "AI trends" --scoring-model kimi2
```

---

## Synthesis Models

Choose which LLM generates your LinkedIn post. Default is GPT-5.2.

### GPT-5.2 (Default)
Highest quality synthesis with advanced reasoning.
```bash
npx tsx src/index.ts "AI trends" --synthesis-model gpt
```

### Gemini 3 Flash
Fast, cost-effective synthesis.
```bash
npx tsx src/index.ts "AI trends" --synthesis-model gemini
```

### Claude Sonnet 4.5
Balanced quality and cost.
```bash
npx tsx src/index.ts "AI trends" --synthesis-model claude
```

### Kimi K2 (via OpenRouter)
Deep reasoning synthesis. Requires `OPENROUTER_API_KEY`.
```bash
npx tsx src/index.ts "AI trends" --synthesis-model kimi2
```

### Model Comparison

| Model | Option | Provider | Speed | Cost | Use Case |
|-------|--------|----------|-------|------|----------|
| GPT-5.2 | `gpt` (default) | OpenAI | Medium | $$$ | Best quality |
| Gemini 3 Flash | `gemini` | Google | Fast | $ | Quick drafts |
| Claude Sonnet 4.5 | `claude` | Anthropic | Medium | $$ | Balanced |
| Kimi K2 | `kimi2` | OpenRouter | Slow | $ | Deep reasoning |

### API Key Requirements

| Model | Required Key |
|-------|-------------|
| gpt | OPENAI_API_KEY |
| gemini | GOOGLE_AI_API_KEY |
| claude | ANTHROPIC_API_KEY |
| kimi2 | OPENROUTER_API_KEY |

---

## Stage Control

### Skip Validation
```bash
npx tsx src/index.ts "AI trends" --skip-validation
```

### Skip Scoring (Use Heuristics)
```bash
npx tsx src/index.ts "AI trends" --skip-scoring
```

### Skip Image Generation
```bash
npx tsx src/index.ts "AI trends" --skip-image
```

### Skip Multiple Stages
```bash
npx tsx src/index.ts "AI trends" --skip-validation --skip-image
```

---

## Multi-Post Generation

Generate multiple LinkedIn posts from a single pipeline run for A/B testing or content series.

### Post Count
Generate 1-3 posts per run.
```bash
# Generate 2 posts
npx tsx src/index.ts "AI trends" --post-count 2

# Generate 3 posts
npx tsx src/index.ts "AI trends" --post-count 3
```

### Post Styles

#### Variations Mode (Default)
Generate multiple versions with different hooks, CTAs, and tones for A/B testing.
```bash
npx tsx src/index.ts "AI trends" --post-count 2 --post-style variations
```

#### Series Mode
Generate connected multi-part posts for a content series (Part 1, Part 2, etc.).
```bash
npx tsx src/index.ts "AI trends" --post-count 3 --post-style series
```

### Multi-Post Output Files

When `--post-count` > 1, output files are numbered:

| File | Description |
|------|-------------|
| `linkedin_post_1.md` | First LinkedIn post |
| `linkedin_post_2.md` | Second LinkedIn post |
| `linkedin_post_3.md` | Third LinkedIn post (if --post-count 3) |
| `infographic_1.png` | Infographic for post 1 |
| `infographic_2.png` | Infographic for post 2 |
| `infographic_3.png` | Infographic for post 3 (if --post-count 3) |

> **Note**: Single-post mode (`--post-count 1`) uses original file names (`linkedin_post.md`, `infographic.png`) for backward compatibility.

---

## Resume from Scored Data

If a pipeline run fails after scoring (e.g., during synthesis due to timeout), you can resume from the existing `scored_data.json` file. This skips collection, validation, and scoring stages.

### Basic Resume
```bash
npx tsx src/index.ts "AI trends" --from-scored output/session_20251230T234746/scored_data.json
```

### Resume with Multi-Post
```bash
npx tsx src/index.ts "AI trends" --from-scored output/session_20251230T234746/scored_data.json --post-count 3 --post-style series
```

### What Gets Skipped
When using `--from-scored`:
- ❌ Prompt refinement (skipped)
- ❌ Content collection (skipped)
- ❌ Validation (skipped)
- ❌ Scoring (skipped)
- ✅ Synthesis (runs)
- ✅ Image generation (runs, unless --skip-image)

### When to Use
- Pipeline failed during synthesis (timeout, API error)
- You want to regenerate posts with different settings
- Testing synthesis with existing scored data

> **Tip**: The output directory from failed runs contains `scored_data.json` that you can use to resume.

---

## Output Options

### Custom Output Directory
```bash
npx tsx src/index.ts "AI trends" --output-dir ./my-output
```

### Save Raw API Responses
```bash
npx tsx src/index.ts "AI trends" --save-raw
```

### High Resolution Image (4K)
```bash
npx tsx src/index.ts "AI trends" --image-resolution 4k
```

---

## Performance Options

### Limit Items Per Source
```bash
npx tsx src/index.ts "AI trends" --max-per-source 10
```

### Limit Total Items
```bash
npx tsx src/index.ts "AI trends" --max-total 50
# or
npx tsx src/index.ts "AI trends" --max-results 50
```

### Custom Timeout
```bash
npx tsx src/index.ts "AI trends" --timeout 300
```

### Print Cost Estimate (No Execution)
```bash
npx tsx src/index.ts "AI trends" --print-cost-estimate
```

---

## Debug Options

### Verbose Output
```bash
npx tsx src/index.ts "AI trends" --verbose
```

### Dry Run (Validate Config Only)
```bash
npx tsx src/index.ts "AI trends" --dry-run
```

### Full Debug Mode
```bash
npx tsx src/index.ts "AI trends" --verbose --save-raw
```

---

## Common Workflows

### 1. Quick Draft (Fastest)
Get a quick post without verification.
```bash
npx tsx src/index.ts "AI trends" --fast --verbose
```

### 2. Production Quality (Recommended)
Full pipeline with web sources.
```bash
npx tsx src/index.ts "AI trends" --sources web --verbose
```

### 3. Cost-Conscious Run
Skip expensive image generation.
```bash
npx tsx src/index.ts "AI trends" --skip-image --verbose
```

### 4. Maximum Quality
All sources, thorough processing, 4K image.
```bash
npx tsx src/index.ts "AI trends" --sources web,linkedin,x --quality thorough --image-resolution 4k --verbose
```

### 5. Testing with KIMI 2
Use alternative scoring model.
```bash
npx tsx src/index.ts "AI trends" --scoring-model kimi2 --skip-image --verbose
```

### 6. Debug API Issues
Save raw responses for debugging.
```bash
npx tsx src/index.ts "AI trends" --save-raw --verbose
```

### 7. Check Cost Before Running
```bash
npx tsx src/index.ts "AI trends" --quality thorough --print-cost-estimate
```

### 8. Social Media Focus
Emphasize social sources with long prompt breakdown.
```bash
npx tsx src/index.ts "What are the latest developments in AI agents and autonomous systems for enterprise applications in 2025" --sources web,x --verbose
```

### 9. A/B Testing Posts
Generate multiple post variations for testing.
```bash
npx tsx src/index.ts "AI trends" --post-count 2 --post-style variations --verbose
```

### 10. Multi-Part Series
Create a connected content series.
```bash
npx tsx src/index.ts "Building AI agents" --post-count 3 --post-style series --verbose
```

### 11. Skip Refinement (Quick Run)
Skip the interactive refinement phase for automation or quick runs.
```bash
npx tsx src/index.ts "AI trends in healthcare 2025" --skip-refinement --verbose
```

### 12. Claude for Refinement
Use Claude Sonnet 4.5 for prompt refinement.
```bash
npx tsx src/index.ts "AI trends" --refinement-model claude --verbose
```

### 13. Resume from Failed Run
If synthesis failed (e.g., timeout), resume from scored data.
```bash
npx tsx src/index.ts "AI trends" --from-scored output/session_20251230T234746/scored_data.json --post-count 3 --post-style series --verbose
```

---

## All CLI Options Reference

| Option | Default | Description |
|--------|---------|-------------|
| `--sources <list>` | `web` | Comma-separated: web,linkedin,x |
| `--skip-refinement` | false | Skip prompt refinement phase |
| `--refinement-model <model>` | `gemini` | Refinement: gemini, gpt, claude, kimi2 |
| `--skip-validation` | false | Skip verification stage |
| `--skip-scoring` | false | Skip Gemini/KIMI scoring |
| `--skip-image` | false | Skip infographic generation |
| `--fast` | false | Fast mode (skips validation, scoring, image) |
| `--quality <level>` | `default` | Quality: fast, default, thorough |
| `--max-per-source <n>` | `25` | Max items per source |
| `--max-total <n>` | `75` | Max total items |
| `--max-results <n>` | `75` | Alias for --max-total |
| `--output-dir <path>` | `./output` | Output directory |
| `--save-raw` | false | Save raw API responses |
| `--image-resolution <res>` | `2k` | Image resolution: 2k, 4k |
| `--scoring-model <model>` | `gemini` | Scoring: gemini, kimi2 |
| `--synthesis-model <model>` | `gpt` | Synthesis: gpt, gemini, claude, kimi2 |
| `--timeout <seconds>` | `600` | Pipeline timeout |
| `--print-cost-estimate` | false | Print cost and exit |
| `--verbose` | false | Show detailed progress |
| `--dry-run` | false | Validate config only |
| `--post-count <n>` | `1` | Number of posts to generate (1-3) |
| `--post-style <style>` | `variations` | Post style: series, variations |
| `--from-scored <path>` | - | Resume from scored_data.json (skips collection/validation/scoring) |

---

## Environment Variables

Required in `.env` file:

```env
# Always Required
PERPLEXITY_API_KEY=your_key
GOOGLE_AI_API_KEY=your_key
OPENAI_API_KEY=your_key

# Optional (for social sources)
SCRAPECREATORS_API_KEY=your_key

# Optional (for Claude refinement/synthesis models)
ANTHROPIC_API_KEY=your_key

# Optional (for KIMI 2 scoring/refinement/synthesis)
OPENROUTER_API_KEY=your_key
```

---

## Output Files

After a successful run, find outputs in `output/session_{timestamp}/`:

| File | Description |
|------|-------------|
| `linkedin_post.md` | Final LinkedIn post (copy-paste ready) |
| `synthesis.json` | Full synthesis with metadata |
| `sources.json` | Source provenance data |
| `sources.md` | Human-readable source list |
| `validated_data.json` | Validated items |
| `scored_data.json` | Scored items |
| `top_50.json` | Top 50 items |
| `infographic.png` | Generated image (if enabled) |
| `pipeline_status.json` | Run metadata |
| `raw_data.json` | Raw API responses (if --save-raw) |

---

## Troubleshooting

### "Missing required API keys"
Check your `.env` file has all required keys set.

### "FATAL: No claims provided"
This happens in `--fast` mode when validation is skipped. Use normal mode or `--quality default`.

### LinkedIn/X HTTP 400 Errors
The ScrapeCreators API may have rate limits or the handles may be invalid. Try web-only mode.

### Pipeline Timeout
Increase timeout: `--timeout 600`

---

## Version History

- **v2.4**: Added resume from scored data (`--from-scored`), increased synthesis timeout to 5 min
- **v2.3**: Added prompt refinement phase (`--skip-refinement`, `--refinement-model`)
- **v2.2**: Added multi-post generation (`--post-count`, `--post-style`)
- **v2.1**: Added KIMI 2 scoring, prompt breakdown for social sources
- **v2.0**: Initial release with full pipeline

---

*Last updated: 2025-12-31*
