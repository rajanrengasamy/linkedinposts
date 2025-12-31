# LinkedIn Quotes / LinkedIn Post Generator — Architecture & Workflow

## 1) What this codebase is trying to do

This repo implements a **local TypeScript CLI** that turns a single topic prompt into:

- a **LinkedIn-ready post** (one post, or 2–3 variations / a short series)
- a **provenance trail** (`sources.json` + `sources.md`) showing which sources were used
- optionally, a **generated infographic image** (PNG)

The guiding product principle is **provenance-first**:

- The pipeline is designed so that the synthesis step uses **only “grounded claims”** extracted from items that have at least **one verified source URL**.
- “No quote or claim should appear in the final output unless it has a verified source URL.”

You can see the high-level intent and pipeline description in `README.md:1` and the runtime orchestrator in `src/cli/runPipeline.ts:1`.

---

## 2) Architecture style (what pattern it follows)

This is primarily a **pipeline / ETL-style workflow** (collect → clean → verify → score → generate) executed by a single-process **orchestrator**.

Key characteristics:

- **Orchestrated pipeline**: `src/cli/runPipeline.ts:1` calls each stage in order and wires outputs → inputs.
- **Stage isolation via data contracts**: every stage produces a typed object validated with **Zod schemas** in `src/schemas/*`.
- **Adapter modules for external providers**: each provider (Perplexity, Gemini, OpenAI, OpenRouter, ScrapeCreators) is wrapped behind a small module boundary.
- **Best-effort / fail-open vs fail-closed decisions per stage**:
  - web collection is **required** (fail-closed)
  - social collection is **optional** (fail-open)
  - prompt refinement is **optional** (fail-open)
  - image generation is **optional** (fail-open)

In other words: it’s not a web service, not a queue-based worker system—this is a **deterministic CLI pipeline** with strong schema validation.

---

## 3) “C4-ish” view of the system

### 3.1 System context

```text
User
  |
  |  runs CLI with a topic prompt
  v
LinkedIn Post Generator CLI
  |
  |  calls external model/data APIs
  +--> Perplexity (web collection + validation)
  +--> Gemini (prompt breakdown + scoring + image generation)
  +--> OpenAI GPT (final post synthesis)
  +--> OpenRouter (optional scoring + optional refinement)
  +--> ScrapeCreators (optional LinkedIn/X collection)
  |
  v
Local filesystem output/ (timestamped run folders)
```

### 3.2 Container / module layout (repo structure)

- **CLI / App shell**: `src/index.ts`, `src/cli/*`
- **Config & environment**: `src/config.ts`
- **Pipeline stages**:
  - Refinement: `src/refinement/*`
  - Collection: `src/collectors/*`
  - Processing: `src/processing/*`
  - Validation: `src/validation/perplexity.ts`
  - Scoring: `src/scoring/*`
  - Synthesis: `src/synthesis/*`
  - Image: `src/image/*`
- **Cross-cutting utilities**: `src/utils/*`
- **Data contracts (Zod schemas)**: `src/schemas/*`
- **Types and shared constants**: `src/types/*` and `src/types/index.ts`

---

## 4) Runtime workflow (stage-by-stage)

The pipeline entrypoint is `src/index.ts:1` which:

1. parses CLI args (`src/cli/program.ts:1`)
2. builds config (`src/config.ts:1`)
3. runs preflight (`src/cli/preflight.ts:1`) — validates API keys and supports `--dry-run` / `--print-cost-estimate`
4. creates an output directory early (`src/utils/fileWriter.ts:72`)
5. runs the pipeline with global timeout + centralized error handling (`src/cli/errorHandler.ts:1`)

The stage orchestrator is `src/cli/runPipeline.ts:1`.

### Stage 0 — Prompt refinement (optional, interactive)
**Primary files:** `src/refinement/index.ts:1`, `src/refinement/prompts.ts:1`

Goal: turn vague prompts into a concrete, researchable prompt.

How it works:

- Uses a selected model (`--refinement-model`) to analyze prompt clarity.
- If ambiguous, it asks 2–4 clarifying questions and collects answers via stdin.
- Produces a refined prompt the user can accept, reject, or provide feedback on.

Important architectural note:

- This stage is **interactive** (stdin-driven), which makes the CLI feel like a guided workflow.
- Failure is **non-fatal**: if the refinement model fails, the pipeline continues with the original prompt.

### Stage 1 — Collection (multi-source, with dedup)
**Primary files:** `src/collectors/index.ts:1`, `src/collectors/web.ts:1`

Goal: gather candidate source items for the topic.

Collection model:

- `collectAll()` determines enabled sources from `PipelineConfig.sources`.
- Runs collectors in parallel with `Promise.allSettled`.
- **Web** is required; if it fails the pipeline fails.
- LinkedIn/X are optional; failures become warnings.

Web collection (required):

- Uses Perplexity (`sonar-reasoning-pro` via `PERPLEXITY_API_URL/PERPLEXITY_MODEL`) to perform web search.
- Parses response text into blocks and attaches citations.
- Filters “meta/instructional” content to prevent reasoning artifacts contaminating downstream claims.
  - See meta content filter in `src/collectors/web.ts:35`.

Social collection (optional):

- Uses ScrapeCreators to fetch posts from a curated list of profiles/handles.
- Uses prompt breakdown when the prompt is long:
  - `src/prompts/breakdown.ts:1` uses Gemini to create 3–5 short “social search” queries.
  - The collector then runs per query (sequentially per social source to reduce rate limit pressure).
- Profile/handle lists come from markdown files loaded via `src/utils/handleLoader.ts:1`.

Deduplication:

- After collecting all items, `collectAll()` deduplicates results using:
  - hash-based exact match
  - Jaccard similarity (near-duplicate)
  - see `src/processing/dedup.ts:1` and normalization in `src/processing/normalize.ts:1`.

Output contract:

- Output items are `RawItem` objects validated by `src/schemas/rawItem.ts:1`.

### Stage 2 — Validation (verify quotes/claims)
**Primary file:** `src/validation/perplexity.ts:1`

Goal: attach a verification status and corroborating sources to each collected item.

Core behaviors:

- Uses Perplexity again, but this time as a **verification engine**.
- Each item gets a `validation` object with:
  - `level`: UNVERIFIED | SOURCE_CONFIRMED | MULTISOURCE_CONFIRMED | PRIMARY_SOURCE
  - `sourcesFound`: URLs
  - `quotesVerified`: per-quote status
  - see schema in `src/schemas/validatedItem.ts:1`.

Operational mechanics:

- Processes items in batches (configurable) and with a concurrency limit.
- Uses retries with backoff (`src/utils/retry.ts:1`).
- Implements a **circuit breaker**: if Perplexity timeouts occur, remaining items are marked UNVERIFIED instead of repeatedly timing out.
  - see `validateItems()` in `src/validation/perplexity.ts:881`.

Skip behavior:

- `--skip-validation` marks every item as UNVERIFIED but keeps them in the pipeline.

### Stage 3 — Scoring (rank items for usefulness)
**Primary files:** `src/scoring/index.ts:1`, `src/scoring/gemini.ts:1`, `src/scoring/openrouter.ts:1`

Goal: score each validated item across dimensions and rank them.

Scoring models:

- Default: Gemini 3 Flash (`src/scoring/gemini.ts:1`)
- Optional: OpenRouter KIMI 2 (`src/scoring/openrouter.ts:1`)

The scoring output (`ScoredItem`) includes:

- `scores`: relevance/authenticity/recency/engagementPotential/overall
- `scoreReasoning`: short bullet justification
- `rank`: 1..N

See schema in `src/schemas/scoredItem.ts:1`.

Fallback behavior:

- If scoring is skipped (`--skip-scoring`) or fails, the pipeline can fall back to heuristic scoring:
  - `src/scoring/fallback.ts:1`

### Stage 4 — Synthesis (generate LinkedIn post)
**Primary files:** `src/synthesis/index.ts:1`, `src/synthesis/claims.ts:1`, `src/synthesis/gpt.ts:1`

Goal: turn the best verified material into a publishable post.

Key architectural idea: **Grounded claims extraction**

- The synthesis stage does not feed full raw items to GPT.
- Instead, it extracts a compact list of “grounded claims” (quotes, stats, insights) from top-ranked items.
- It enforces a provenance threshold: only items with verification >= SOURCE_CONFIRMED are eligible.
  - see `src/synthesis/claims.ts:1`.

GPT request shape:

- Uses OpenAI Responses API with `instructions: SYSTEM_PROMPT` (true system message) and `text.format: json_object`.
  - see `makeGPTRequest()` in `src/synthesis/gpt.ts:300`.

Output contract:

- GPT is required to return JSON that matches the synthesis schemas in `src/schemas/synthesisResult.ts:1`.
- The orchestrator then writes:
  - `synthesis.json`
  - `linkedin_post.md` (or multiple files for multi-post mode)

Multi-post mode:

- Controlled by `--post-count` (1–3) and `--post-style` (variations/series).
- The synthesis result can include `posts[]` as well as the legacy `linkedinPost` field.

### Stage 5 — Image generation (optional)
**Primary files:** `src/image/index.ts:1`, `src/image/nanoBanana.ts:1`

Goal: generate an infographic PNG based on the structured `infographicBrief` from synthesis.

- Uses Gemini Image generation via `@google/genai`.
- Best-effort: failures return null and do not fail the pipeline.
- Supports generating one image per post in multi-post mode.

### Finalization — Provenance & status
After synthesis (and optionally image generation), the pipeline writes:

- `sources.json` + `sources.md` (provenance)
  - built using `SourceReference` in `src/schemas/sourceReference.ts:1`
- `pipeline_status.json` (timings/config/success/failure)
  - written via `src/utils/fileWriter.ts:301`

---

## 5) Data contracts (the “spine” of the pipeline)

The pipeline is intentionally schema-driven.

### 5.1 Core types

- `RawItem` (`src/schemas/rawItem.ts:1`): collected content + provenance + engagement
- `ValidatedItem` (`src/schemas/validatedItem.ts:1`): RawItem + `validation`
- `ScoredItem` (`src/schemas/scoredItem.ts:1`): ValidatedItem + scores + rank
- `SynthesisResult` (`src/schemas/synthesisResult.ts:1`): final post, key quotes, infographic brief, metadata
- `SourceReference` (`src/schemas/sourceReference.ts:1`): provenance list for outputs

### 5.2 Why this matters

This architecture makes an LLM-heavy workflow maintainable:

- each stage has a strict input/output contract
- failures can be isolated to a stage
- outputs are serializable and testable
- you can resume from artifacts (`--from-scored` in `src/cli/runPipeline.ts:94`)

---

## 6) Reliability, safety, and security mechanisms

### 6.1 Timeouts, retries, and concurrency

- Global pipeline timeout enforced at the CLI level (`src/index.ts:74`).
- Each external API call uses retry/backoff utilities (`src/utils/retry.ts:1`).
- Validation uses concurrency limiting (`src/utils/concurrency.ts:1`) and a circuit breaker (`src/validation/perplexity.ts:881`).

### 6.2 Prompt-injection and “LLM meta-content” defense

Multiple layers attempt to prevent model/tooling text from contaminating outputs:

- content sanitization functions in validation (`src/validation/perplexity.ts:52`).
- structured delimiters in refinement (`src/refinement/prompts.ts:24`) and synthesis prompt building (`src/synthesis/gpt.ts:505`).
- meta-content filtering in the web collector (`src/collectors/web.ts:35`) to avoid reasoning artifacts entering the pipeline as “facts”.

### 6.3 Output safety

- Output path traversal protection (`src/utils/fileWriter.ts:31`).
- Centralized error handling writes a `pipeline_status.json` even on failure if the output dir exists (`src/cli/errorHandler.ts:118`).

---

## 7) Extensibility: how you’d evolve this architecture

This repo is already structured in a way that supports extension by adding a new stage implementation or adapter.

Common extension points:

- Add a new collector:
  - implement `CollectorFn` like `searchWeb()` / `searchLinkedIn()`
  - integrate into `src/collectors/index.ts:52`.
- Add a new scoring provider:
  - add a new scorer module and route in `src/scoring/index.ts:30`.
- Add a new synthesis model:
  - keep the “grounded claim” contract; swap out the model client in `src/synthesis/gpt.ts`.
- Add a web UI later:
  - keep `runPipeline(prompt, config)` as the core job function and wrap it with an HTTP API + queue.

---

## 8) What to optimize next (practical guidance)

If your goal is to “optimize prompts later”, the leverage points are:

- Collection prompt in `src/collectors/web.ts` (what gets pulled in).
- Validation prompt in `src/validation/perplexity.ts` (what gets considered verified).
- Scoring prompt in `src/scoring/gemini.ts` (what rises to the top).
- Synthesis prompt + system prompt in `src/synthesis/gpt.ts` (final voice + structure + constraints).

These are the knobs that most strongly shape output quality.
