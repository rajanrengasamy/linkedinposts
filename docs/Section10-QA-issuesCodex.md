# Section 10 QA Issues (Codex)

## 1) [Critical] parseSynthesisResponse always fails due to empty prompt

- Location: `src/synthesis/gpt.ts:658` - `src/synthesis/gpt.ts:685`
- Details:
  - `parseSynthesisResponse()` builds a `SynthesisResult` with `prompt: ''` and then validates with `SynthesisResultSchema`.
  - `SynthesisResultSchema` requires `prompt` to be a non-empty string, so this always throws even when the GPT response is valid.
- Impact:
  - `synthesize()` will always hit the fix-JSON retry path, adding an extra GPT call and cost for every run.
  - The retry path asks GPT to fabricate `schemaVersion`, `generatedAt`, and `metadata`, which should be deterministic and set by the pipeline; this can fail or produce untrusted metadata.
  - If GPT does not set `schemaVersion` exactly, final validation fails even though the original response was valid.
- Example failure mode:
  - GPT returns valid JSON matching the prompt format (linkedinPost/keyQuotes/infographicBrief/factCheckSummary).
  - `parseSynthesisResponse()` throws a Zod error: `prompt: String must contain at least 1 character(s)`.
- Expected:
  - The first parse should succeed without forcing a retry when the GPT response matches the requested format.
- Suggested fix:
  - Pass the user prompt into `parseSynthesisResponse()` (or set a placeholder) and only validate against `SynthesisResultSchema` after `prompt` and `metadata` are populated.
  - Use a partial schema for the GPT response (linkedinPost/keyQuotes/infographicBrief/factCheckSummary) and keep the fix-JSON retry on that partial schema instead of the full result.

## 2) [High] Quote provenance not enforced (requirement gap)

- Location: `src/synthesis/gpt.ts:703` - `src/synthesis/gpt.ts:726`
- Requirement (TODO 10.2): "Verify: No quote in post without sourceUrl in claims."
- Current behavior:
  - `validateOutputConstraints()` only checks that `keyQuotes` contain a `sourceUrl` field.
  - There is no validation that those `sourceUrl` values exist in the provided claims, or that all quoted text in `linkedinPost` is represented in `keyQuotes`/claims.
- Impact:
  - GPT can insert a quote into the post without any backed claim, and the pipeline will still pass.
  - GPT can fabricate a `sourceUrl` not in the claims list and it will be accepted.
  - `buildSourceReferences()` will mark sources used based on `keyQuotes`, so untracked quotes lead to incorrect provenance.
- Example failure mode:
  - `linkedinPost` includes a quoted sentence that is not in `keyQuotes`, or a `keyQuotes.sourceUrl` that never appears in the claims set.
  - No error is thrown; output violates "no quote without source".
- Suggested fix:
  - Build a set of allowed quotes and sourceUrls from the `claims` array.
  - Enforce that every quoted string in `linkedinPost` appears in claims (or in `keyQuotes` that map back to claims).
  - Validate that every `keyQuotes.sourceUrl` matches a `claims.sourceUrl`.
  - Throw `FATAL` on any mismatch.

## 3) [Medium] Statistic detection in extractInsights is stateful due to global regexes

- Location: `src/synthesis/claims.ts:73` - `src/synthesis/claims.ts:115`, `src/synthesis/claims.ts:373` - `src/synthesis/claims.ts:378`
- Details:
  - `PERCENTAGE_PATTERN`, `DOLLAR_PATTERN`, and `LARGE_NUMBER_PATTERN` are global (`/g`).
  - `hasStatistic()` uses `.test()` on these global regexes. Because `.test()` advances `lastIndex`, repeated calls can return false negatives after a match (especially after `extractStatistics()` iterates with `matchAll`).
- Impact:
  - Sentences containing statistics may slip into `extractInsights()` instead of being filtered out, producing incorrect claim types and duplicates.
  - This weakens the separation between statistics and insights required in Section 10.1.
- Suggested fix:
  - Remove the `/g` flag for regexes used with `.test()`, or reset `lastIndex = 0` before each test, or instantiate fresh RegExp objects in `hasStatistic()`.
