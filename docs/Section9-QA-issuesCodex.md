# Section 9 (Scoring Engine) - QA Review Report

**Generated:** 2025-12-29
**Reviewed By:** 5 Parallel QA Agents (PRD Compliance, Error Handling, Type Safety, Architecture, Security)
**Files Reviewed:**
- `src/scoring/gemini.ts` (833 lines)
- `src/scoring/fallback.ts` (129 lines)
- `tests/unit/scoring.test.ts`
- `tests/mocks/gemini_scoring_response.json`

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 6 |
| MAJOR | 12 |
| MINOR | 4 |
| **Total** | **22** |

The scoring engine has good foundational code with comprehensive error handling and test coverage, but suffers from several critical gaps: **timeout enforcement**, **response validation**, **top-N truncation**, and **architectural issues**. Security posture is reasonable but needs alignment with validation module patterns.

---

## CRITICAL Issues (Must Fix Before Production)

### CRIT-1: Gemini Timeout Not Enforced
**Location:** `src/scoring/gemini.ts:136-180`
**Confidence:** 95 | **Reviewers:** PRD, Error, Architecture, Security

**Issue:** `makeGeminiRequest()` accepts `timeoutMs` parameter but never enforces it. The timeout is destructured (line 140) but not passed to `generateContent()` or wrapped with AbortController.

**Impact:**
- Requests can hang indefinitely, blocking pipeline
- Violates PRD 60-second stage timeout requirement
- Resource exhaustion risk (DoS)

**Fix:**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
try {
  const response = await client.models.generateContent({...});
  clearTimeout(timeoutId);
  return response.text;
} finally {
  clearTimeout(timeoutId);
}
```

---

### CRIT-2: Incomplete Gemini Responses Silently Accepted - FIXED (Agent 5)
**Location:** `src/scoring/gemini.ts:542-605`
**Confidence:** 90 | **Reviewers:** PRD, Error, Architecture

**Issue:** `processScoredItems()` silently assigns `DEFAULT_SCORES` (all 50s) to items missing from Gemini's response. No validation that response includes all batch IDs.

**Impact:**
- Partial/corrupted responses go undetected
- Default-scored items may outrank legitimately scored items
- Prompt requirement "Include an entry for EVERY item ID" (line 370) is not enforced

**Fix:**
```typescript
const inputIds = new Set(items.map(i => i.id));
const responseIds = new Set(geminiScores.scores.map(s => s.id));
const missingIds = [...inputIds].filter(id => !responseIds.has(id));
if (missingIds.length > 0) {
  throw new Error(`Gemini response missing ${missingIds.length} IDs`);
}
```

**Resolution:** Implemented validation in `processScoredItems()` after building scoreMap. Throws descriptive error with count and sample IDs.

---

### CRIT-3: Missing Top-N Truncation - FIXED (Agent 5)
**Location:** `src/scoring/gemini.ts:813-826`
**Confidence:** 100 | **Reviewers:** PRD, Architecture

**Issue:** `scoreItems()` returns ALL scored items without truncation. PRD Section 9.1 specifies returning top N=50 items.

**Impact:**
- Violates PRD output contract
- Downstream synthesis receives too many items
- `top_50.json` filename becomes misleading
- Increased costs and latency

**Fix:**
```typescript
const topN = config.topScored ?? 50;
const topItems = allScoredItems.slice(0, topN);
topItems.forEach((item, index) => { item.rank = index + 1; });
return topItems;
```

**Resolution:** Added `topScored` optional field to `PipelineConfig` (default 50). After sorting, slices to top N, re-ranks, and re-validates with `ScoredItemSchema.parse()`.

---

### CRIT-4: Fallback Authenticity Calculation Inconsistent
**Location:** `src/scoring/fallback.ts:70-72`
**Confidence:** 100 | **Reviewers:** PRD

**Issue:** Fallback uses fixed `BASE_AUTHENTICITY = 25` while Gemini uses dynamic base scores. This creates incomparable authenticity values.

**Evidence:**
- Gemini: UNVERIFIED item with base=60 → authenticity=60
- Fallback: UNVERIFIED item → authenticity=25 (fixed)

**Impact:** Fallback scoring produces incompatible results, breaking the "graceful degradation" promise.

**Fix:** Either document why fallback differs, or align with Gemini's approach.

---

### CRIT-5: Missing Barrel Export File
**Location:** `src/scoring/index.ts` (MISSING)
**Confidence:** 100 | **Reviewers:** Architecture

**Issue:** No barrel export file exists, violating project architecture patterns.

**Impact:**
- Consumers must know internal file structure
- Makes refactoring harder
- Inconsistent with other modules

**Fix:** Create `src/scoring/index.ts`:
```typescript
export { scoreItems } from './gemini.js';
export { fallbackScore } from './fallback.js';
```

---

### CRIT-6: API Key Exposure in Error Objects
**Location:** `src/scoring/gemini.ts:184-186`
**Confidence:** 90 | **Reviewers:** Security

**Issue:** `sanitizeGeminiError()` only sanitizes `error.message`, but error objects may contain API keys in `stack`, `cause`, or other properties.

**Fix:** Sanitize entire error object or create clean error without copying stack:
```typescript
const safeError = new Error(`${operationName} failed: ${sanitizedMessage}`);
throw safeError; // Don't copy original stack
```

---

## MAJOR Issues

### MAJ-1: Authenticity Weight Not Zeroed on Validation Skip
**Location:** `src/schemas/scoredItem.ts:63-70`
**Confidence:** 85 | **Reviewers:** PRD

**Issue:** PRD states "On Perplexity timeout: reduce authenticity weight to 0" but `calculateOverallScore()` always uses fixed 0.30 weight.

**Fix:** Make weights configurable or check `config.skipValidation`.

---

### MAJ-2: Fallback Returns Empty Array Silently
**Location:** `src/scoring/fallback.ts:103-112`
**Confidence:** 85 | **Reviewers:** Error

**Issue:** If all items fail validation, returns `[]` without error.

**Fix:** Throw if `scoredItems.length === 0 && items.length > 0`.

---

### MAJ-3: Negative Engagement Values Cause NaN
**Location:** `src/schemas/scoredItem.ts:103-117`
**Confidence:** 82 | **Reviewers:** Error

**Issue:** `calculateEngagementScore()` doesn't validate non-negative values.

**Fix:** `const safeLikes = Math.max(0, likes);`

---

### MAJ-4: Invalid Date Strings Cause NaN Recency
**Location:** `src/schemas/scoredItem.ts:77-97`
**Confidence:** 88 | **Reviewers:** Error

**Issue:** `calculateRecencyScore()` doesn't validate parsed dates.

**Fix:** Check `isNaN(published)` and return default 50.

---

### MAJ-5: Mutation After Zod Validation - FIXED (Agent 5)
**Location:** `src/scoring/gemini.ts:816-818`
**Confidence:** 88 | **Reviewers:** Type Safety

**Issue:** `rank` is mutated after `ScoredItemSchema.parse()`, bypassing validation.

**Fix:** Re-validate after mutation or rebuild objects.

**Resolution:** Added `ScoredItemSchema.parse()` call after re-ranking in `scoreItems()`.

---

### MAJ-6: Code Duplication - Sanitization Logic
**Location:** `gemini.ts:236-269`, `perplexity.ts:46-94`
**Confidence:** 100 | **Reviewers:** Architecture

**Issue:** Prompt injection patterns duplicated across modules.

**Fix:** Extract to `src/utils/sanitization.ts`.

---

### MAJ-7: Code Duplication - Error Sanitization
**Location:** `gemini.ts:203-225`, `perplexity.ts:100-140`
**Confidence:** 95 | **Reviewers:** Architecture

**Issue:** API key sanitization duplicated.

**Fix:** Extract to shared utility.

---

### MAJ-8: Monolithic File (833 lines)
**Location:** `src/scoring/gemini.ts`
**Confidence:** 95 | **Reviewers:** Architecture

**Issue:** Too many responsibilities in one file: API client, prompt building, response parsing, score processing.

**Fix:** Split into: `geminiClient.ts`, `geminiPrompt.ts`, `geminiParser.ts`, `processing.ts`.

---

### MAJ-9: Prompt Injection Defense Incomplete
**Location:** `src/scoring/gemini.ts:347`
**Confidence:** 85 | **Reviewers:** Security

**Issue:** User prompt embedded in quotes without structured delimiters (unlike perplexity.ts which uses `<<<CONTENT_START>>>`).

**Fix:** Use structured delimiters and validate post-sanitization.

---

### MAJ-10: No Pre-Build Prompt Length Validation
**Location:** `src/scoring/gemini.ts:343-376`
**Confidence:** 88 | **Reviewers:** Security

**Issue:** Prompt length only validated after expensive string construction.

**Fix:** Pre-calculate estimated length before building.

---

### MAJ-11: Parse Retry Count Unclear
**Location:** `src/scoring/gemini.ts:643-658`
**Confidence:** 80 | **Reviewers:** PRD

**Issue:** PRD says "retry once" but implementation delegates to generic retry mechanism.

**Fix:** Verify `retryWithFixPrompt()` does exactly one retry.

---

### MAJ-12: Model Name Verification Needed
**Location:** `src/scoring/gemini.ts:49`
**Confidence:** 80 | **Reviewers:** PRD

**Issue:** Uses `gemini-3-flash-preview` - verify this is the correct production model name.

---

## MINOR Issues

### MIN-1: Missing Explicit Type Annotations
**Location:** `gemini.ts:168, 569`
**Reviewers:** Type Safety

Add explicit types for `response.text` and `rawScores` assignments.

---

### MIN-2: Inconsistent Constant Naming
**Location:** Throughout both files
**Reviewers:** Architecture

Standardize on UPPER_SNAKE_CASE for all module constants.

---

### MIN-3: Magic Numbers Without Documentation
**Location:** `fallback.ts:29, 35`
**Reviewers:** Architecture

Add JSDoc explaining why `BASE_AUTHENTICITY = 25` and `DEFAULT_RELEVANCE = 50`.

---

### MIN-4: Inconsistent Comment Style
**Location:** Throughout both files
**Reviewers:** Architecture

Standardize JSDoc for exports, `// ===` for sections.

---

## Prioritized Action Items

### Immediate (Block Production)
1. **CRIT-1**: Implement timeout enforcement with AbortController
2. **CRIT-2**: Add Gemini response ID validation - FIXED (Agent 5)
3. **CRIT-3**: Add top-N truncation to `scoreItems()` - FIXED (Agent 5)
4. **CRIT-5**: Create barrel export `src/scoring/index.ts`
5. **CRIT-6**: Sanitize full error objects, not just message - FIXED (Agent 1)

### High Priority (Before Release)
6. **MAJ-2**: Throw error when fallback returns empty array
7. **MAJ-3**: Clamp negative engagement values to 0
8. **MAJ-4**: Validate date parsing in recency calculation
9. **MAJ-9**: Use structured delimiters for prompt injection defense
10. **CRIT-4**: Document or fix fallback authenticity baseline

### Medium Priority (Technical Debt)
11. **MAJ-6, MAJ-7**: Extract sanitization to shared utils
12. **MAJ-8**: Refactor gemini.ts into smaller modules
13. **MAJ-1**: Make authenticity weight configurable

### Low Priority (Polish)
14. **MIN-1 through MIN-4**: Style and documentation consistency

---

## Test Coverage Gaps

The following scenarios need test coverage:
- [ ] Timeout triggers fallback scoring
- [x] Incomplete Gemini response (missing IDs) triggers error (CRIT-2 fixed)
- [ ] Negative engagement values handled correctly
- [ ] Invalid date strings handled correctly
- [ ] Empty array returned from fallback throws error
- [x] Top-N truncation works correctly (CRIT-3 fixed)

---

## Positive Observations

1. **Good JSDoc coverage** on most functions
2. **Comprehensive error handling** with fallback pattern
3. **Zod schema validation** on all responses
4. **Security awareness** with sanitization (though needs deduplication)
5. **Good test coverage** (60+ tests)
6. **Batch processing** correctly implemented

---

*Report generated by 5 parallel QA agents: PRD Compliance, Error Handling, Type Safety, Architecture, Security*
