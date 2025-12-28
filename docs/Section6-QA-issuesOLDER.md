# Section 6 QA Findings (Content Processing)

Context: Reviewed Section 6 of `docs/TODO-v2.md` (Normalization + Deduplication) against implementations in `src/processing/normalize.ts`, `src/processing/dedup.ts`, and unit tests in `tests/unit/normalize.test.ts` + `tests/unit/dedup.test.ts`, with `docs/PRD-v2.md` Deduplication Strategy for context. Findings are ordered by severity.

## 1) Hash dedup reorders items when duplicates are interleaved with unrelated items
- **Evidence**: `src/processing/dedup.ts:116-125` builds the result by iterating the original list but pushes the `kept` item (earliest by `retrievedAt`) at the *first* occurrence of the hash. This shifts the kept item ahead of any unrelated items that appeared between the first and earliest occurrence.
- **Repro example**:
  - Input (indexes): `0:A_late(H,t=3)`, `1:B`, `2:A_early(H,t=1)`
  - `seen` keeps `A_early`, but during result construction the first hash occurrence is index 0, so output becomes `[A_early, B]`.
  - Stable “remove duplicates” behavior would keep original order of remaining items: `[B, A_early]`.
- **Expected**: Dedup should either preserve the original order of kept items (most common for pipeline stability) or explicitly sort by `retrievedAt` if chronology is intended. PRD dedup strategy describes removing duplicates but does not describe reordering.
- **Risk**: Downstream stages that assume ordering (e.g., selecting top-N items before scoring, reproducibility across runs) will observe non-deterministic ordering based on the position of duplicates. This can change which items are prioritized and degrade traceability.
- **Suggested fix**: Build a set of IDs (or hashes) to keep and then `filter` the original array by that set to preserve order. If you want chronological output, explicitly sort by `retrievedAt` *after* dedup. Add a unit test for interleaved duplicates to lock ordering behavior.

## 2) `normalizeUrl` throws on leading/trailing whitespace from scraped sources
- **Evidence**: `src/processing/normalize.ts:171-176` passes `url` directly into `new URL(url)`; there is no `trim()` or whitespace normalization (contrast `normalizeTimestamp`, which trims). No unit test covers whitespace around URLs.
- **Expected**: Normalization should be resilient to common input artifacts (e.g., trailing spaces/newlines from scraping or CSVs) since `sourceUrl` is required and errors here can fail collection/validation.
- **Risk**: A single malformed-but-trimmable URL can throw and cascade into collector failures, violating PRD’s “graceful degradation” intent for non-fatal sources.
- **Suggested fix**: Trim before parsing (`const trimmed = url.trim()`), and add a unit test for whitespace-wrapped URLs. Consider preserving the original URL in error messages for debugging.

## 3) `normalizeTimestamp` treats all-numeric dates as Unix epochs (YYYYMMDD misparsed)
- **Evidence**: `src/processing/normalize.ts:79-85` interprets *any* numeric string as a Unix timestamp. Inputs like `"20240101"` (YYYYMMDD) are treated as seconds → `1970-08-23T...Z`, not January 1, 2024. There is no guard for 8-digit date formats.
- **Expected**: TODO 6.1 says “Handle various input formats.” Numeric date formats are common in CSVs and some APIs; YYYYMMDD should be accepted and normalized to a valid ISO date (UTC midnight) rather than misparsed.
- **Risk**: Incorrect normalization of published dates will distort recency scoring and can mis-rank content (e.g., recent items appear decades old). This affects selection quality.
- **Suggested fix**: Add format detection rules (e.g., length 8 → YYYYMMDD; length 10 → seconds; length 13 → milliseconds) and test these cases. If ambiguous numeric formats are encountered, throw with a clear message rather than silently misparsing.
