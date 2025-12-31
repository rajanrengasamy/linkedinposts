# Section 19 QA Report: Synthesis Model Selection

**Generated:** 2025-12-31
**Reviewed By:** 5 Parallel QA Agents
**Files Reviewed:** 12 files across synthesis, cli, config, types, and utils

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 12 | Action Required |
| MAJOR | 11 | High Priority |
| MINOR/IMPORTANT | 5 | Low Priority |
| **Total** | **28** | |

**Overall Assessment:** Section 19 implementation is functionally complete but has significant **code duplication** (~700 lines in gpt.ts that should be removed) and **inconsistent patterns** across the 4 synthesizers. The new Gemini/Claude/Kimi synthesizers are missing error handling that exists in GPT.

---

## Critical Issues (Must Fix)

### CRIT-1: Gemini Model ID Mismatch with PRD
**Source:** PRD Compliance Review
**Location:** `src/synthesis/gemini-synthesis.ts:45`, `src/synthesis/types.ts:43`
**Confidence:** 100%

**Issue:** PRD Section 15 specifies `gemini-3-pro` but implementation uses `gemini-3-flash-preview`. Different model = different capabilities, cost, and quality.

**Resolution Options:**
1. Update code to use `gemini-3-pro` (match PRD)
2. Update PRD to document intentional use of Flash for cost optimization

---

### CRIT-2: Missing Empty Claims Validation (Gemini/Claude/Kimi)
**Source:** Error Handling Review
**Location:** `src/synthesis/gemini-synthesis.ts:134`, `claude-synthesis.ts:208`, `kimi-synthesis.ts:305`
**Confidence:** 95%

**Issue:** GPT validates empty claims array (gpt.ts:1431-1435) but new synthesizers don't. Empty claims → wasteful API call + garbage output.

**Fix:** Add at start of each synthesizer:
```typescript
if (!claims || claims.length === 0) {
  throw new Error('FATAL: No claims provided - cannot generate post without verified source material');
}
```

---

### CRIT-3: Missing FATAL Prefix on API Key Errors
**Source:** Error Handling Review
**Location:** `gemini-synthesis.ts:149`, `claude-synthesis.ts:108`, `kimi-synthesis.ts:136`
**Confidence:** 100%

**Issue:** Per PRD, synthesis errors should be FATAL. API key errors missing prefix:
```typescript
// Current
throw new Error('GOOGLE_AI_API_KEY is required...');
// Should be
throw new Error('FATAL: GOOGLE_AI_API_KEY is required...');
```

---

### CRIT-4: Massive Code Duplication in gpt.ts (~700 lines)
**Source:** Architecture Review
**Location:** `src/synthesis/gpt.ts:128-214, 519-1072, 1075-1381`
**Confidence:** 100%

**Issue:** The following are duplicated between gpt.ts and prompts.ts:
- `SYSTEM_PROMPT` (lines 128-214)
- `DELIMITERS` (lines 569-576)
- `formatClaimsForPrompt` (lines 640-663)
- `buildSynthesisPrompt` (lines 690-952)
- `buildMultiPostPrompt` (lines 1005-1072)
- `parseSynthesisResponse` (lines 1190-1232)
- `validateOutputConstraints` (lines 1316-1381)

**Fix:** Delete duplicated code from gpt.ts, import from prompts.ts:
```typescript
import {
  SYSTEM_PROMPT, DELIMITERS, formatClaimsForPrompt,
  buildSynthesisPrompt, buildMultiPostPrompt,
  parseSynthesisResponse, validateOutputConstraints
} from './prompts.js';
```

---

### CRIT-5: Inconsistent Synthesizer Function Signatures
**Source:** Architecture Review
**Location:** All 4 synthesizer files
**Confidence:** 95%

**Issue:** 4 synthesizers follow 3 different patterns:
| Model | Returns | Options Type | Interface |
|-------|---------|--------------|-----------|
| GPT | `SynthesisResult` | `SynthesisOptions` | `SynthesizerFn` |
| Gemini | `GeminiSynthesisResponse` (wrapper) | `GeminiSynthesisOptions` | Custom |
| Claude | `ClaudeSynthesisResponse` (wrapper) | `ClaudeSynthesisOptions` | Custom |
| Kimi | `SynthesisResult` | `SynthesisOptions` | `SynthesizerFn` |

Gemini/Claude require adapter wrappers in index.ts (lines 154-176).

**Fix:** Standardize all to implement `SynthesizerFn` directly.

---

### CRIT-6: SynthesisOptions → PipelineConfig Type Mismatch
**Source:** Type Safety Review
**Location:** `src/synthesis/gpt.ts:1593-1623`
**Confidence:** 95%

**Issue:** `SynthesizerFn` accepts `SynthesisOptions` (4 fields) but internal `synthesize()` requires full `PipelineConfig` (20+ fields). The interface doesn't match the implementation.

---

### CRIT-7: Inconsistent Return Types - Usage Data Lost
**Source:** Type Safety Review
**Location:** `src/synthesis/index.ts:153-179`
**Confidence:** 90%

**Issue:** Gemini/Claude return `{ result, usage }` but adapter discards `usage`:
```typescript
return response.result; // usage data lost!
```
Cost tracking is inconsistent across models.

---

## Major Issues (High Priority)

### MAJ-1: No Parse Retry Logic in Gemini/Claude/Kimi
**Source:** Error Handling Review
**Location:** All new synthesizers
**Confidence:** 82%

**Issue:** Per PRD: "Parse error → Retry once". GPT has `parseWithRetry()` but new synthesizers parse once and fail.

---

### MAJ-2: Missing Error Sanitization in Parse Paths
**Source:** Error Handling Review
**Location:** `gemini-synthesis.ts:234`, `claude-synthesis.ts:307`
**Confidence:** 90%

**Issue:** Parse errors not sanitized with `sanitizeErrorMessage()`, could leak API keys.

---

### MAJ-3: Model Fallback Doesn't Check API Key
**Source:** Error Handling Review
**Location:** `src/synthesis/index.ts:180-184`
**Confidence:** 90%

**Issue:** Unknown model falls back to GPT without checking OPENAI_API_KEY exists.

---

### MAJ-4: Direct process.env Access (Security)
**Source:** Security Review
**Location:** `src/synthesis/claude-synthesis.ts:109`
**Confidence:** 90%

**Issue:** Directly accesses `process.env.ANTHROPIC_API_KEY` instead of using `getApiKey()`. Bypasses sanitization layer.

---

### MAJ-5: Incomplete Prompt Injection Defense
**Source:** Security Review
**Location:** `src/synthesis/prompts.ts:239-247`
**Confidence:** 85%

**Issue:** Delimiter escape pattern `/<<<.*>>>/gi` doesn't catch partial delimiters like `<<<USER_PROMPT_END>` (missing one `>`).

---

### MAJ-6: Missing Max Prompt Length Validation
**Source:** Security Review
**Location:** `src/synthesis/prompts.ts:285`
**Confidence:** 85%

**Issue:** Min length (10 chars) validated but no max. Attacker could send 1M char prompt causing DoS/cost exhaustion.

---

### MAJ-7: API Key in Authorization Header Risk
**Source:** Security Review
**Location:** `src/synthesis/kimi-synthesis.ts:360`
**Confidence:** 95%

**Issue:** If axios throws with request config, API key could appear in error details.

---

### MAJ-8: Unused `available` Field
**Source:** Architecture Review
**Location:** `src/synthesis/index.ts:144-184`
**Confidence:** 90%

**Issue:** `selectSynthesizer()` always returns `available: true` - never checks API keys, never used by caller.

---

### MAJ-9: Missing FATAL Prefix on Timeouts
**Source:** Error Handling Review
**Location:** All synthesizers
**Confidence:** 90%

**Issue:** Timeout errors don't have FATAL prefix per PRD.

---

### MAJ-10: Type Assertion Before Validation
**Source:** Type Safety Review
**Location:** `src/config.ts:348-358`
**Confidence:** 85%

**Issue:** `parseSynthesisModel()` does `model as SynthesisModel` before checking `SYNTHESIS_MODELS.includes()`.

---

### MAJ-11: Barrel Export Inconsistency
**Source:** Architecture Review
**Location:** `src/synthesis/index.ts`
**Confidence:** 85%

**Issue:** Exports internal functions (buildSynthesisPrompt, formatClaimsForPrompt) that should be private.

---

## Minor/Important Issues (Low Priority)

| ID | Issue | Location | Severity |
|----|-------|----------|----------|
| MIN-1 | Verbose logging leaks token counts | All synthesizers | Minor |
| MIN-2 | Error messages expose model names | All synthesizers | Minor |
| MIN-3 | Missing postCount range validation | index.ts:226 | Important |
| MIN-4 | Empty response not FATAL | gemini:198, claude:267 | Important |
| MIN-5 | Missing early prompt validation | gemini:162, claude:228 | Important |

---

## Prioritized Action Items

### Immediate (Before Production)
1. **Fix CRIT-2**: Add empty claims validation to Gemini/Claude/Kimi
2. **Fix CRIT-3**: Add FATAL prefix to API key errors
3. **Fix CRIT-4**: Remove ~700 lines of duplicated code from gpt.ts
4. **Fix MAJ-1**: Add parse retry logic to new synthesizers
5. **Fix MAJ-4**: Use `getApiKey()` in claude-synthesis.ts

### High Priority
6. **Fix CRIT-1**: Resolve Gemini model ID (gemini-3-pro vs flash)
7. **Fix CRIT-5**: Standardize synthesizer signatures
8. **Fix MAJ-5**: Strengthen delimiter escape patterns
9. **Fix MAJ-6**: Add max prompt length validation

### Medium Priority
10. **Fix CRIT-6/7**: Align SynthesisOptions with actual requirements
11. **Fix MAJ-3**: Check API key in model fallback
12. **Fix MAJ-8**: Remove unused `available` field

---

## Files Requiring Changes

| File | Issues | Estimated LOC Change |
|------|--------|---------------------|
| `src/synthesis/gpt.ts` | CRIT-4, CRIT-6 | -700 (deletions) |
| `src/synthesis/gemini-synthesis.ts` | CRIT-2, CRIT-3, CRIT-5, MAJ-2 | +30 |
| `src/synthesis/claude-synthesis.ts` | CRIT-2, CRIT-3, CRIT-5, MAJ-2, MAJ-4 | +35 |
| `src/synthesis/kimi-synthesis.ts` | CRIT-2, CRIT-3, MAJ-7 | +25 |
| `src/synthesis/index.ts` | CRIT-7, MAJ-3, MAJ-8, MAJ-11 | +20/-10 |
| `src/synthesis/prompts.ts` | MAJ-5, MAJ-6 | +20 |
| `src/synthesis/types.ts` | CRIT-1 | +1 (model ID) |
| `src/config.ts` | MAJ-10 | +5 |

---

## Positive Findings

The implementation demonstrates several strong practices:
- Consistent use of Zod schema validation
- Timeout enforcement with Promise.race pattern
- Good error sanitization in most paths
- Proper retry logic with exponential backoff (where implemented)
- Clear security boundaries with delimiters
- Comprehensive output constraint validation

---

## Conclusion

Section 19 is **functionally complete** but requires cleanup before production:
- **Primary Issue:** Code duplication in gpt.ts (~700 lines)
- **Secondary Issue:** New synthesizers missing error handling that GPT has
- **Tertiary Issue:** Inconsistent interfaces requiring adapter wrappers

Estimated remediation effort: **4-6 hours** to address all CRITICAL and MAJOR issues.
