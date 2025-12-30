# Section 12 QA Issues (Codex)

This report covers CLI Entry Point (Section 12) against `docs/PRD-v2.md` and `docs/TODO-v2.md`.

## 1) Pipeline status not written on failure (missing outputDir/stage in error context)

**Severity**: High

**Where**:
- `src/index.ts` (error context passed to `withErrorHandling`)
- `src/cli/errorHandler.ts` (status write guarded by `context.outputDir`)
- `src/cli/runPipeline.ts` (creates timestamped output dir but does not expose it)

**Evidence**:
- `src/index.ts` calls:
  - `withErrorHandling(() => runPipeline(prompt, config), { config, startTime: Date.now() })`
  - The context omits `outputDir` and `stage`.
- `handlePipelineError` only writes `pipeline_status.json` when `context.outputDir` is set.
- `runPipeline` creates a timestamped output directory via `createOutputWriter(config.outputDir)` but never passes that value to the error handler.
- `PipelineState.currentStage` is updated in `runPipeline`, but is never surfaced to the error handler.

**Impact**:
- On any runtime failure inside `runPipeline`, no `pipeline_status.json` is written, and stage info is not captured.
- This violates Section 12.5 requirements to write `pipeline_status.json` with error details and impairs debugging/resume.

**Suggested fix**:
- Create output dir before executing the pipeline (or expose it from `runPipeline`) and include it in `ErrorContext`.
- Pass stage updates into the error context (e.g., update context on each stage transition or use `updatePipelineStage`).
- Ensure `pipeline_status.json` is always written on error once outputDir exists.

**Test gaps**:
- No test asserts that `pipeline_status.json` is written on failure or that `stage` is recorded.

## 2) `--timeout` option is parsed but never enforced

**Severity**: High

**Where**:
- `src/config.ts` (parses `--timeout` into `config.timeoutSeconds`)
- `src/cli/program.ts` (defines `--timeout`)
- `src/cli/preflight.ts` (logs timeout)
- No usage in pipeline execution

**Evidence**:
- `rg` shows `timeoutSeconds` is only used in config parsing and logging; it does not constrain pipeline execution.
- Stage timeouts use `STAGE_TIMEOUT_MS` constants and do not read `config.timeoutSeconds`.

**Impact**:
- User-specified pipeline timeout has no effect; the CLI can run indefinitely beyond the requested cap.
- Violates Section 12 CLI option expectation for a pipeline timeout.

**Suggested fix**:
- Implement a global pipeline timeout wrapper (e.g., `withTimeout(runPipeline, config.timeoutSeconds * 1000)`), or
- Use `config.timeoutSeconds` to drive per-stage timeouts and cancellation behavior.

**Test gaps**:
- No tests assert timeout enforcement for the pipeline when `--timeout` is set.

## 3) Invalid CLI options are silently ignored (sources/quality/image resolution)

**Severity**: Medium

**Where**:
- `src/config.ts` (`parseSources`, `parseQualityProfile`, `parseImageResolution`)
- `src/cli/preflight.ts` (no validation beyond API keys)

**Evidence**:
- `parseSources` filters invalid tokens and always adds `web` without warning.
  - Example: `--sources foo` results in `['web']` silently.
- `parseQualityProfile` defaults to `default` when an invalid value is provided.
- `parseImageResolution` defaults to `2k` for any value other than `4k`.
- There is no validation error path for invalid options, despite Section 12.2 calling for source validation.

**Impact**:
- Users can believe they enabled sources or quality levels that are not actually in use.
- This is especially risky for compliance (e.g., expecting LinkedIn/X usage but getting web-only, or vice versa).

**Suggested fix**:
- Validate CLI options explicitly and throw config errors for invalid values.
- Consider warning when `web` is auto-added or when invalid tokens are removed.

**Test gaps**:
- No tests cover invalid `--sources`, `--quality`, or `--image-resolution` values.

## 4) Missing prompt likely exits with success code

**Severity**: Low

**Where**:
- `src/index.ts` (missing prompt handling)

**Evidence**:
- `program.help()` in Commander exits with code 0 by default.
- The subsequent `process.exit(EXIT_CODES.CONFIG_ERROR)` is likely unreachable.

**Impact**:
- Running the CLI without a prompt yields a success exit code, which contradicts Section 12.5’s config error exit behavior.

**Suggested fix**:
- Use `program.help({ error: true })` or `program.outputHelp()` followed by `process.exit(EXIT_CODES.CONFIG_ERROR)`.

**Test gaps**:
- No test validates exit code behavior when the prompt is missing.
