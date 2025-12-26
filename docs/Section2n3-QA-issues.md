# Section 2 & 3 QA Findings (Schemas, Validation, Types)

Context: Reviewed Sections 2 & 3 of `docs/TODO-v2.md` (Schemas & Validation, Type Definitions) against current implementations in `src/schemas`, `src/types/index.ts`, and requirements from `docs/PRD-v2.md`. Issues are ordered by severity.

## 1) Missing `retryWithFixPrompt` helper (Section 2.3 TODO not implemented)
- **Evidence**: No implementation or export of `retryWithFixPrompt` anywhere in `src/schemas/index.ts` (checked full file). `rg "retryWithFixPrompt" src` returns no results.
- **Expected**: Per TODO 2.3, a helper that re-prompts the model with a “Fix this JSON” instruction and re-validates, to harden model-driven stages against bad JSON.
- **Risk**: Lower resilience to malformed model outputs; scoring/validation/synthesis stages will fail outright instead of auto-recovering, violating PRD’s “retry with fix JSON prompt” intent.
- **Suggested fix**: Implement `retryWithFixPrompt(model, originalPrompt, badResponse, schema)` with one retry path, returning validated data or throwing.

## 2) Verified quotes can lack source URLs (provenance rule not enforced)
- **Evidence**: `src/schemas/validatedItem.ts:35-44` allows `verified: true` without requiring `sourceUrl` (field is optional regardless of verification status).
- **Expected**: PRD principle “No quote or claim appears in the final output unless it has a verified source URL” and TODO 2.1/2.2 intent require that verified quotes carry URLs.
- **Risk**: “Verified” quotes may flow downstream without provenance, breaking the core safety rule and allowing invalid items into synthesis.
- **Suggested fix**: Refine `QuoteVerifiedSchema` with `.refine(q => !q.verified || !!q.sourceUrl, 'sourceUrl required when verified=true')` (and optionally validate URL when verified).

## 3) `contentHash` validation is too weak for dedup guarantees
- **Evidence**: `src/schemas/rawItem.ts:71-72` only requires `contentHash: z.string().min(1)`.
- **Expected**: TODO 2.1 + PRD Dedup Strategy specify a normalized SHA-256 hash truncated to 16 hex chars (`contentHash` should be deterministic and length/charset constrained).
- **Risk**: Collectors could emit arbitrary/non-hex/short hashes, breaking deterministic dedup and causing duplicate leakage or collisions.
- **Suggested fix**: Enforce shape, e.g. `z.string().regex(/^[a-f0-9]{16}$/)` and document “first 16 chars of SHA-256 over normalized content.”

## 4) Validation metadata permits empty sources for confirmed levels
- **Evidence**: `src/schemas/validatedItem.ts:50-68` allows `sourcesFound` as an empty array even when `validation.level` is `SOURCE_CONFIRMED`/`MULTISOURCE_CONFIRMED`/`PRIMARY_SOURCE`.
- **Expected**: PRD Verification Framework requires corroborating sources for non-UNVERIFIED levels; TODO 2.2 targets reliable validation metadata.
- **Risk**: Inconsistent states (e.g., level=PRIMARY_SOURCE with zero `sourcesFound`) can slip past validation and undermine provenance checks.
- **Suggested fix**: Add refinement: if `level !== 'UNVERIFIED'` then `sourcesFound.length > 0`; if `level === 'MULTISOURCE_CONFIRMED'` require `>=2`; if `level === 'PRIMARY_SOURCE'` optionally mark original-source flag.

## 5) Collection metadata uses “twitter” label while source enum is “x”
- **Evidence**: `src/types/index.ts:72-78` defines `CollectionMetadata` with `twitterCount`, but `SourceOption`/`SourceTypeSchema` use `'x'` (and collectors file is `twitter.ts`). No corresponding `xCount` is tracked.
- **Expected**: Section 3 sources are `('web' | 'linkedin' | 'x')[]`; metrics should align with those identifiers to avoid misreporting/aggregation bugs.
- **Risk**: Telemetry and pipeline_status could miscount or ignore X results, leading to incorrect progress reporting and debugging difficulty.
- **Suggested fix**: Rename `twitterCount` → `xCount` (or add both with a single source of truth) and ensure collection orchestration writes the matching field.

## 6) PipelineStatus stores only Partial<PipelineConfig> (repro/debug gap)
- **Evidence**: `src/types/index.ts:91-108` defines `PipelineStatus.config: Partial<PipelineConfig>`.
- **Expected**: Section 3 intends a complete, reproducible config snapshot for each run; PRD emphasizes cost/limit transparency and restartability.
- **Risk**: Missing flags/limits in saved status make runs non-reproducible and hinder debugging (e.g., whether `--skip-validation` or quality profile was active).
- **Suggested fix**: Store the resolved/normalized `PipelineConfig` (full object) in `PipelineStatus`, or at minimum document which fields are omitted and why; prefer full capture to match PRD transparency goals.
