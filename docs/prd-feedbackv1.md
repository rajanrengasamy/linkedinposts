# PRD/TODO Critical Review (v1)

Reviewed: `docs/PRD.md`, `docs/TODO.md`  
Role: Senior engineer + architect (frontend/backend/AI workflows)

## Executive Summary

The PRD/TODO outline a solid “pipeline” concept (collect → verify → score → synthesize → render) and a pragmatic CLI-first delivery. The biggest issues are (1) unclear product definition (“quote generator” vs “LinkedIn post generator”), (2) high compliance/ToS and privacy risk due to scraping + storing user-generated content, (3) an over-complex multi-model workflow for Phase 0 without cost/latency budgets, and (4) missing/ambiguous specs for “verification”, deduplication, attribution, and output traceability.

If you tighten scope, define “truth/verification” clearly, add guardrails (schema validation, provenance, retention), and add a minimal evaluation plan, the implementation becomes much safer and more predictable.

## Highest-Priority Risks (Blockers / Near-Blockers)

### 1) Platform ToS / Compliance / Legal Exposure
- **Scraping LinkedIn/X content** (even via a third-party API) can violate ToS, trigger account/IP bans, and create legal/compliance exposure depending on how it’s used/distributed.
- **Recommendation**: Add an explicit Compliance section in `docs/PRD.md`:
  - Intended usage (personal/internal vs commercial SaaS).
  - Data handling/retention policy.
  - User consent model (especially if scraping profiles, not just public trending).
  - A “safe mode” that uses web sources only.

### 2) “Verification” Is Underspecified (High Hallucination/Reputation Risk)
- PRD says “validate quotes/claims” via Perplexity reasoning, but “verified” can mean many things:
  - The quote exists somewhere on the web (not necessarily credible).
  - The quote is attributable to the claimed author (hard).
  - The claim is factually true (hard, often impossible with limited sources).
- **Recommendation**: Define verification levels (e.g., `UNVERIFIED`, `SOURCE_CONFIRMED`, `MULTISOURCE_CONFIRMED`, `PRIMARY_SOURCE`) and what each requires. Output should reflect the level (don’t label “verified” when it’s just “found somewhere”).

### 3) PRD/TODO Data Model Mismatch
- PRD defines `ScrapedItem` and `ScoredItem` but **no `ValidatedItem`**, yet the TODO and architecture show a validation stage producing `validated_data.json`.
- PRD’s `engagement` schema does not cover X metrics well (retweets, replies, quotes, impressions).
- **Recommendation**: Unify and version the schema (e.g., `RawItem`, `ValidatedItem`, `ScoredItem`) and document:
  - Required vs optional fields per source.
  - Normalization rules (timestamps, URLs, author identity).
  - Provenance (`source`, `sourceUrl`, `retrievedAt`, `rawResponseRef`).

### 4) Multi-Model Workflow Complexity Without Budgets
- 4 external services + image generation is heavy for Phase 0. PRD success criteria says “< 2 minutes” but there’s no **cost/latency budget**, concurrency plan, or fallback strategy.
- **Recommendation**: Add budgets and options:
  - `--fast` vs `--quality` profiles.
  - Source toggles (`--sources web,linkedin,x`).
  - Stage toggles (`--skip-validation`, `--skip-scoring`, `--skip-image`).

## Product & Scope Feedback

### Name and MVP Scope
- Current framing mixes “quote generator” with “trend aggregation + post synthesis + infographic generation”.
- **Recommendation**: For Phase 0, define MVP as either:
  1) “Generate a LinkedIn post from web + citations” (lowest compliance risk), or
  2) “Summarize top public posts + generate draft” (but requires explicit compliance notes).

### Define “Trending”
- PRD assumes “trending content” from APIs, but TODO uses “search by keyword”. Trending vs search yields different user expectations.
- **Recommendation**: Specify:
  - Definition (last X days, min engagement threshold, from which regions/languages).
  - Deterministic query strategy (e.g., derive 3–5 sub-queries from the prompt).

### Output Expectations
- The PRD example is strong, but the product needs explicit requirements:
  - Post length constraints (characters/lines).
  - Voice/tone controls.
  - “No fabricated quotes” rule (only quote if a source URL is attached).
  - Whether to include citations in the post itself vs a separate appendix.

## Architecture & Pipeline Review

### Provenance First (Traceability)
You’re already writing intermediate JSON files—good. Make provenance a first-class contract:
- Every downstream artifact should link back to input items via stable IDs.
- Output should include a `sources.md` or `sources.json` list with URLs + titles + retrieval timestamps.

### Deduplication Is Non-Trivial
- TODO says “Deduplicate by content similarity” but no method is specified.
- **Recommendation**:
  - Start with deterministic normalization + hash (lowercase, strip URLs/emoji/punct, collapse whitespace).
  - Add a second-pass similarity threshold (e.g., token Jaccard or cosine over TF-IDF) if needed.
  - Avoid embeddings at Phase 0 unless you already have infra (cost/complexity).

### “Chain of Thought” Parsing
- PRD mentions “CoT” and parsing reasoning output. Treat model reasoning as **non-contractual**.
- **Recommendation**: Ask models for structured, concise rationales (a few bullet reasons), not chain-of-thought. Only persist what you need for audit (and avoid storing sensitive prompt internals).

### Failure Modes and Partial Results
- PRD says “continue with available data”, but downstream stages should explicitly accept partial inputs.
- **Recommendation**: Define behavior for:
  - One collector fails → still synthesize from remaining sources.
  - Validation fails/timeouts → mark items `UNVERIFIED` and reduce authenticity weight.
  - Scoring parse errors → fallback heuristic scoring.

## AI Workflow & Prompting Feedback

### Enforce Output Schemas
You’ll rely on structured JSON from Perplexity/Gemini/GPT:
- Use JSON Schema or Zod definitions and validate every response.
- Implement robust parsing (strip code fences, handle trailing text, retry with “fix JSON” prompt).

### Reduce Calls With Better Batching Strategy
- Validation and scoring will be the cost/latency hotspots.
- **Recommendation**:
  - Cap items early (e.g., top N by engagement/recency per source before expensive validation).
  - Validate only candidates that might be quoted or used as “facts”.

### Separate “Fact Claims” From “Post Drafting”
To reduce hallucinations:
- Extract candidate claims/quotes with sources first.
- Only then draft the post using those grounded claims.

### Image Generation Risk
Even strong image models can misspell or misrender text:
- **Recommendation**: Make image generation optional (already planned) and consider generating an SVG/HTML infographic for guaranteed text correctness (Phase 1+ or optional in Phase 0).

## Security, Privacy, and Data Retention

### Data Minimization
- Raw scraped content may contain personal data (names/handles, opinions, potentially sensitive info).
- **Recommendation**:
  - Store only what you need by default; add `--save-raw` to opt into full raw dumps.
  - Add retention guidance (e.g., “delete output after X days” for shared environments).

### Secrets Handling
- Ensure logs never print API keys.
- Consider supporting `.env` + OS keychain later; for now at least validate keys and fail fast with clear messaging.

## Performance and Cost Controls (Missing in PRD)

Add explicit budgets and configuration:
- Default max items per source and overall cap before validation.
- Concurrency limits per external API.
- Timeouts per stage and total pipeline.
- Estimated cost reporting (`--print-cost-estimate`) based on token/image usage (even rough, but visible).

## Testing & Evaluation Feedback

The TODO’s “Testing & Validation” is mostly manual. For an AI pipeline, add at least:
- Deterministic unit tests for normalization, dedup, schema validation, file outputs.
- Mocked HTTP tests for collectors (record/replay fixtures).
- Golden tests for prompt→parsed JSON structure (using mocked model responses).
- A tiny “evaluation harness” script that runs a few prompts and checks:
  - No quotes without source URLs.
  - Output adheres to length/format constraints.
  - Intermediate files are written and cross-linked.

## Suggested TODO Improvements (Concrete Additions)

1) **PRD alignment**
- Add `ValidatedItem` + schema versioning to PRD.
- Define verification levels and acceptance rules.

2) **CLI flags**
- `--sources`, `--skip-validation`, `--skip-scoring`, `--skip-image`, `--fast/--quality`, `--save-raw`.

3) **Schema validation**
- Add a `src/schemas/` module with Zod and validate all model outputs.

4) **Provenance outputs**
- Add `sources.json` and/or `sources.md`.
- Ensure `top_50.json` references `raw_data.json` IDs.

5) **Safety guardrails**
- “No fabricated quotes” enforcement: only quote when `url` exists and verification ≥ threshold.
- Add a final “fact-check summary” section in `synthesis.json`.

## Open Questions (Answer Before Implementation)

1) What is the intended usage and compliance stance for LinkedIn/X scraping?
2) Do you require the final LinkedIn post to include citations inline, or is a separate appendix acceptable?
3) What is the minimum acceptable “verification” bar for a quote vs a general claim?
4) What are the cost and latency targets (per run) for Phase 0?
5) Should the tool support multiple languages/regions, or English-only initially?

## Phase 0 “Definition of Done” (Proposed)

- CLI runs end-to-end with `--sources web` and produces `linkedin_post.md` + `sources.json` reliably.
- Optional LinkedIn/X sources gated behind flags and documented compliance caveats.
- No quote appears in the final post unless it has a source URL and verification metadata.
- All model outputs are schema-validated and failures degrade gracefully (not crash-only).
- A small offline test suite passes with mocked API responses.

