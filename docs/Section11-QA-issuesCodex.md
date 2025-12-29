# Section 11 QA Issues (Codex)

## 1) [Medium] Fallback image model is not implemented despite Section 11 notes

- Implementation Notes (TODO 11): "Fallback: `gemini-2.5-flash-image` (Nano Banana)".
- Current behavior:
  - The image module hard-codes only the primary model (`IMAGE_MODEL = 'gemini-3-pro-image-preview'`) and has no fallback path (`src/image/nanoBanana.ts:29` - `src/image/nanoBanana.ts:38`).
- Impact:
  - If the primary model is unavailable or access-restricted, image generation always fails instead of degrading gracefully, which conflicts with the implementation notes.
- Suggested fix:
  - Add a fallback attempt using the flash model when the primary request fails with 404/403/5xx, and include which model was used in logs/metadata.

## 2) [Low] Prompt resolution text diverges from the required format

- Requirement (TODO 11): prompt should include `Resolution: {config.imageResolution}` (2k/4k).
- Current behavior:
  - The prompt uses pixel dimensions (e.g., `1920x1080`, `3840x2160`) instead of `2k/4k` (`src/image/nanoBanana.ts:336` - `src/image/nanoBanana.ts:354`).
- Impact:
  - Minor spec divergence; may confuse the model or reviewers comparing output to the required template.
- Suggested fix:
  - Update the prompt line to `Resolution: 2k` / `4k` or include both (e.g., `Resolution: 2k (1920x1080)`).
