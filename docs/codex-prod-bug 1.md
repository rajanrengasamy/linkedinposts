# codex-prod-bug 1

## Summary
The incoherent LinkedIn post output is caused by **garbage claims flowing into synthesis**, not primarily by the GPT-5.2 system prompt. The web collector’s Perplexity response parsing is too permissive and lets **meta/instructional text** (e.g., “I should cite each source properly using the bracket citation method”) become verified claims. The synthesis step then faithfully uses these claims, resulting in nonsensical post content.

## Evidence (from the run you shared)
- Output post contains meta text: `"I should cite each source properly using the bracket citation method"`.
- In `output/2025-12-30_14-43-11/synthesis.json`, the same meta text appears in `keyQuotes`.
- In `output/2025-12-30_14-43-11/top_50.json`, multiple scored items are *not real content*, e.g.:
  - `"I should cite each source properly using the bracket citation method."`
  - `"<think> The user is asking me to provide comprehensive information about AI trends in 2025..."`
  - `"Let me go through the search results systematically:"`
  These are **model meta/instructional strings**, not real quotes or insights.

## Root Cause
1) **Perplexity prompt + parsing allow meta text**
- `src/collectors/web.ts` builds a freeform prompt and expects content blocks in prose.
- `parsePerplexityResponse()` splits the response into blocks and assigns citations 1:1 by index.
- There is **no filtering** to reject meta/instructional blocks or reasoning artifacts.

2) **Claims extraction accepts these blocks**
- `src/synthesis/claims.ts` extracts quotes/insights from any sufficiently verified item.
- If an item contains meta text but is “verified,” it is still eligible for synthesis.

3) **Synthesis uses only provided claims, so it mirrors garbage**
- `src/synthesis/gpt.ts` correctly obeys “only use provided claims.”
- Thus bad claims → bad post. The system prompt is doing its job.

## Why this is a production bug (not just prompt quality)
- The pipeline violates the PRD’s expectation that output claims are grounded in real sources.
- Meta/instructional content is being treated as “verified claims.”
- Synthesis is deterministic relative to its inputs; prompt tweaks won’t fix upstream contamination.

## Impact
- Output posts become incoherent and unprofessional.
- Citations become misleading (URLs attached to non-factual/meta text).
- Trust in the product’s provenance guarantees is undermined.

## Recommended Fixes (ordered by impact)
1) **Constrain Perplexity response format**
   - Update the Perplexity prompt to require strict JSON with fields like:
     - `quote`, `sourceUrl`, `sourceName`, `publishedAt`, `type`.
   - Explicitly forbid meta text, instructions, or analysis.

2) **Filter meta/instructional content during parsing**
   - Add a content filter in `src/collectors/web.ts` to drop blocks containing patterns like:
     - `<think>`, `"I should"`, `"Let me"`, `"as an AI"`, `"search results"`, etc.

3) **Tighten claim extraction**
   - In `src/synthesis/claims.ts`, reject claims that fail a “substantive content” heuristic
     (e.g., minimum noun/verb density, no procedural verbs like “cite,” “format,” “provide”).

4) **Stop creating filler items for unused citations**
   - `parsePerplexityResponse()` currently creates `"Reference from {hostname}"` items.
   - These can become low-quality claims; remove or demote them.

## Notes
- System prompt improvements can still help style, but **they won’t fix** nonsensical content
  if upstream claims are already garbage.
- Fixing the web collector parsing should immediately remove the quoted “I should cite…” artifacts
  from future outputs.
