# Plan: Implement CLI-Based Nano Banana Fallback System

**Created**: 2026-01-17
**Status**: Ready for Implementation
**Agents**: 5 parallel senior-developer agents

## Summary

Replace the current direct API-only image generation in linkedinquotes with a three-tier fallback system adopted from redditnews Stage 6. This enables subscription-based billing via the Gemini CLI's Nano Banana extension before falling back to per-token API billing.

---

## Architecture Overview

```
                       ┌──────────────────────┐
                       │  generateInfographic │
                       │    (entry point)     │
                       └──────────┬───────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │   routeImageGeneration()    │
                    │     (nanoBananaRouter.ts)   │
                    └─────────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │   Tier 1: CLI    │ │   Tier 2: API    │ │  Tier 3: Manual  │
    │ (subscription)   │ │ (per-token)      │ │ (no API key)     │
    │                  │ │                  │ │                  │
    │ gemini "/gen..." │ │ makeImageRequest │ │ return null +    │
    │ --yolo -o json   │ │ (existing API)   │ │ log instructions │
    └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
             │                    │                    │
             │  CLI Error?        │  API Error?        │
             ├────────────────────▶                    │
             │                    ├────────────────────▶
             ▼                    ▼                    ▼
    ┌──────────────────────────────────────────────────────────┐
    │              Return ImageRouterResult                    │
    │  { buffer, tier: 'cli'|'api'|'manual', tiersAttempted } │
    └──────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/image/
├── index.ts                 # UPDATE: Add new exports
├── nanoBanana.ts            # UPDATE: Delegate to router (keep prompt building)
├── nanoBananaCli.ts         # NEW: CLI wrapper using subprocess
├── nanoBananaRouter.ts      # NEW: Three-tier fallback orchestration
└── types.ts                 # NEW: CLI-specific types and errors
```

---

## Implementation Tasks (5 Parallel Agents)

### Agent 1: Create CLI Types and Error Classes

**File**: `src/image/types.ts`

**Tasks**:
1. Create error class hierarchy (mirroring `src/llm/types.ts` pattern):
   - `NanoBananaError` (base class with exitCode)
   - `NanoBananaNotFoundError` (CLI not installed)
   - `NanoBananaAuthError` (authentication failed)
   - `NanoBananaTimeoutError` (generation timeout)
   - `NanoBananaGenerationError` (generation failed)

2. Create CLI response interfaces:
   - `NanoBananaCliResponse` (success, imagePath, outputDir, prompt, model, message, rawOutput)
   - `ImageGenerationTier` type ('cli' | 'api' | 'manual')
   - `ImageRouterResult` (buffer, tier, tiersAttempted)
   - `ImageRouterOptions` (enableCLI, enableAPI, enableManual, timeout)

3. Add constants:
   - `DEFAULT_NANO_BANANA_MODEL = 'gemini-3-pro-image-preview'`
   - `DEFAULT_CLI_TIMEOUT_MS = 120000` (images take longer)
   - `NANO_BANANA_OUTPUT_DIR = 'nanobanana-output'`

**Reference Files**:
- `src/llm/types.ts` (lines 1-100) - error class pattern
- `redditnews/Terminal_app/utils/nano_banana_wrapper.py` (lines 43-100) - error classes

---

### Agent 2: Create CLI Wrapper

**File**: `src/image/nanoBananaCli.ts`

**Tasks**:
1. Create `NanoBananaCLIWrapper` class:
   - Constructor accepting model, timeout, workingDir
   - Use `detectCLI('gemini')` from `src/llm/cli-detector.ts` for path detection
   - Create `nanobanana-output` directory if not exists

2. Implement environment scrubbing method:
   - Copy process.env
   - Set `NANOBANANA_MODEL` to configured model
   - Pass through `NANOBANANA_GEMINI_API_KEY` or `GOOGLE_API_KEY`
   - Ensure HOME is set for CLI auth

3. Implement `generateImage(prompt, outputPath?)` method:
   - Build command: `gemini "/generate PROMPT" --yolo -o json`
   - Execute with `spawn` from `child_process`
   - Parse JSON output
   - Find most recent PNG in output directory
   - Copy to outputPath if specified
   - Return `NanoBananaCliResponse`

4. Implement `generateImageBytes(prompt)` method:
   - Call generateImage
   - Read image file to Buffer
   - Return Buffer or null

5. Implement helper methods:
   - `findGeneratedImage()` - sort PNGs by mtime, return newest
   - `parseCLIOutput(stdout)` - parse JSON from CLI
   - `sanitizeFilename(prompt)` - convert prompt to safe filename

6. Export factory function:
   - `getNanoBananaCLIClient(options?)` - returns wrapper or null if CLI unavailable
   - `isNanoBananaCliAvailable()` - boolean check

**Reference Files**:
- `src/llm/gemini-cli-wrapper.ts` (lines 1-150) - spawn pattern, env scrubbing
- `redditnews/Terminal_app/utils/nano_banana_wrapper.py` (lines 104-395) - implementation

---

### Agent 3: Create Router

**File**: `src/image/nanoBananaRouter.ts`

**Tasks**:
1. Implement `shouldUseNanoBananaCLI()` function:
   - Check `USE_NANO_BANANA` env var (default: true)
   - Check if gemini CLI is available via `detectCLI('gemini')`
   - Return boolean

2. Implement `routeImageGeneration(brief, config, options?)` function:
   - Track tiersAttempted array
   - Tier 1 (CLI): Try NanoBananaCLIWrapper if enabled
   - Tier 2 (API): Fall to existing makeImageRequest if CLI fails
   - Tier 3 (Manual): Return null and log manual instructions
   - Return `ImageRouterResult`

3. Implement error classification:
   - `shouldFallbackFromCLI(error)` - NotFound, Auth, Timeout, Generation errors trigger fallback
   - Do NOT fallback on unexpected errors (rethrow)

4. Implement `logManualModeInstructions(brief)`:
   - Log prompt that user can paste into Gemini web
   - Include title and key points

5. Implement `logImageRouterStatus()`:
   - Log which tiers are enabled/available
   - Useful for debugging configuration

**Reference Files**:
- `src/llm/fallback-router.ts` (lines 1-150) - router pattern
- `redditnews/Terminal_app/stage_6_visuals.py` (lines 106-161) - fallback logic

---

### Agent 4: Update Existing nanoBanana.ts

**File**: `src/image/nanoBanana.ts`

**Tasks**:
1. Refactor `generateInfographic()` to use router:
   - Import `routeImageGeneration` from router
   - Delegate to router instead of direct API call
   - Preserve existing prompt building logic
   - Log which tier succeeded

2. Extract API-specific logic to internal function:
   - Create `generateInfographicViaAPI(brief, config)` (internal, not exported)
   - Move existing makeImageRequest + retry logic here
   - This becomes Tier 2 in the router

3. Keep all existing exports intact:
   - `buildInfographicPrompt` - unchanged
   - `makeImageRequest` - unchanged (used by Tier 2)
   - `parseImageResponse` - unchanged
   - `getImageClient` - unchanged
   - All constants - unchanged

4. Update JSDoc comments to document the fallback system

**Reference Files**:
- Current `src/image/nanoBanana.ts` (lines 782-870) - generateInfographic
- `redditnews/Terminal_app/stage_6_visuals.py` (lines 547-592) - integration pattern

---

### Agent 5: Update Exports and Add Tests

**File**: `src/image/index.ts` (updates)

**Tasks**:
1. Add new exports to index.ts:
   ```typescript
   // CLI Wrapper
   export { NanoBananaCLIWrapper, getNanoBananaCLIClient, isNanoBananaCliAvailable } from './nanoBananaCli.js';

   // Router
   export { routeImageGeneration, shouldUseNanoBananaCLI, logImageRouterStatus } from './nanoBananaRouter.js';

   // Types
   export type { NanoBananaCliResponse, ImageGenerationTier, ImageRouterResult, ImageRouterOptions } from './types.js';
   export { NanoBananaError, NanoBananaNotFoundError, NanoBananaAuthError, NanoBananaTimeoutError, NanoBananaGenerationError } from './types.js';
   ```

2. Create test file `src/image/nanoBananaCli.test.ts`:
   - Test CLI wrapper initialization
   - Test findGeneratedImage logic
   - Mock child_process.spawn

3. Create test file `src/image/nanoBananaRouter.test.ts`:
   - Test three-tier fallback logic
   - Test environment variable handling
   - Test error classification

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_NANO_BANANA` | `true` | Enable CLI tier for image generation |
| `NANOBANANA_MODEL` | `gemini-3-pro-image-preview` | Model for CLI |
| `NANOBANANA_GEMINI_API_KEY` | (from GOOGLE_API_KEY) | API key for CLI |
| `GEMINI_CLI_PATH` | (auto-detect) | Custom path to gemini CLI |

---

## CLI Command Details

**Command**: `gemini "/generate PROMPT" --yolo -o json`

- `/generate` is the Nano Banana extension slash command
- `--yolo` auto-approves actions (non-interactive)
- `-o json` returns structured JSON output
- Images are saved to `./nanobanana-output/` directory
- Prompt should be escaped properly (quotes, newlines)

---

## Error Handling Matrix

| Error Type | Fallback to Next Tier? | Action |
|------------|------------------------|--------|
| `NanoBananaNotFoundError` | Yes | CLI not installed, try API |
| `NanoBananaAuthError` | Yes | CLI auth failed, try API |
| `NanoBananaTimeoutError` | Yes | CLI timeout, try API |
| `NanoBananaGenerationError` | Yes | CLI generation failed, try API |
| API 400 (Bad Request) | No | Return null, log warning |
| API 401/403 (Auth) | No | Return null, log warning |
| API 429 (Rate Limit) | Retry | Retry with backoff |
| API 5xx (Server) | Retry+Fallback | Retry, then try fallback model |

---

## Critical Files Summary

| File | Purpose |
|------|---------|
| `src/image/nanoBanana.ts` | Existing API impl, becomes Tier 2 |
| `src/llm/gemini-cli-wrapper.ts` | Reference for subprocess pattern |
| `src/llm/cli-detector.ts` | Reuse `detectCLI('gemini')` |
| `src/llm/fallback-router.ts` | Reference for router pattern |
| `src/llm/types.ts` | Reference for error class pattern |
| `redditnews/.../nano_banana_wrapper.py` | Source implementation |

---

## Verification Plan

1. **Unit Tests**: Run `npm test` to verify all tests pass
2. **CLI Detection**: Run with `VERBOSE=true` to see tier selection
3. **CLI Tier Test**: Set `USE_NANO_BANANA=true`, verify CLI is attempted first
4. **API Fallback Test**: Set `USE_NANO_BANANA=false`, verify API is used
5. **Manual Tier Test**: Remove API key, verify manual instructions logged
6. **Full Pipeline**: Run complete pipeline with prompt to verify image generation works

---

## Rollback Strategy

If issues arise:
1. Set `USE_NANO_BANANA=false` to disable CLI tier entirely
2. System falls back to existing API implementation (unchanged behavior)
