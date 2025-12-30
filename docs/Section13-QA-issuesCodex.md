# Section 13 QA Issues (Codex)

## 1) [High] validateItems/timeouts not tested; integration validation tests missing
- Requirement: TODO 13.2 specifies validation tests for validateItems with mocked Perplexity and timeout handling.
- Evidence: `tests/unit/validation.test.ts:774-820` has only `it.todo` placeholders; `tests/integration/validation.test.ts` does not exist.
- Impact: batching, concurrency, skipValidation, and circuit-breaker timeout behavior in `src/validation/perplexity.ts` can regress without detection.
- Recommendation: add real integration tests that mock Perplexity responses and timeouts, and exercise validateItems end-to-end (including circuit breaker); place them in `tests/integration/validation.test.ts` as per TODO.

## 2) [Medium] validateSingleItem tests are spec-only and never call the function
- Requirement: TODO 13.2 expects validation tests to cover parsing and verification scenarios with mocked Perplexity responses.
- Evidence: `tests/unit/validation.test.ts:602-667` constructs ValidatedItem objects directly and states it is simulating expected structure instead of invoking `validateSingleItem`.
- Impact: JSON parsing, fix-JSON retry, schema enforcement, and error handling in `validateSingleItem` are untested; failures could ship.
- Recommendation: mock `makePerplexityRequest` and call `validateSingleItem` directly for success, parse-error, and retry paths.

## 3) [Medium] Golden tests do not run the pipeline with mocked APIs or compare outputs
- Requirement: TODO 13.3 requires running the pipeline with mocked APIs and comparing output structure against golden files.
- Evidence: `tests/golden/golden.test.ts:602-739` only loads static golden JSON and asserts metadata expectations; there is no `runPipeline` invocation or output comparison.
- Impact: regressions in output file generation or schema compliance can pass without detection.
- Recommendation: execute `runPipeline` with mocked collectors/validators/scorers, write to a temp output dir, and compare the produced files to golden expectations.

## 4) [Medium] Evaluation harness can miss quotes without sources (smart quotes + short quotes)
- Requirement: PRD Output Files: quotes in `linkedin_post.md` must have source URLs.
- Evidence: `tests/evaluate.ts:62-76` only matches straight double quotes and ignores quotes shorter than 20 chars; `tests/unit/evaluate.test.ts:234-239` claims to test smart quotes but uses straight quotes.
- Impact: posts with curly quotes (U+201C/U+201D) or short quoted phrases can bypass `checkNoQuotesWithoutSources`, violating provenance rules.
- Recommendation: expand the quote regex to include curly quotes and remove or lower the 20-char threshold; add tests with actual curly quotes.
