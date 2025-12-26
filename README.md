# LinkedIn Post Generator (Phase 0 — CLI)

A Node.js/TypeScript CLI that turns a topic prompt into a LinkedIn-ready post by:

1) collecting “what’s trending” from sources (web by default)  
2) validating quotes/claims against real URLs  
3) scoring + selecting the best items  
4) synthesizing a polished post with full provenance (sources list)  
5) optionally generating an infographic

The core rule is **provenance-first**:

> No quote or claim should appear in the final output unless it has a verified source URL.

This repo currently contains the **spec + scaffold** for Phase 0. The canonical design is in `docs/PRD-v2.md`, and the build checklist is in `docs/TODO-v2.md`.

---

## Who this is for

- You want to “vibe code” a content generator, but you don’t want pure hallucinations.
- You want something you can run locally and copy/paste into LinkedIn (no auto-posting).
- You want a simple architecture you can understand and extend.

---

## Is this a “router-worker” architecture?

**Not in Phase 0.** This is best described as a **pipeline** (also like a small ETL workflow) with a single **orchestrator** that runs a sequence of stages:

- **Pipeline**: a step-by-step assembly line (collect → clean → verify → score → write).
- **Orchestrator**: the “conductor” that calls each stage and wires outputs to inputs.

### What “router-worker” usually means (for web apps)

In many web architectures:

- a **router** receives HTTP requests (e.g., `/generate`) and decides what code runs
- a **worker** runs long jobs in the background (queues, retries, job status, etc.)

Phase 0 is a CLI, so there’s no HTTP router. If you later build a web UI (Phase 1+), *then* a router-worker approach often makes sense:

```text
Browser/UI ──HTTP──> API Router (Next.js/Express)
                     │
                     ├─> quick responses (validate input, create job)
                     │
                     └─> Job Queue (Redis/SQS/etc.)
                              │
                              └─> Worker(s): run the same pipeline
                                         │
                                         └─> Persist job output + status
```

---

## Architecture (Phase 0 runtime)

The CLI runs a deterministic pipeline. Some stages run in parallel (collection), but the overall flow is sequential.

```text
┌──────────────────────────────────────────────────────────────┐
│                          CLI (src/index.ts)                  │
│ prompt + flags  →  build PipelineConfig  →  run pipeline      │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 1: COLLECT (parallel)                                  │
│  - Web (Perplexity)                 [required]               │
│  - LinkedIn (ScrapeCreators)         [optional, gated]       │
│  - X/Twitter (ScrapeCreators)        [optional, gated]       │
│ Output: RawItem[]  (capped by max-per-source / max-total)     │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ NORMALIZE + DEDUP                                             │
│  - content normalization                                      │
│  - deterministic hash dedup (sha256 → 16 chars)               │
│  - optional similarity dedup (Jaccard threshold, e.g. 0.85)   │
│ Output: RawItem[] (deduplicated)                              │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 2: VALIDATE (Perplexity reasoning)                      │
│  - cross-check quotes/claims against web sources              │
│  - verify attribution + publication date when possible        │
│  - assign verification level + confidence                     │
│ Output: ValidatedItem[] (UNVERIFIED allowed; pipeline continues)│
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 3: SCORE (Gemini)                                       │
│  - relevance / authenticity / recency / engagementPotential   │
│  - weighted overall score                                     │
│  - fallback heuristic if model fails                          │
│ Output: ScoredItem[] (ranked)                                 │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 4: SYNTHESIZE (OpenAI)                                  │
│  - pick top items                                              │
│  - write final LinkedIn post (<= 3000 chars, CTA, 3–5 hashtags)│
│  - include only quotes with source URLs                        │
│  - generate fact-check summary + infographic brief            │
│ Output: SynthesisResult                                        │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 5: IMAGE (optional)                                     │
│  - generate infographic.png (best-effort)                     │
│ Output: infographic.png or skipped                            │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ output/{timestamp}/                                           │
│  raw_data.json? → validated_data.json → scored_data.json      │
│  sources.json + sources.md + linkedin_post.md + synthesis.json │
│  infographic.png? + pipeline_status.json                      │
└──────────────────────────────────────────────────────────────┘
```

---

## What counts as “trending” (Phase 0 defaults)

From `docs/PRD-v2.md`, “trending” is a pragmatic filter, not a guarantee:

- Time window: last ~7 days
- Minimum engagement: ~10 interactions (likes + comments + shares)
- Language: English
- Region: global

The collector stage is expected to expand your prompt into a few sub-queries (e.g., expert opinions, latest news, statistics) and then pull back items that fit the window and thresholds.

---

## What “verified” means here (important)

This project does **not** claim “truth.” It produces **verification levels** based on what it can find on the web at runtime.

Verification levels (from `docs/PRD-v2.md`):

- `UNVERIFIED`: could not corroborate
- `SOURCE_CONFIRMED`: found in 1 web source
- `MULTISOURCE_CONFIRMED`: found in 2+ independent sources
- `PRIMARY_SOURCE`: confirmed from original/authoritative source

Content rules (Phase 0 target):

- **No quote in final post** unless it’s at least `SOURCE_CONFIRMED` *and* has a source URL.
- “Expert says …” style attributions should ideally be `MULTISOURCE_CONFIRMED`.
- Statistical claims should ideally be `PRIMARY_SOURCE`.

---

## Data model (the contracts between stages)

Each stage reads and writes strongly-typed JSON. The plan is to validate all model outputs with **Zod** schemas.

High-level objects (see `docs/PRD-v2.md` and `docs/TODO-v2.md`):

- `RawItem`: what we collected (content + provenance + engagement)
- `ValidatedItem`: `RawItem` + verification results
- `ScoredItem`: `ValidatedItem` + scoring + rank
- `SynthesisResult`: final post + key quotes + infographic brief + fact-check summary
- `SourceReference`: the provenance index for everything used

This “data contracts” approach is what keeps a multi-model pipeline sane: each stage has a clear input/output and can be tested/mocked.

---

## CLI (Phase 0 target interface)

The PRD defines the CLI UX; the implementation is tracked in `docs/TODO-v2.md`.

```bash
# Safe mode: web sources only (default)
npm run dev -- "AI trends in healthcare 2025"

# Explicit sources (social sources are optional + higher risk)
npm run dev -- "AI trends" --sources web,linkedin,x

# Fast draft: skip expensive stages
npm run dev -- "AI trends" --fast

# Highest quality profile (more items/time)
npm run dev -- "AI trends" --quality thorough

# Save raw API responses for debugging
npm run dev -- "AI trends" --save-raw --verbose

# Estimate cost before running
npm run dev -- "AI trends" --print-cost-estimate
```

Planned options (from `docs/PRD-v2.md`):

- `--sources web,linkedin,x` (default: `web`)
- `--skip-validation`, `--skip-scoring`, `--skip-image`
- `--fast` and `--quality fast|default|thorough`
- limits: `--max-per-source`, `--max-total` (aka `--max-results`)
- batching: `--validation-batch`, `--scoring-batch`
- output: `--output-dir`, `--save-raw`, `--image-resolution 2k|4k`
- performance: `--timeout`, `--print-cost-estimate`
- debug: `--verbose`, `--dry-run`
- `-h, --help` and `-V, --version`

---

## Outputs (what gets written to disk)

Each run writes a timestamped folder:

```text
output/{timestamp}/
├── raw_data.json            # only if --save-raw
├── validated_data.json
├── scored_data.json
├── top_50.json
├── synthesis.json
├── sources.json             # provenance index (machine-friendly)
├── sources.md               # provenance index (human-friendly)
├── linkedin_post.md         # final copy/paste post
├── infographic.png          # optional
└── pipeline_status.json     # timings, errors, run metadata
```

If a stage fails mid-run, the goal is to **still write partial outputs** and a clear `pipeline_status.json` so you can debug or resume.

---

## Compliance, safety, and “don’t get banned”

From `docs/PRD-v2.md`:

- Default mode is **web-only** (lower risk) using Perplexity’s API.
- LinkedIn/X sources use an **unofficial** scraping API and may violate platform ToS.
- Social sources should be **explicitly enabled** via flags (e.g., `--sources linkedin`).

Data handling:

- By default, only processed/scored outputs are persisted.
- Raw API responses should require an explicit `--save-raw`.
- The tool should avoid collecting/storing anything beyond what’s already public in source content.
- No credential storage (no “log into LinkedIn”).
- On shared machines, treat `output/` as your responsibility (a reasonable default is deleting runs after ~30 days).

Privacy note (practical reality for all AI pipelines):

- Your prompt and collected snippets are sent to the configured third-party APIs (Perplexity/Google/OpenAI/etc.) to do the work.
- Don’t put secrets or sensitive/private data in prompts unless you’re comfortable with those providers’ data policies.

---

## Cost + performance controls (why they matter)

Multi-model pipelines can get expensive and slow. Phase 0 includes these design controls:

- hard caps: max items per source, max total items
- batch sizes for validation/scoring (to control token usage)
- per-stage and overall timeouts
- `--fast` / `--quality` profiles
- `--print-cost-estimate` to see expected spend *before* running

---

## Project layout

The folder structure mirrors the pipeline stages:

```text
src/
├── index.ts                 # CLI entry point (orchestrator)
├── config.ts                # env/config + quality profiles
├── schemas/                 # Zod schemas for model outputs + provenance
├── types/                   # inferred TS types + pipeline config/result
├── collectors/              # web/linkedin/x collection + orchestrator
├── processing/              # normalization + dedup
├── validation/              # verification engine
├── scoring/                 # Gemini scoring + fallback heuristic
├── synthesis/               # claim extraction + post generation
├── image/                   # infographic generation (optional)
└── utils/                   # retry, logging, file writing, cost estimation
tests/
├── unit/
├── integration/             # mocked API tests
├── mocks/                   # fixture responses
└── golden/                  # “expected output” snapshots
docs/
├── PRD-v2.md
└── TODO-v2.md
```

---

## Getting started (local dev)

Prereqs:

- Node.js `>=18` (see `package.json`)

Setup:

```bash
npm install
cp .env.example .env
# fill in keys in .env
```

Run (Phase 0 target; see TODO for current implementation status):

```bash
npm run dev -- "your prompt here"
```

Typecheck / build (works even while the CLI is scaffolded):

```bash
npm run typecheck
npm run build
```

Tests:

- The `tests/` folder is scaffolded but does not yet include `*.test.ts` files, so `npm test` will currently exit with “No test files found”.

---

## Current status

- `docs/PRD-v2.md` defines the full Phase 0 behavior and constraints.
- `docs/TODO-v2.md` is the step-by-step implementation checklist.
- `src/` currently contains scaffolding placeholders for the planned modules (so `npm run dev` is a no-op until `src/index.ts` and the stages are implemented).

---

## Roadmap

- Phase 0: CLI pipeline (this repo)
- Phase 1+: Web UI + accounts (likely needs router + background workers)
- Future: scheduled runs, templates, multi-platform outputs, collaborative editing

---

## FAQ (for vibe coders)

**Why so many stages?**  
Because “generate a post” is actually multiple problems: find sources, remove duplicates, verify claims, pick the best items, then write nicely.

**Why not just prompt an LLM once?**  
One-shot prompting is fast, but it’s hard to enforce “no quote without source.” A pipeline + provenance makes it auditable.

**What if validation fails?**  
The design is “graceful degradation”: mark items `UNVERIFIED`, reduce reliance on authenticity, and still produce usable output (or fail clearly if synthesis can’t run).

---

## References

- Spec: `docs/PRD-v2.md`
- Implementation checklist: `docs/TODO-v2.md`
- Prior spec + feedback: `docs/PRD.md`, `docs/prd-feedbackv1.md`
