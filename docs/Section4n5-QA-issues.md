# Section 4 & 5 QA Findings (Configuration, Utilities)

Context: Reviewed Sections 4 and 5 of `docs/TODO-v2.md` (Configuration, Utility Functions) against current implementations in `src/config.ts`, `src/utils/logger.ts`, `src/utils/fileWriter.ts`, `src/utils/retry.ts`, `src/utils/cost.ts`, and requirements from `docs/PRD-v2.md`. Findings are ordered by severity.

## 1) Stage timeouts are declared but not enforced anywhere
- **Evidence**: `src/types/index.ts:125` defines `STAGE_TIMEOUT_MS = 60000` and config has `timeoutSeconds`, but no utilities/enforcement around per-stage timeouts in logger/fileWriter/retry/config. No call sites use `STAGE_TIMEOUT_MS` or apply stage-level cancellation.
- **Expected**: TODO 4 (“Define stage timeouts”) + PRD performance controls imply actual enforcement (per-stage guardrails to prevent long-hanging calls), not just a constant.
- **Risk**: Long-running collectors/validators/scorers/synthesis could hang indefinitely despite the “define stage timeouts” checkbox being marked done, undermining latency/cost controls.
- **Suggested fix**: Implement and wire per-stage timeout wrappers (e.g., `withTimeout(stageFn, STAGE_TIMEOUT_MS)`) and ensure pipeline orchestration uses them; consider aligning stage timeout with overall `timeoutSeconds`.

## 2) `logProgress` will throw when total = 0 (divide-by-zero → RangeError)
- **Evidence**: `src/utils/logger.ts:79-90` computes `percent = Math.round((current / total) * 100)` and builds a bar with `repeat(Math.floor(percent / 5))`. When `total` is 0 (e.g., no items collected), `percent` becomes `Infinity` and `.repeat(Infinity)` throws.
- **Expected**: Robust progress logging even when totals are zero or unknown; graceful “0/0” handling.
- **Risk**: Pipeline can crash on empty collections/early-exit code paths just from logging, masking the real issue and breaking graceful degradation goals in PRD.
- **Suggested fix**: Guard for `total <= 0` and log a simple message (“0/0”) without bar; or clamp percent/bar lengths safely.

## 3) Provenance files hardcode schema version instead of using shared constant
- **Evidence**: `src/utils/fileWriter.ts:79-111` constructs `sourcesFile` with `schemaVersion: '1.0.0'` (string literal). SCHEMA_VERSION lives in `src/schemas/rawItem.ts`.
- **Expected**: Single source of truth for schema version (PRD mentions schema versioning). Utilities should consume `SCHEMA_VERSION` to avoid drift when the schema version changes.
- **Risk**: If SCHEMA_VERSION updates, `sources.json`/`sources.md` will emit stale versions, breaking compatibility checks or downstream tools.
- **Suggested fix**: Import `SCHEMA_VERSION` from schemas and use it when constructing provenance/status outputs.

## 4) Pipeline status writing lacks validation/shape enforcement
- **Evidence**: `writePipelineStatus` (src/utils/fileWriter.ts:134-152) writes whatever `PipelineStatus` object it receives without schema validation. There is no Zod schema defined for pipeline_status.json.
- **Expected**: Section 5.2 suggests validated outputs (“optional validation” hook exists for JSON). Given PRD emphasis on restartability/debuggability, pipeline_status should be schema-validated or at least shape-checked.
- **Risk**: Inconsistent/malformed status files (e.g., missing fields, partial configs) can slip through, harming post-mortem debugging or resume logic.
- **Suggested fix**: Define a Zod schema for `PipelineStatus` (align with PRD fields) and validate in `writePipelineStatus` (or add an optional schema param).

## 5) Collection metadata naming misaligned with source enums (web/linkedin/x)
- **Evidence**: `src/types/index.ts:72-78` defines `CollectionMetadata` with `twitterCount`; sources are enumerated as `'web' | 'linkedin' | 'x'`, and collectors use `twitter.ts`. No `xCount` exists.
- **Expected**: Section 4 config sources and Section 5 utilities should align metrics with the same identifiers used elsewhere (`x`, not `twitter`), per PRD source list.
- **Risk**: Telemetry/pipeline_status may misreport or drop X results, complicating debugging and cost/throughput reporting.
- **Suggested fix**: Rename to `xCount` (or add an alias) and ensure collector orchestration writes the matching field.
