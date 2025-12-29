# Section 11 (Image Generation) - QA Review Report

**Date**: 2025-12-29
**Reviewers**: 5 Parallel QA Agents
**Files Reviewed**:
- `src/image/nanoBanana.ts` (687 lines)
- `src/image/index.ts` (43 lines)
- `src/types/image.ts` (211 lines)
- `tests/unit/image.test.ts` (670 lines)

---

## Executive Summary

| Severity | Count | Fixed | Remaining |
|:---------|------:|------:|----------:|
| **CRITICAL** | 5 | 1 | 4 |
| **MAJOR** | 7 | 0 | 7 |
| **MINOR** | 5 | 0 | 5 |
| **TOTAL** | **17** | **1** | **16** |

**Overall Assessment**: Section 11 is **functionally complete** with good documentation, comprehensive test coverage, and strong security practices. However, the module has **significant DRY violations** with duplicate type definitions, constants, and utility functions across multiple files. The implementation correctly handles non-blocking failures per PRD requirements.

**Update (2025-12-29)**: CRIT-1 (duplicate GeminiImageResponse) has been fixed. The type is now consolidated in `src/types/image.ts`.

---

## CRITICAL Issues (5)

### CRIT-1: Duplicate `GeminiImageResponse` Type Definition ✅ FIXED
**Location**: `src/image/nanoBanana.ts:414-430` AND `src/types/image.ts:171-203`
**Category**: Architecture - DRY Violation
**Status**: **FIXED** (2025-12-29)

**Issue**: The `GeminiImageResponse` interface was defined in two files with different structures:
- `nanoBanana.ts` makes `candidates`, `content`, `parts` optional ← CORRECT
- `types/image.ts` makes them required and adds `safetyRatings`, `usageMetadata` ← INCORRECT

**Resolution**:
1. Updated `types/image.ts` with correct definition (optional fields + promptFeedback)
2. Deleted duplicate from `nanoBanana.ts`
3. Added import in `nanoBanana.ts` from `types/index.js`
4. Updated barrel export in `src/image/index.ts` to re-export from `types/image.js`

**Files Modified**: `src/types/image.ts`, `src/image/nanoBanana.ts`, `src/image/index.ts`

---

### CRIT-2: Duplicate `IMAGE_MODEL` Constants
**Location**: `src/image/nanoBanana.ts:38` AND `src/types/image.ts:21`

**Issue**: Primary image model defined in two places:
- `nanoBanana.ts:38`: `IMAGE_MODEL = 'gemini-3-pro-image-preview'`
- `types/image.ts:21`: `IMAGE_MODEL_PRIMARY = 'gemini-3-pro-image-preview'`

Additionally, `IMAGE_MODEL_FALLBACK` in `types/image.ts` is never used.

**Fix**: Consolidate to single source, remove unused fallback constant.

---

### CRIT-3: Triple-Duplicate `IMAGE_COSTS` Definitions
**Location**:
- `src/image/nanoBanana.ts:51-54`
- `src/types/image.ts:56-85`
- `src/utils/cost.ts:39-42`

**Issue**: Image costs defined in THREE locations with incompatible structures:
- Different key formats (`'2k'` vs `'2K'`)
- Different structures (simple map vs detailed object with tokens)

**Impact**: Cost tracking may be inaccurate. Maintenance burden.

**Fix**: Keep authoritative definition in `src/utils/cost.ts`, delete from other files. Use correct pricing: 2K = $0.134, 4K = $0.24.

---

### CRIT-4: Duplicate `RESOLUTION_MAP` Definition
**Location**: `src/image/nanoBanana.ts:43-46` AND `src/types/image.ts:39-42`

**Issue**: Resolution mapping duplicated:
- `nanoBanana.ts`: `RESOLUTION_MAP: Record<string, string>` (loose typing)
- `types/image.ts`: `RESOLUTION_TO_IMAGE_SIZE: Record<ImageResolution, ImageSizeOption>` (proper typing)

**Fix**: Use `RESOLUTION_TO_IMAGE_SIZE` from `types/image.ts`, delete duplicate.

---

### CRIT-5: Duplicate Error Sanitization Functions
**Location**: `src/image/nanoBanana.ts:96-149`

**Issue**: Image module re-implements error sanitization that exists in `src/utils/sanitization.ts`:
- `sanitizeErrorString()` duplicates `sanitizeErrorMessage()`
- `createSanitizedError()` duplicates `createSafeError()`
- `SENSITIVE_ERROR_PATTERNS` duplicates `SENSITIVE_PATTERNS`

**Note**: Same pattern found in Section 10 (synthesis/gpt.ts).

**Fix**: Delete local implementations, import from `utils/sanitization.ts`.

---

## MAJOR Issues (7)

### MAJ-1: No Timeout on `makeImageRequest`
**Location**: `src/image/nanoBanana.ts:511-569`
**Category**: Error Handling

**Issue**: API call has no timeout protection. If Gemini hangs, the pipeline stalls indefinitely. The retry config (line 639-643) uses `withRetry()` without timeout.

**Fix**: Use `withRetryAndTimeout()` instead with 60s timeout per attempt.

---

### MAJ-2: Prompt Length Not Validated Against `MAX_API_PROMPT_LENGTH`
**Location**: `src/image/nanoBanana.ts:87, 625`
**Category**: Error Handling

**Issue**: `MAX_API_PROMPT_LENGTH = 50000` is defined but never used. Prompt length is logged but not validated. Very long prompts could cause API errors or excessive costs.

**Fix**: Add validation or remove unused constant.

---

### MAJ-3: Empty `keyPoints` Array Not Explicitly Handled
**Location**: `src/image/nanoBanana.ts:320-325`
**Category**: Edge Cases

**Issue**: If `brief.keyPoints = []`, the prompt will have an empty "Key Points:" section. While Zod schema requires min(1), runtime edge cases could occur.

**Fix**: Add defensive check with warning.

---

### MAJ-4: Invalid Base64 Data Not Fully Validated
**Location**: `src/image/nanoBanana.ts:468-477`
**Category**: Error Handling

**Issue**: Only validates buffer size (> 1KB). Does not verify PNG/JPEG magic bytes. Malformed base64 could decode to non-image data.

**Fix**: Add magic number validation for PNG (89 50 4E 47) and JPEG (FF D8 FF).

---

### MAJ-5: `ImageGenerationResult` Type Defined But Never Used
**Location**: `src/types/image.ts:125-146`
**Category**: Architecture - Dead Code

**Issue**: `ImageGenerationResult` interface with `durationMs`, `model`, `resolution`, `usedFallback` fields is defined but never used. Actual implementation returns `Buffer | null`.

**Impact**: Lost observability - callers can't track timing or model used.

**Fix**: Either implement the richer return type or remove unused definition.

---

### MAJ-6: Hardcoded Magic Numbers for Size Validation
**Location**: `src/image/nanoBanana.ts:472-477`
**Category**: Code Quality

**Issue**: Uses hardcoded `1000` for minimum image size without named constant, unlike other thresholds (MAX_TITLE_LENGTH, etc.).

**Fix**: Define `MIN_IMAGE_SIZE_BYTES = 1000` constant.

---

### MAJ-7: Unused `createSanitizedError` Function
**Location**: `src/image/nanoBanana.ts:131-149`
**Category**: Dead Code / Security

**Issue**: Function is defined but never called. If used incorrectly in future, could lead to defense-in-depth gaps where both sanitized and original errors are logged.

**Fix**: Remove unused function or document proper usage.

---

## MINOR Issues (5)

### MIN-1: Resolution Mapping Fallback Silently Uses Hardcoded Value
**Location**: `src/image/nanoBanana.ts:616`

**Issue**: `RESOLUTION_MAP[config.imageResolution] ?? '2K'` silently falls back without warning if unknown resolution provided.

**Fix**: Log warning when fallback is used.

---

### MIN-2: Incomplete Barrel Export Documentation
**Location**: `src/image/index.ts`

**Issue**: Exports listed without clear indication of public API vs testing utilities.

**Fix**: Add grouping comments like other modules (scoring, synthesis).

---

### MIN-3: Missing Test Coverage for Error Paths
**Location**: `tests/unit/image.test.ts`

**Issue**: Missing tests for:
- `extractStatusCode()` logic
- `getStatusCodeMessage()` switch cases
- Network failure scenarios (ETIMEDOUT, ECONNREFUSED)
- 429 Rate Limit handling

---

### MIN-4: Non-null Assertions in Test Code
**Location**: `tests/unit/image.test.ts:591, 601, 607`

**Issue**: Tests use `!` non-null assertions which bypass TypeScript safety.

**Fix**: Use proper type guards.

---

### MIN-5: colorScheme Sanitization Edge Case
**Location**: `src/image/nanoBanana.ts:328-330`

**Issue**: If `brief.colorScheme = ""` (empty string), it passes truthiness check but sanitizes to empty. If all content is stripped as injection patterns, result could be empty.

**Fix**: Add trim check after sanitization.

---

## Positive Findings

The following aspects are **well-implemented**:

1. **Non-Blocking Failures**: Correctly returns `null` on error, pipeline continues
2. **Input Sanitization**: Uses `sanitizePromptContent()` on all user inputs
3. **Content Truncation**: Well-defined limits (MAX_TITLE_LENGTH=100, MAX_KEY_POINTS=5)
4. **Style Instructions**: Good mapping for minimal, data-heavy, quote-focused styles
5. **Retry Integration**: Uses shared `withRetry()` utility
6. **Test Coverage**: 670 lines of tests with good scenario coverage
7. **Security**: No API key leakage, all logging uses `sanitize()`
8. **Documentation**: Comprehensive JSDoc comments throughout

---

## Security Assessment

**Grade: A-** (No critical security issues)

| Control | Status | Evidence |
|:--------|:-------|:---------|
| API Key Protection | PASS | All keys via `getApiKey()`, sanitized logging |
| Prompt Injection | PASS | `sanitizePromptContent()` on all inputs |
| Error Sanitization | PASS | Uses `sanitize()` before logging |
| Rate Limiting | PASS | Retry with exponential backoff |

---

## PRD Compliance Summary

| Requirement | Status |
|:------------|:-------|
| Generate infographic from brief | PASS |
| Skip with --skip-image flag | PASS |
| Non-blocking failure | PASS |
| 2K/4K resolution options | PASS |
| Cost tracking | PASS |

---

## Prioritized Action Items

### Must Fix (CRITICAL)
1. ~~**[CRIT-1]** Consolidate `GeminiImageResponse` type~~ ✅ **FIXED**
2. **[CRIT-2]** Consolidate `IMAGE_MODEL` constants
3. **[CRIT-3]** Consolidate `IMAGE_COSTS` to `utils/cost.ts`, fix pricing discrepancy
4. **[CRIT-4]** Consolidate `RESOLUTION_MAP`
5. **[CRIT-5]** Use shared error sanitization from `utils/sanitization.ts`

### Should Fix (MAJOR)
6. **[MAJ-1]** Add timeout to image generation
7. **[MAJ-2]** Validate or remove `MAX_API_PROMPT_LENGTH`
8. **[MAJ-4]** Add image magic number validation
9. **[MAJ-5]** Clean up unused types in `types/image.ts`

### Nice to Have (MINOR)
10. Log warning on resolution fallback
11. Improve barrel export documentation
12. Add error path test coverage

---

## Estimated Fix Effort

| Priority | Effort |
|:---------|-------:|
| CRITICAL | ~3 hours |
| MAJOR | ~1.5 hours |
| MINOR | ~1.5 hours |
| **Total** | **~6 hours** |

---

## Conclusion

Section 11 (Image Generation) is **100% PRD compliant** with solid implementation. The main concerns are:

1. **Architecture debt**: 5 DRY violations need consolidation
2. **Robustness**: Missing timeout protection on API calls

The security implementation is strong with no API key leakage risks. The module correctly implements non-blocking failure handling as required by the PRD.
