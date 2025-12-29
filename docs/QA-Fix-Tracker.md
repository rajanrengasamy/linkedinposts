# QA Fix Tracker

**Generated:** 2025-12-29
**Source Files:**
- docs/Section10-QA-issuesClaude.md
- docs/Section10-QA-issuesCodex.md

## Issues to Fix

### Critical Issues (5 total)
- [x] CRIT-1: Error re-throw exposes unsanitized original error - `src/synthesis/gpt.ts`
- [x] CRIT-2: Unsafe type assertion bypasses OpenAI SDK types - `src/synthesis/gpt.ts`
- [x] CRIT-3: Duplicate error sanitization logic - `src/synthesis/gpt.ts`
- [x] CRIT-4: Prompt injection via unsanitized author/URL fields - `src/synthesis/gpt.ts`
- [x] CODEX-CRIT-1: parseSynthesisResponse always fails due to empty prompt - `src/synthesis/gpt.ts`

### Major Issues (19 total)
- [x] MAJ-1: Missing pre-validation of API key before retry loop - `src/synthesis/gpt.ts`
- [x] MAJ-2: Usage fallback creates empty object instead of throwing - `src/synthesis/gpt.ts`
- [x] MAJ-3: No validation that claim extraction yielded results - `src/synthesis/claims.ts`
- [x] MAJ-4: buildClaim() silently returns null on validation failure - `src/synthesis/claims.ts`
- [x] MAJ-5: @ts-expect-error suppresses all type errors - `src/synthesis/gpt.ts`
- [x] MAJ-6: No content length limits before sanitization (DoS risk) - `src/synthesis/claims.ts`
- [x] MAJ-7: Prompt length estimation lacks safety buffer - `src/synthesis/gpt.ts`
- [x] MAJ-8: Function length exceeds best practices (102 lines) - `src/synthesis/gpt.ts`
- [x] MAJ-9: Missing JSDoc for utility functions - `src/synthesis/claims.ts`
- [x] MAJ-10: Code duplication in quote extraction - `src/synthesis/claims.ts`
- [x] MAJ-11: Inconsistent error message formatting - `src/synthesis/gpt.ts`
- [x] MAJ-12: Missing input validation for edge cases - `src/synthesis/gpt.ts`
- [x] MAJ-13: Missing constants for extraction thresholds - `src/synthesis/claims.ts`
- [x] MAJ-14: Potential ReDoS in complex regex patterns - `src/synthesis/claims.ts`
- [x] MAJ-15: Race condition in OpenAI client singleton - `src/synthesis/gpt.ts`
- [x] MAJ-16: Missing distinction between fixable/unfixable parse errors - `src/synthesis/gpt.ts`
- [x] MAJ-17: Hardcoded 500 in sanitizePromptContent call - `src/synthesis/gpt.ts`
- [x] MAJ-18: Incomplete empty response handling - `src/synthesis/gpt.ts`
- [x] CODEX-HIGH-1: Quote provenance not enforced - `src/synthesis/gpt.ts`

### Minor Issues (6 total)
- [x] MIN-1: Weak validation in extractFirstMeaningfulSentence() - `src/synthesis/claims.ts`
- [x] MIN-2: No minimum length validation for posts - `src/synthesis/gpt.ts`
- [x] MIN-3: Structured delimiters not documented as security boundary - `src/synthesis/gpt.ts`
- [x] MIN-4: No rate limiting on OpenAI requests - `src/synthesis/gpt.ts`
- [x] MIN-5: Complex regex patterns without inline comments - `src/synthesis/claims.ts`
- [x] CODEX-MED-1: Statistic detection is stateful due to global regexes - `src/synthesis/claims.ts`

## Fix Progress

| Issue | Agent | Status | Notes |
|-------|-------|--------|-------|
| CRIT-1 | Agent 1 | ✅ Fixed | Always create new sanitized error |
| CRIT-2 | Agent 1 | ✅ Fixed | Using proper NonStreaming type |
| CRIT-3 | Agent 1 | ✅ Fixed | Replaced with createSafeError |
| CRIT-4 | Agent 2 | ✅ Fixed | Sanitize author/sourceUrl fields |
| CODEX-CRIT-1 | Agent 2 | ✅ Fixed | Created GPTSynthesisResponseSchema partial schema |
| MAJ-1 | Agent 3 | ✅ Fixed | Pre-validate API key before processing |
| MAJ-2 | Agent 3 | ✅ Fixed | Throw on missing usage stats |
| MAJ-3 | Agent 3 | ✅ Fixed | Added extractGroundedClaimsOrThrow() |
| MAJ-4 | Agent 3 | ✅ Fixed | Added warning log on validation failure |
| MAJ-16 | Agent 3 | ✅ Fixed | Added JsonParseError vs SchemaValidationError |
| MAJ-18 | Agent 3 | ✅ Fixed | Specific checks for each empty response case |
| MAJ-5 | Agent 4 | ✅ Fixed | GPT52ChatCompletionParams type defined |
| MAJ-6 | Agent 4 | ✅ Fixed | MAX_RAW_TEXT_LENGTH pre-truncation |
| MAJ-7 | Agent 4 | ✅ Fixed | PROMPT_LENGTH_SAFETY_BUFFER = 1.1 |
| MAJ-12 | Agent 4 | ✅ Fixed | MIN_USER_PROMPT_LENGTH validation |
| MAJ-14 | Agent 4 | ✅ Fixed | MAX_REGEX_CONTENT_LENGTH check |
| MAJ-15 | Agent 4 | ✅ Fixed | clientInitializing lock flag |
| CODEX-HIGH-1 | Agent 4 | ✅ Fixed | Validate keyQuotes against allowed sourceUrls |
| MAJ-8 | Agent 5 | ✅ Fixed | Extracted parseWithRetry() helper |
| MAJ-9 | Agent 5 | ✅ Fixed | Complete JSDoc with @param/@returns/@example |
| MAJ-10 | Agent 5 | ✅ Fixed | extractQuotesWithPattern() helper |
| MAJ-11 | Agent 5 | ✅ Fixed | Standardized FATAL: Operation - details format |
| MAJ-13 | Agent 5 | ✅ Fixed | Named constants for thresholds |
| MAJ-17 | Agent 5 | ✅ Fixed | Using MAX_CLAIM_LENGTH constant |
| MIN-1 | Agent 5 | ✅ Fixed | CTA detection, min word count |
| MIN-2 | Agent 5 | ✅ Fixed | Min 100 char warning |
| MIN-3 | Agent 5 | ✅ Fixed | Security boundary documentation |
| MIN-4 | Agent 5 | ✅ Fixed | waitForRateLimit() tracker |
| MIN-5 | Agent 5 | ✅ Fixed | Inline regex comments |
| CODEX-MED-1 | Agent 5 | ✅ Fixed | Non-global test patterns |

---

## Section 11 (Image Generation) QA Fixes - Session 2

**Sources**:
- `docs/Section11-QA-issuesClaude.md`
- `docs/Section11-QA-issuesCodex.md`
**Date**: 2025-12-29

### Critical Issues (5 total)
- [x] CRIT-1: Duplicate `GeminiImageResponse` type - FIXED (previous session)
- [x] CRIT-2: Duplicate `IMAGE_MODEL` constants - Consolidated to `types/image.ts`
- [x] CRIT-3: Triple-duplicate `IMAGE_COSTS` - FIXED (previous session)
- [x] CRIT-4: Duplicate `RESOLUTION_MAP` - Now uses `RESOLUTION_TO_IMAGE_SIZE` from types
- [x] CRIT-5: Duplicate error sanitization - Already removed, uses `utils/sanitization.ts`

### Major Issues (7 total)
- [x] MAJ-1: No timeout on `makeImageRequest` - Added `withRetryAndTimeout()` with 60s timeout
- [x] MAJ-2: `MAX_API_PROMPT_LENGTH` defined but never used - Now validates prompt length
- [x] MAJ-3: Empty `keyPoints` array not explicitly handled - Added defensive check + warning
- [x] MAJ-4: Invalid base64 data not fully validated - Added PNG/JPEG magic byte validation
- [x] MAJ-5: `ImageGenerationResult` type defined but never used - Removed unused type
- [x] MAJ-6: Hardcoded magic number `1000` for size validation - Added `MIN_IMAGE_SIZE_BYTES` constant
- [x] MAJ-7: Unused `createSanitizedError` function - Removed unused functions

### Minor Issues (5 total)
- [x] MIN-1: Resolution mapping fallback silently uses hardcoded value - Added warning log
- [x] MIN-2: Incomplete barrel export documentation - Added grouping comments
- [x] MIN-3: Missing test coverage for error paths - Added 18 new test cases
- [x] MIN-4: Non-null assertions in test code - Replaced with proper type guards
- [x] MIN-5: `colorScheme` sanitization edge case - Added trim check after sanitization

### Codex Issues (2 total)
- [x] CODEX-MED-1: Fallback image model not implemented - Added `IMAGE_MODEL_FALLBACK` + retry logic
- [x] CODEX-LOW-1: Prompt resolution text uses pixels instead of 2k/4k - Now uses '2k'/'4k' format

### Agent Distribution

| Agent | Issues Assigned | Focus Area |
|-------|-----------------|------------|
| Agent 1 | CRIT-2, CRIT-4, CRIT-5 | DRY consolidation + shared utilities |
| Agent 2 | MAJ-1, MAJ-2, MAJ-3 | Error handling + edge cases |
| Agent 3 | MAJ-4, MAJ-5, MAJ-6 | Type safety + validation |
| Agent 4 | MAJ-7, CODEX-MED-1, CODEX-LOW-1 | Functional improvements |
| Agent 5 | MIN-1, MIN-2, MIN-3, MIN-4, MIN-5 | Polish + test coverage |

### Fix Progress (Session 2)

| Issue | Agent | Status | Notes |
|-------|-------|--------|-------|
| CRIT-2 | Agent 1 | ✅ Fixed | Consolidated IMAGE_MODEL to types/image.ts |
| CRIT-4 | Agent 1 | ✅ Fixed | Uses RESOLUTION_TO_IMAGE_SIZE from types |
| CRIT-5 | Agent 1 | ✅ Fixed | Already removed, was unused |
| MAJ-1 | Agent 2 | ✅ Fixed | withRetryAndTimeout() with 60s timeout |
| MAJ-2 | Agent 2 | ✅ Fixed | Prompt length validation added |
| MAJ-3 | Agent 2 | ✅ Fixed | Defensive check + warning for empty keyPoints |
| MAJ-4 | Agent 3 | ✅ Fixed | PNG/JPEG magic byte validation |
| MAJ-5 | Agent 3 | ✅ Fixed | Removed unused ImageGenerationResult type |
| MAJ-6 | Agent 3 | ✅ Fixed | MIN_IMAGE_SIZE_BYTES constant |
| MAJ-7 | Agent 4 | ✅ Fixed | Removed unused sanitization functions |
| CODEX-MED-1 | Agent 4 | ✅ Fixed | IMAGE_MODEL_FALLBACK + retry logic |
| CODEX-LOW-1 | Agent 4 | ✅ Fixed | Resolution format now uses '2k'/'4k' |
| MIN-1 | Agent 5 | ✅ Fixed | Warning log on fallback |
| MIN-2 | Agent 5 | ✅ Fixed | Barrel export with grouping comments |
| MIN-3 | Agent 5 | ✅ Fixed | 18 new test cases for error paths |
| MIN-4 | Agent 5 | ✅ Fixed | Replaced ! assertions with type guards |
| MIN-5 | Agent 5 | ✅ Fixed | Trim check after sanitization |

---

## Summary

**Section 10**: 30 issues - 30 fixed ✅
**Section 11**: 17 issues - 17 fixed ✅

### Files Modified (Session 2 - Image Generation)
- `src/types/image.ts` - Consolidated IMAGE_MODEL, removed unused types
- `src/types/index.ts` - Updated exports for image constants
- `src/image/nanoBanana.ts` - Major refactoring: DRY fixes, timeout, validation, fallback model
- `src/image/index.ts` - Reorganized barrel export with documentation
- `tests/unit/image.test.ts` - 18 new tests, removed non-null assertions

### Files Modified (All Sessions)
- `src/synthesis/gpt.ts` - Major refactoring for all GPT-related issues
- `src/synthesis/claims.ts` - Quote extraction, validation, and DoS prevention
- `src/synthesis/index.ts` - New exports
- `src/schemas/synthesisResult.ts` - GPTSynthesisResponseSchema
- `src/schemas/index.ts` - Error classes, exports
- `tests/unit/synthesis.test.ts` - Updated tests for new behavior
- `src/types/image.ts` - Consolidated GeminiImageResponse type, IMAGE_MODEL
- `src/image/nanoBanana.ts` - DRY fixes, timeout, validation, fallback model
- `src/image/index.ts` - Updated barrel export with documentation

### Verification
- [x] TypeScript compiles: `npx tsc --noEmit` ✅
- [x] All tests pass: `npm test` ✅ (539 tests pass)
- [x] No regressions introduced ✅
