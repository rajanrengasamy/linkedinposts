# LinkedIn Post Generator - Project TODO v2

**Version**: 2.3
**Last Updated**: 2025-12-30
**PRD Reference**: `docs/PRD-v2.md`

---

## Phase 0: CLI Implementation

This TODO addresses all feedback from `prd-feedbackv1.md` and aligns with PRD v2.

---

## 1. Project Setup

### 1.1 Initialize Project
- [x] Create `package.json` with `npm init -y`
- [x] Configure `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "esModuleInterop": true,
      "outDir": "./dist",
      "rootDir": "./src"
    }
  }
  ```
- [x] Create `.gitignore`:
  ```
  node_modules/
  dist/
  output/
  .env
  *.log
  ```
- [x] Initialize git repository

### 1.2 Install Dependencies

**Production:**
- [x] `@google/generative-ai` - Gemini 3 Flash + Nano Banana Pro
- [x] `axios` - HTTP client for ScrapeCreators
- [x] `chalk` - Terminal styling
- [x] `commander` - CLI framework
- [x] `dotenv` - Environment variables
- [x] `openai` - GPT-5.2 SDK
- [x] `zod` - Schema validation (NEW)
- [x] `uuid` - Stable ID generation (NEW)

**Development:**
- [x] `@types/node`
- [x] `@types/uuid`
- [x] `typescript`
- [x] `tsx` - TypeScript execution
- [x] `vitest` - Testing framework (NEW)

### 1.3 Environment Configuration
- [x] Create `.env.example`:
  ```env
  # Required
  PERPLEXITY_API_KEY=
  GOOGLE_AI_API_KEY=
  OPENAI_API_KEY=

  # Optional (for social sources)
  SCRAPECREATORS_API_KEY=
  ```
- [x] Document which keys are required vs optional

### 1.4 Directory Structure
- [x] Create full directory structure:
  ```
  src/
  ├── index.ts
  ├── config.ts
  ├── schemas/
  │   ├── index.ts
  │   ├── rawItem.ts
  │   ├── validatedItem.ts
  │   ├── scoredItem.ts
  │   └── synthesisResult.ts
  ├── types/
  │   └── index.ts
  ├── collectors/
  │   ├── index.ts
  │   ├── web.ts
  │   ├── linkedin.ts
  │   └── twitter.ts
  ├── processing/
  │   ├── normalize.ts
  │   └── dedup.ts
  ├── validation/
  │   └── perplexity.ts
  ├── scoring/
  │   ├── gemini.ts
  │   └── fallback.ts
  ├── synthesis/
  │   ├── claims.ts
  │   └── gpt.ts
  ├── image/
  │   └── nanoBanana.ts
  └── utils/
      ├── logger.ts
      ├── fileWriter.ts
      ├── retry.ts
      └── cost.ts
  tests/
  ├── unit/
  ├── mocks/
  └── golden/
  ```

---

## 2. Schemas & Validation (NEW - Critical)

### 2.1 Create Zod Schemas

**File: `src/schemas/rawItem.ts`**
- [x] Define `RawItemSchema`:
  - [x] `id: z.string().uuid()`
  - [x] `schemaVersion: z.literal('1.0.0')`
  - [x] `source: z.enum(['web', 'linkedin', 'x'])`
  - [x] `sourceUrl: z.string().url()` (required!)
  - [x] `retrievedAt: z.string().datetime()`
  - [x] `content: z.string().min(1)`
  - [x] `contentHash: z.string()`
  - [x] `title: z.string().optional()`
  - [x] `author: z.string().optional()`
  - [x] `authorHandle: z.string().optional()`
  - [x] `authorUrl: z.string().url().optional()`
  - [x] `publishedAt: z.string().datetime().optional()`
  - [x] `engagement` object with platform-specific fields
  - [x] `citations: z.array(z.string().url()).optional()`
- [x] Export type: `type RawItem = z.infer<typeof RawItemSchema>`

**File: `src/schemas/validatedItem.ts`**
- [x] Define `VerificationLevelSchema`:
  ```typescript
  z.enum([
    'UNVERIFIED',
    'SOURCE_CONFIRMED',
    'MULTISOURCE_CONFIRMED',
    'PRIMARY_SOURCE'
  ])
  ```
- [x] Define `ValidationSchema`:
  - [x] `level: VerificationLevelSchema`
  - [x] `confidence: z.number().min(0).max(1)`
  - [x] `checkedAt: z.string().datetime()`
  - [x] `sourcesFound: z.array(z.string().url())`
  - [x] `notes: z.array(z.string())` (brief bullets, not CoT)
  - [x] `quotesVerified: z.array(...)` with quote, verified, sourceUrl
- [x] Define `ValidatedItemSchema` extending RawItem

**File: `src/schemas/scoredItem.ts`**
- [x] Define `ScoresSchema`:
  - [x] `relevance: z.number().min(0).max(100)`
  - [x] `authenticity: z.number().min(0).max(100)`
  - [x] `recency: z.number().min(0).max(100)`
  - [x] `engagementPotential: z.number().min(0).max(100)`
  - [x] `overall: z.number().min(0).max(100)`
- [x] Define `ScoredItemSchema` extending ValidatedItem

**File: `src/schemas/synthesisResult.ts`**
- [x] Define `KeyQuoteSchema`:
  - [x] `quote: z.string()`
  - [x] `author: z.string()`
  - [x] `sourceUrl: z.string().url()` (required!)
  - [x] `verificationLevel: VerificationLevelSchema`
- [x] Define `InfographicBriefSchema`
- [x] Define `FactCheckSummarySchema`:
  - [x] `totalSourcesUsed: z.number()`
  - [x] `verifiedQuotes: z.number()`
  - [x] `unverifiedClaims: z.number()`
  - [x] `primarySources: z.number()`
  - [x] `warnings: z.array(z.string())`
- [x] Define `SynthesisResultSchema`

**File: `src/schemas/sourceReference.ts`**
- [x] Define `SourceReferenceSchema`:
  - [x] `id: z.string()` (references RawItem.id)
  - [x] `url: z.string().url()`
  - [x] `title: z.string()`
  - [x] `verificationLevel: VerificationLevelSchema`
  - [x] `usedInPost: z.boolean()`

### 2.2 Schema Validation Helpers

**File: `src/schemas/index.ts`**
- [x] Export all schemas
- [x] Create `validateOrThrow<T>(schema, data)` helper
- [x] Create `tryValidate<T>(schema, data)` helper (returns Result type)
- [x] Create `parseModelResponse(text)` helper:
  - [x] Strip markdown code fences
  - [x] Handle trailing text after JSON
  - [x] Return parsed object or throw

### 2.3 Retry with Fix-JSON Prompt
- [x] Create `retryWithFixPrompt(model, originalPrompt, badResponse)`:
  - [x] Send "Fix this JSON: {badResponse}" prompt
  - [x] Re-validate
  - [x] Return fixed response or throw

---

## 3. Type Definitions

**File: `src/types/index.ts`**
- [x] Export all inferred Zod types
- [x] Define `PipelineConfig` interface:
  ```typescript
  interface PipelineConfig {
    sources: ('web' | 'linkedin' | 'x')[];
    skipValidation: boolean;
    skipScoring: boolean;
    skipImage: boolean;
    qualityProfile: 'fast' | 'default' | 'thorough';
    maxPerSource: number;
    maxTotal: number;
    validationBatchSize: number;
    scoringBatchSize: number;
    timeoutSeconds: number;
    imageResolution: '2k' | '4k';
    outputDir: string;
    saveRaw: boolean;
    verbose: boolean;
    dryRun: boolean;
  }
  ```
- [x] Define `PipelineResult` interface
- [x] Define `StageResult<T>` interface with success/failure

---

## 4. Configuration

**File: `src/config.ts`**
- [x] Load environment variables with dotenv
- [x] Validate required API keys based on sources:
  - [x] PERPLEXITY_API_KEY (always required)
  - [x] GOOGLE_AI_API_KEY (always required)
  - [x] OPENAI_API_KEY (always required)
  - [x] SCRAPECREATORS_API_KEY (required only if linkedin/x sources)
- [x] Fail fast with clear error messages if keys missing
- [x] **Never log API keys** (sanitize all output)
- [x] Export quality profile defaults:
  ```typescript
  const QUALITY_PROFILES = {
    fast: { maxTotal: 30, skipValidation: true, skipScoring: true, skipImage: true },
    default: { maxTotal: 75, skipValidation: false, skipScoring: false, skipImage: false },
    thorough: { maxTotal: 150, skipValidation: false, skipScoring: false, skipImage: false }
  };
  ```
- [x] Define concurrency limits per API
- [x] Define stage timeouts
- [x] **QA Fix**: Implement `withTimeout()` utility for stage timeout enforcement (Issue #1 from Section4n5-QA)

---

## 5. Utility Functions

### 5.1 Logger (with Secrets Sanitization)

**File: `src/utils/logger.ts`**
- [x] Create `sanitize(text)` to remove API keys from output
- [x] `logStage(name)` - Stage header with timestamp
- [x] `logProgress(current, total, message)` - Progress indicator
- [x] `logSuccess(message)` - Green success
- [x] `logWarning(message)` - Yellow warning
- [x] `logError(message)` - Red error
- [x] `logCost(estimates)` - Format cost breakdown
- [x] `logVerbose(message)` - Only if --verbose flag
- [x] All functions call `sanitize()` before output
- [x] **QA Fix**: Guard `logProgress()` against divide-by-zero when total=0 (Issue #2 from Section4n5-QA)

### 5.2 File Writer (with Provenance)

**File: `src/utils/fileWriter.ts`**
- [x] `ensureOutputDir(basePath)` - Create timestamped output directory
- [x] `writeJSON<T>(path, data, schema?)` - Write with optional validation
- [x] `writeMarkdown(path, content)` - Write markdown file
- [x] `writePNG(path, buffer)` - Write binary image
- [x] `writeSourcesJson(sources: SourceReference[])` - Provenance file
- [x] `writeSourcesMd(sources: SourceReference[])` - Human-readable sources
- [x] `writePipelineStatus(status)` - Run metadata and errors
- [x] **QA Fix**: Use `SCHEMA_VERSION` constant instead of hardcoded '1.0.0' (Issue #3 from Section4n5-QA)
- [x] **QA Fix**: Create `PipelineStatusSchema` and validate in `writePipelineStatus()` (Issue #4 from Section4n5-QA)

### 5.3 Retry with Exponential Backoff

**File: `src/utils/retry.ts`**
- [x] `withRetry<T>(fn, options)`:
  ```typescript
  interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryOn?: (error: Error) => boolean;
  }
  ```
- [x] Handle rate limit errors specifically (429)
- [x] Log retry attempts if verbose
- [x] Return last error if all retries fail
- [x] **QA Fix**: Implement `withTimeout()`, `withTimeoutResult()`, `withRetryAndTimeout()` for stage timeout enforcement
- [x] **QA Fix**: Add `TimeoutError` class for timeout failures

### 5.4 Cost Estimator (NEW)

**File: `src/utils/cost.ts`**
- [x] Define cost per token/image for each API:
  ```typescript
  const COSTS = {
    perplexity: { inputPerMillion: 3, outputPerMillion: 15 },
    gemini: { inputPerMillion: 0.50, outputPerMillion: 3.00 },
    openai: { inputPerMillion: 10, outputPerMillion: 30 },
    nanoBanana: { '2k': 0.139, '4k': 0.24 }
  };
  ```
- [x] `estimateCost(config: PipelineConfig)` - Pre-run estimate
- [x] `calculateActualCost(usage)` - Post-run actual cost
- [x] Return breakdown by service + total

---

## 6. Content Processing (NEW)

### 6.1 Normalization

**File: `src/processing/normalize.ts`**
- [x] `normalizeContent(content: string)`:
  - [x] Convert to lowercase
  - [x] Remove URLs
  - [x] Remove emoji
  - [x] Remove punctuation
  - [x] Collapse whitespace
  - [x] Trim
- [x] `generateContentHash(content: string)`:
  - [x] Call normalizeContent
  - [x] SHA-256 hash
  - [x] Return first 16 characters
- [x] `normalizeTimestamp(date: string | Date)`:
  - [x] Convert to ISO 8601
  - [x] Handle various input formats
- [x] **QA Fix**: Disambiguate YYYYMMDD from Unix timestamps by string length (Issue #3 from Section6-QA)
- [x] `normalizeUrl(url: string)`:
  - [x] Remove tracking parameters
  - [x] Ensure https
  - [x] Normalize trailing slashes

### 6.2 Deduplication

**File: `src/processing/dedup.ts`**
- [x] `deduplicateByHash(items: RawItem[])`:
  - [x] Group by contentHash
  - [x] Keep first occurrence (by retrievedAt)
  - [x] Return deduplicated array
- [x] `jaccardSimilarity(a: string, b: string)`:
  - [x] Tokenize normalized strings
  - [x] Calculate Jaccard index
- [x] `deduplicateBySimilarity(items: RawItem[], threshold = 0.85)`:
  - [x] For each pair, check similarity
  - [x] Mark duplicates for removal
  - [x] Return deduplicated array
- [x] `deduplicate(items: RawItem[])`:
  - [x] First pass: hash dedup
  - [x] Second pass: similarity dedup (if still > threshold)
  - [x] Log duplicates removed

### 6.3 Timestamp Parsing Hardening (QA Follow-up)

**File: `src/processing/normalize.ts`**
- [x] **QA Fix**: Strict YYYYMMDD calendar validation (reject rollover dates like Feb 30)
  - [x] Parse 8-digit numeric strings into year/month/day integers
  - [x] Reject months outside 01-12
  - [x] Reject days outside 01-31
  - [x] Verify constructed date matches input components (catches JS Date rollover)
- [x] **QA Fix**: Reject ambiguous numeric timestamp lengths (non 8/10/13 digits)
  - [x] Accept only: 8 (YYYYMMDD), 10 (Unix seconds), 13 (Unix milliseconds)
  - [x] Throw a clear error for unsupported numeric lengths to prevent silent misparsing
- [x] **QA Fix**: Add unit tests in `tests/unit/normalize.test.ts`
  - [x] `normalizeTimestamp('20240230')` throws (no rollover)
  - [x] `normalizeTimestamp('946684800000')` (12 digits) throws (unsupported numeric length)
  - [x] Ensure 10-digit seconds and 13-digit milliseconds still parse correctly

---

## 7. Data Collectors

### 7.1 Web Collector (Perplexity) - Required

**File: `src/collectors/web.ts`**

**Known Limitation**: Web items do not include `publishedAt` timestamps due to Perplexity API limitations.

- [x] Implement `searchWeb(query: string, config: PipelineConfig)`:
  - [x] Build Perplexity API request:
    ```typescript
    {
      model: "sonar-reasoning-pro",
      messages: [{ role: "user", content: buildSearchPrompt(query) }]
    }
    ```
  - [x] Parse response extracting:
    - [x] Main content
    - [x] Citations (URLs)
    - [x] Source titles
  - [x] Generate stable UUIDs for each item
  - [x] Set `retrievedAt` timestamp
  - [x] Calculate contentHash
  - [x] Validate against RawItemSchema
  - [x] Return `RawItem[]`
- [x] `buildSearchPrompt(query)`:
  - [x] Derive 3-5 sub-queries from main prompt
  - [x] Request structured output with citations
- [x] Error handling: **FATAL** if web collector fails (required source)
- [x] Respect concurrency limit (3)

### 7.2 LinkedIn Collector (Optional, Gated)

**File: `src/collectors/linkedin.ts`**

**Known Limitation**: LinkedIn collection uses a curated list of profiles rather than dynamic query search. The query parameter is currently ignored.

- [x] Check if 'linkedin' in config.sources, skip if not
- [x] Validate SCRAPECREATORS_API_KEY exists
- [x] Research ScrapeCreators LinkedIn endpoints:
  - [x] `/v1/linkedin/profile` - Get profile with posts
  - [x] `/v1/linkedin/post` - Get single post by URL
- [x] Implement `searchLinkedIn(query, config)`:
  - [x] Build API request with x-api-key header
  - [x] Parse response to RawItem[]:
    - [x] Map engagement (reactions → likes, comments, shares)
    - [x] Extract author info
    - [x] Generate contentHash
  - [x] Validate against RawItemSchema
  - [x] Return items or empty array on failure (non-fatal)
- [x] Log compliance warning on first use
- [x] Respect concurrency limit (5)

### 7.3 Twitter Collector (Optional, Gated)

**File: `src/collectors/twitter.ts`**
- [x] Check if 'x' in config.sources, skip if not
- [x] Validate SCRAPECREATORS_API_KEY exists
- [x] Research ScrapeCreators Twitter endpoints:
  - [x] `/v1/twitter/search` - Search tweets
  - [x] `/v1/twitter/user/tweets` - User tweets
- [x] Implement `searchTwitter(query, config)`:
  - [x] Build API request with x-api-key header
  - [x] Parse response to RawItem[]:
    - [x] Map X-specific engagement:
      - [x] likes
      - [x] retweets
      - [x] quotes
      - [x] replies
      - [x] impressions (if available)
    - [x] Extract author handle
    - [x] Generate contentHash
  - [x] Validate against RawItemSchema
  - [x] Return items or empty array on failure (non-fatal)
- [x] Log compliance warning on first use
- [x] Respect concurrency limit (5)

### 7.4 Collector Orchestrator

**File: `src/collectors/index.ts`**
- [x] Implement `collectAll(query, config)`:
  - [x] Determine which collectors to run based on config.sources
  - [x] Run collectors in parallel with `Promise.allSettled`
  - [x] Handle partial failures:
    - [x] Web fails → FATAL, throw error
    - [x] LinkedIn/Twitter fails → log warning, continue
  - [x] Merge results with source tagging
  - [x] Apply maxPerSource limit before merge
  - [x] Deduplicate merged results
  - [x] Apply maxTotal limit
  - [x] Return `RawItem[]` and collection metadata
- [x] Return `CollectionResult`:
  ```typescript
  interface CollectionResult {
    items: RawItem[];
    metadata: {
      webCount: number;
      linkedinCount: number;
      xCount: number;
      duplicatesRemoved: number;
      errors: string[];
    };
  }
  ```

---

## 8. Validation Engine

**File: `src/validation/perplexity.ts`**

### 8.1 Core Validation
- [x] Implement `validateItems(items: RawItem[], config)`:
  - [x] If config.skipValidation, return items as UNVERIFIED ValidatedItems
  - [x] Cap items for validation (only top N by engagement/recency)
  - [x] Batch items (config.validationBatchSize)
  - [x] For each batch, call Perplexity to verify:
    - [x] Quote authenticity
    - [x] Author attribution
    - [x] Publication date
  - [x] Assign verification level per item
  - [x] Validate against ValidatedItemSchema
  - [x] Return `ValidatedItem[]`

### 8.2 Verification Level Assignment
- [x] Implement `assignVerificationLevel(verificationResult)`:
  ```typescript
  if (foundInPrimarySource) return 'PRIMARY_SOURCE';
  if (sourcesFound.length >= 2) return 'MULTISOURCE_CONFIRMED';
  if (sourcesFound.length === 1) return 'SOURCE_CONFIRMED';
  return 'UNVERIFIED';
  ```

### 8.3 Failure Handling
- [x] If Perplexity times out:
  - [x] Mark all items as UNVERIFIED
  - [x] Set confidence to 0
  - [x] Log warning
  - [x] Continue pipeline
- [x] If parse error:
  - [x] Retry once with fix-JSON prompt
  - [x] If still fails, mark UNVERIFIED

### 8.4 Concurrency & Batching
- [x] Respect concurrency limit (3 concurrent Perplexity requests)
- [x] Process batches sequentially to manage rate limits
- [x] Log progress: "Validating batch 1/5..."

---

## 9. Scoring Engine

### 9.1 Gemini Scoring

**File: `src/scoring/gemini.ts`**
- [x] Implement `scoreItems(items: ValidatedItem[], prompt, config)`:
  - [x] If config.skipScoring, use fallback scoring
  - [x] Batch items (config.scoringBatchSize)
  - [x] Build Gemini prompt requesting JSON output:
    ```
    Score each item 0-100 on:
    - relevance: How relevant to "{prompt}"
    - authenticity: Based on verification level
    - recency: How recent (items have publishedAt)
    - engagementPotential: Likely to engage audience

    Return JSON array with id, scores, and brief reasoning.
    ```
  - [x] Parse and validate response against ScoresSchema
  - [x] Calculate weighted overall:
    ```typescript
    overall = (relevance * 0.35) + (authenticity * 0.30) +
              (recency * 0.20) + (engagementPotential * 0.15)
    ```
  - [x] Sort by overall descending
  - [x] Assign rank
  - [x] Return top N as `ScoredItem[]`

### 9.2 Authenticity Score Boost
- [x] Apply verification level boost to base authenticity:
  ```typescript
  const boost = {
    'UNVERIFIED': 0,
    'SOURCE_CONFIRMED': 25,
    'MULTISOURCE_CONFIRMED': 50,
    'PRIMARY_SOURCE': 75
  };
  authenticity = Math.min(100, baseAuthenticity + boost[level]);
  ```

### 9.3 Fallback Scoring

**File: `src/scoring/fallback.ts`**
- [x] Implement `fallbackScore(items: ValidatedItem[])`:
  - [x] Use heuristic:
    ```typescript
    overall = (recencyScore * 0.5) + (engagementScore * 0.5);
    ```
  - [x] recencyScore: Based on publishedAt (newer = higher)
  - [x] engagementScore: Normalize engagement metrics
  - [x] Sort and rank
  - [x] Return `ScoredItem[]`
- [x] Use when Gemini fails or --skip-scoring

### 9.4 Failure Handling
- [x] If Gemini error: Use fallback scoring
- [x] If parse error:
  - [x] Retry once with fix-JSON prompt
  - [x] If still fails, use fallback

### 9.5 QA Hardening (Section9-QA-issuesCodex.md)

**CRITICAL Issues (6 Fixed):**
- [x] **CRIT-1**: Implement timeout enforcement with Promise.race pattern in `makeGeminiRequest()`
- [x] **CRIT-2**: Add Gemini response ID validation - throws error when response missing input IDs
- [x] **CRIT-3**: Add top-N truncation - returns `config.topScored` items (default 50)
- [x] **CRIT-4**: Document fallback authenticity baseline (intentionally conservative at 25)
- [x] **CRIT-5**: Create barrel export `src/scoring/index.ts`
- [x] **CRIT-6**: Sanitize full error objects with `createSanitizedError()` (not just message)

**MAJOR Issues (10 Fixed):**
- [x] **MAJ-1**: Document SCORING_WEIGHTS behavior (fixed by design, documented)
- [x] **MAJ-2**: Throw error when fallback returns empty array with non-empty input
- [x] **MAJ-3**: Clamp negative engagement values to 0 in `calculateEngagementScore()`
- [x] **MAJ-4**: Validate date parsing in `calculateRecencyScore()` - return 50 for invalid dates
- [x] **MAJ-5**: Re-validate after rank mutation with `ScoredItemSchema.parse()`
- [x] **MAJ-6**: Extract sanitization logic to `src/utils/sanitization.ts`
- [x] **MAJ-7**: Extract error sanitization to shared utils
- [x] **MAJ-9**: Add structured delimiters `<<<USER_PROMPT_START>>>` for prompt injection defense
- [x] **MAJ-10**: Add pre-build prompt length estimation to fail fast

**Architecture Improvements:**
- [x] Created `src/scoring/index.ts` barrel export
- [x] Created `src/utils/sanitization.ts` with shared INJECTION_PATTERNS and SENSITIVE_PATTERNS
- [x] Created `src/utils/index.ts` for utility exports
- [x] Added `topScored?: number` to PipelineConfig (default: 50)

---

## 10. Synthesis Engine

### 10.1 Claim Extraction (NEW - Critical)

**File: `src/synthesis/claims.ts`**
- [x] Implement `extractGroundedClaims(items: ScoredItem[])`:
  - [x] Filter: only items with verification >= SOURCE_CONFIRMED
  - [x] Identify quotable statements
  - [x] Extract statistics and data points
  - [x] Ensure each claim has sourceUrl
  - [x] Return `GroundedClaim[]`:
    ```typescript
    interface GroundedClaim {
      claim: string;
      type: 'quote' | 'statistic' | 'insight';
      author?: string;
      sourceUrl: string;
      verificationLevel: VerificationLevel;
      sourceItemId: string;
    }
    ```
- [x] **Rule**: No claim without sourceUrl

### 10.2 Post Generation

**File: `src/synthesis/gpt.ts`**
- [x] Implement `synthesize(claims: GroundedClaim[], prompt, config)`:
  - [x] Build GPT-5.2 Thinking prompt:
    ```
    Create a LinkedIn post about "{prompt}".

    USE ONLY these verified claims (do not invent any):
    {claims as JSON}

    Requirements:
    - Max 3000 characters
    - Engaging hook in first line
    - 2-3 key insights with quotes (use exact quotes provided)
    - Include source URLs for each quote
    - Call to action at end
    - 3-5 relevant hashtags
    - Professional but approachable tone

    Also generate:
    1. infographicBrief: title, keyPoints, suggestedStyle, colorScheme
    2. factCheckSummary: counts of verified/unverified items, warnings
    ```
  - [x] Parse response
  - [x] Validate against SynthesisResultSchema
  - [x] **Verify**: No quote in post without sourceUrl in claims
  - [x] Return `SynthesisResult`
- [x] Implement `buildSynthesisPrompt(claims, userPrompt)` with structured delimiters
- [x] Implement `parseSynthesisResponse(response)` with schema validation
- [x] Implement `buildSourceReferences(items, synthesis)` for provenance tracking
- [x] Create barrel export `src/synthesis/index.ts`

### 10.3 Output Constraints
- [x] Enforce max 3000 characters for linkedinPost
- [x] Require 3-5 hashtags (warning only, not fatal)
- [x] Verify all quotes have sourceUrl (FATAL if missing)

### 10.4 Failure Handling
- [x] If GPT error: **FATAL** (cannot complete without synthesis)
- [x] If parse error:
  - [x] Retry once with fix-JSON prompt
  - [x] If still fails, throw FATAL error

---

## 11. Image Generation

**File: `src/image/nanoBanana.ts`**
- [x] Implement `generateInfographic(brief: InfographicBrief, config)`:
  - [x] If config.skipImage, return null immediately
  - [x] Convert brief to image prompt:
    ```
    Create a professional infographic:
    Title: {title}
    Key points: {keyPoints as bullets}
    Style: {suggestedStyle}
    Colors: {colorScheme}

    Requirements:
    - Clean, modern design
    - Legible text (double-check spelling)
    - Data visualization where appropriate
    - Professional quality
    - Resolution: {config.imageResolution}
    ```
  - [x] Make Nano Banana Pro API request
  - [x] Return image buffer
- [x] Error handling:
  - [x] Log warning on failure
  - [x] Return null (non-blocking)
  - [x] Pipeline continues without image

**Implementation Notes (December 2025):**
- Model: `gemini-3-pro-image-preview` (Nano Banana Pro / Gemini 3 Pro Image)
- Fallback: `gemini-2.5-flash-image` (Nano Banana)
- Resolution: Use `imageConfig: { imageSize: "2K" | "4K" }` (uppercase required)
- Pricing: ~$0.134 (2K), ~$0.24 (4K)
- SDK: `@google/genai` with `responseModalities: ['image', 'text']`
- Docs: https://ai.google.dev/gemini-api/docs/image-generation

---

## 12. CLI Entry Point

**File: `src/index.ts`**

### 12.1 Commander Setup
- [x] Configure CLI with all options:
  ```typescript
  program
    .name('linkedin-post-generator')
    .description('Generate LinkedIn posts from web sources')
    .argument('<prompt>', 'Topic for the post')
    // Source Control
    .option('--sources <list>', 'Sources: web,linkedin,x', 'web')
    // Stage Control
    .option('--skip-validation', 'Skip verification stage')
    .option('--skip-scoring', 'Skip Gemini scoring')
    .option('--skip-image', 'Skip infographic generation')
    // Quality Profiles
    .option('--fast', 'Fast mode (minimal processing)')
    .option('--quality <level>', 'Quality: fast|default|thorough', 'default')
    // Limits
    .option('--max-per-source <n>', 'Max items per source', '25')
    .option('--max-total <n>', 'Max total items', '75')
    .option('--max-results <n>', 'Alias for --max-total')
    // Output
    .option('--output-dir <path>', 'Output directory', './output')
    .option('--save-raw', 'Save raw API responses')
    .option('--image-resolution <res>', '2k or 4k', '2k')
    // Performance
    .option('--timeout <seconds>', 'Pipeline timeout', '180')
    .option('--print-cost-estimate', 'Print cost estimate and exit')
    // Debug
    .option('--verbose', 'Detailed progress')
    .option('--dry-run', 'Validate config and exit')
  ```

### 12.2 Config Parsing
- [x] Parse options into PipelineConfig
- [x] Apply quality profile overrides
- [x] Validate source flags
- [x] Handle --fast as shortcut for profile

### 12.3 Pre-flight Checks
- [x] Validate API keys for requested sources
- [x] If --print-cost-estimate:
  - [x] Print estimate and exit
- [x] If --dry-run:
  - [x] Validate config, print summary, exit

### 12.4 Main Pipeline
- [x] Implement `runPipeline(prompt, config)`:
  ```typescript
  async function runPipeline(prompt: string, config: PipelineConfig) {
    const outputDir = ensureOutputDir(config.outputDir);
    const startTime = Date.now();

    try {
      // Stage 1: Collect
      logStage('Data Collection');
      const collection = await collectAll(prompt, config);
      if (config.saveRaw) {
        writeJSON(join(outputDir, 'raw_data.json'), collection.items);
      }

      // Stage 2: Validate
      logStage('Validation');
      const validatedItems = await validateItems(collection.items, config);
      writeJSON(join(outputDir, 'validated_data.json'), validatedItems);

      // Stage 3: Score
      logStage('Scoring');
      const scoredItems = await scoreItems(validatedItems, prompt, config);
      writeJSON(join(outputDir, 'scored_data.json'), scoredItems);
      writeJSON(join(outputDir, 'top_50.json'), scoredItems.slice(0, 50));

      // Stage 4: Extract & Synthesize
      logStage('Synthesis');
      const claims = extractGroundedClaims(scoredItems.slice(0, 50));
      const synthesis = await synthesize(claims, prompt, config);
      writeJSON(join(outputDir, 'synthesis.json'), synthesis);
      writeMarkdown(join(outputDir, 'linkedin_post.md'), synthesis.linkedinPost);

      // Stage 5: Generate Image
      if (!config.skipImage) {
        logStage('Image Generation');
        const image = await generateInfographic(synthesis.infographicBrief, config);
        if (image) {
          writePNG(join(outputDir, 'infographic.png'), image);
        }
      }

      // Write Provenance
      const sources = buildSourceReferences(scoredItems, synthesis);
      writeSourcesJson(join(outputDir, 'sources.json'), sources);
      writeSourcesMd(join(outputDir, 'sources.md'), sources);

      // Write Status
      const duration = Date.now() - startTime;
      writePipelineStatus(join(outputDir, 'pipeline_status.json'), {
        success: true,
        duration,
        costs: synthesis.metadata.estimatedCost
      });

      logSuccess(`Done in ${duration}ms! Output: ${outputDir}`);
    } catch (error) {
      writePipelineStatus(join(outputDir, 'pipeline_status.json'), {
        success: false,
        error: error.message,
        stage: getCurrentStage()
      });
      throw error;
    }
  }
  ```

### 12.5 Error Wrapper
- [x] Catch all errors
- [x] Write partial outputs if available
- [x] Write pipeline_status.json with error details
- [x] Exit with code 1 on failure (or code 2 for config errors)

### 12.6 Barrel Export and Entry Point
- [x] Create `src/cli/index.ts` barrel export
- [x] Update `src/index.ts` main entry point
- [x] Create CLI unit tests in `tests/unit/cli.test.ts`

---

## 13. Testing (NEW - Critical)

### 13.1 Unit Tests

**Directory: `tests/unit/`**

- [x] `normalize.test.ts`:
  - [x] Test normalizeContent with various inputs
  - [x] Test contentHash stability
  - [x] Test URL normalization
  - [x] Test timestamp normalization

- [x] `dedup.test.ts`:
  - [x] Test hash-based deduplication
  - [x] Test Jaccard similarity calculation
  - [x] Test similarity-based deduplication
  - [x] Test edge cases (empty content, identical content)

- [x] `schemas.test.ts`:
  - [x] Test RawItem validation
  - [x] Test ValidatedItem validation
  - [x] Test ScoredItem validation
  - [x] Test rejection of invalid data
  - [x] Test parseModelResponse edge cases

- [x] `cost.test.ts`:
  - [x] Test cost estimation accuracy
  - [x] Test different quality profiles

- [x] `scoring.test.ts`:
  - [x] Test weighted score calculation
  - [x] Test verification level boost
  - [x] Test fallback scoring

### 13.2 Mocked API Tests

**Directory: `tests/mocks/`**

- [x] Create API response fixtures:
  - [x] `perplexity_search_response.json`
  - [x] `perplexity_validation_response.json`
  - [ ] `scrapecreators_linkedin_response.json`
  - [ ] `scrapecreators_twitter_response.json`
  - [x] `gemini_scoring_response.json`
  - [x] `gpt_synthesis_response.json`

**Directory: `tests/integration/`**

- [ ] `collectors.test.ts`:
  - [ ] Test web collector with mocked Perplexity
  - [ ] Test LinkedIn collector with mocked ScrapeCreators
  - [ ] Test Twitter collector with mocked ScrapeCreators
  - [ ] Test collector orchestrator with partial failures

- [x] `validation.test.ts`:
  - [x] Test verification level assignment (assignVerificationLevel)
  - [x] Test createUnverifiedValidation helper
  - [x] Test extractContent and extractCitations
  - [x] Test mock fixtures for all verification scenarios
  - [x] Test VERIFICATION_BOOSTS constants
  - [ ] Test validateItems with mocked Perplexity (todo - awaiting Section 8 impl)
  - [ ] Test timeout handling (todo - awaiting Section 8 impl)

- [x] `scoring.test.ts`:
  - [x] Test scoring with mocked Gemini
  - [x] Test fallback scoring on error

- [x] `synthesis.test.ts`:
  - [x] Test claim extraction
  - [x] Test synthesis with mocked GPT

### 13.3 Golden Tests

**Directory: `tests/golden/`**

- [x] Create golden test cases:
  - [x] Input prompt -> expected output structure
  - [x] Validate JSON schema compliance
  - [x] Check required fields present

- [x] `golden.test.ts`:
  - [x] Run pipeline with mocked APIs
  - [x] Compare output structure to golden files
  - [x] Fail on unexpected schema changes

### 13.4 Evaluation Harness (NEW)

**File: `tests/evaluate.ts`**
- [x] Create evaluation script:
  ```typescript
  async function evaluate(outputDir: string) {
    const checks = [
      checkNoQuotesWithoutSources,
      checkPostLengthConstraints,
      checkAllFilesWritten,
      checkSourcesJsonValid,
      checkIdReferences,
      checkVerificationLevels
    ];

    const results = await Promise.all(checks.map(c => c(outputDir)));
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed);

    console.log(`Passed: ${passed}/${checks.length}`);
    if (failed.length > 0) {
      console.log('Failed checks:', failed);
      process.exit(1);
    }
  }
  ```
- [x] `checkNoQuotesWithoutSources`: Every quote in linkedin_post.md has URL
- [x] `checkPostLengthConstraints`: Under 3000 characters
- [x] `checkAllFilesWritten`: All expected files exist
- [x] `checkSourcesJsonValid`: Valid against SourceReferenceSchema
- [x] `checkIdReferences`: top_50.json IDs exist in validated_data.json
- [x] `checkVerificationLevels`: Levels correctly assigned

**File: `tests/unit/evaluate.test.ts`**
- [x] Unit tests for all evaluation functions (40 tests)

---

## 14. Documentation

### 14.1 README.md
- [ ] Project description
- [ ] Installation instructions
- [ ] API key setup (which are required vs optional)
- [ ] Quick start examples
- [ ] CLI options reference
- [ ] Output file descriptions
- [ ] Compliance disclaimer for social sources
- [ ] Troubleshooting common errors

### 14.2 Code Comments
- [ ] Document complex logic (dedup, scoring, claim extraction)
- [ ] Document failure modes in each module
- [ ] Document schema field meanings

### 14.3 HowTo.md Maintenance
- [x] Create `docs/HowTo.md` with all CLI permutations
- [ ] Update HowTo.md when new CLI options are added
- [x] Update HowTo.md when Section 17 (Multi-Post) is implemented

---

## 15. Final Checks

### 15.1 Definition of Done Checklist
- [ ] CLI runs end-to-end with `--sources web`
- [ ] Output includes linkedin_post.md and sources.json
- [ ] No quote in post without source URL
- [ ] LinkedIn/X sources gated behind --sources flag
- [ ] Compliance warning logged when using social sources
- [ ] All model outputs validated against Zod schemas
- [ ] Graceful degradation on partial failures
- [ ] Cost estimate available via --print-cost-estimate
- [ ] Test suite passes with mocked APIs
- [ ] README complete with setup instructions

### 15.2 Security Audit
- [ ] API keys never logged
- [ ] No PII in logs beyond what's in source content
- [ ] Raw data requires explicit --save-raw flag

### 15.3 Performance Check
- [ ] Pipeline completes in < 2 minutes (default profile)
- [ ] Fast profile completes in < 30 seconds
- [ ] No memory leaks on large datasets

---

## 16. Phase 1 Enhancements

### 16.1 Smart Prompt Breakdown for Multi-Source Search

**Problem**: Long prompts work well for web search but may be too verbose for social media search APIs.

**Solution**:
- [x] When a long prompt is provided (> threshold characters):
  - [x] Send the full long prompt to web search (Perplexity)
  - [x] Use LLM to break down the prompt into shorter, social-media-optimized search queries
  - [x] Send the broken-down queries to LinkedIn and Twitter collectors
- [x] Implement `src/prompts/breakdown.ts`:
  - [x] `isLongPrompt(prompt: string, threshold?: number)` - Check if prompt exceeds threshold
  - [x] `breakdownForSocialSearch(prompt: string)` - Use LLM to generate 3-5 shorter search terms
  - [x] Return both original and broken-down versions
- [x] Update collector orchestrator to use appropriate prompt version per source

### 16.2 Alternative Scoring Model: OpenRouter KIMI 2

**Problem**: Want to optionally use OpenRouter's KIMI 2 thinking model instead of Gemini 3 for scoring.

**Solution**:
- [x] Add CLI argument for scoring model selection:
  ```typescript
  .option('--scoring-model <model>', 'Scoring model: gemini|kimi2', 'gemini')
  ```
- [x] Add `OPENROUTER_API_KEY` to environment configuration
- [x] Implement `src/scoring/openrouter.ts`:
  - [x] `scoreItemsWithKimi2(items: ValidatedItem[], prompt, config)`
  - [x] Use OpenRouter API to call KIMI 2 thinking model
  - [x] Match same output format as Gemini scoring
- [x] Update `src/scoring/index.ts`:
  - [x] Route to appropriate scorer based on `--scoring-model` flag
- [x] Update `src/config.ts`:
  - [x] Add `scoringModel` to PipelineConfig
  - [x] Validate OPENROUTER_API_KEY when kimi2 is selected
- [x] Update cost estimation for KIMI 2 pricing
  - [x] Added TOKEN_COSTS.kimi2 with OpenRouter pricing ($0.456/M input, $1.84/M output)
  - [x] Updated estimateScoringCost to route based on config.scoringModel
  - [x] Updated TokenUsage interface with kimi2 field
  - [x] Updated calculateActualCost to handle kimi2 usage
  - [x] Added CostTracker.addKimi2() method
  - [x] Added comprehensive tests for KIMI 2 cost estimation

---

## 17. Multi-Post Generation

Generate multiple LinkedIn posts from a single pipeline run via `--post-count` and `--post-style` options.

### 17.1 Type Definitions

**File: `src/types/index.ts`**
- [x] Add `PostStyle` type: `'series' | 'variations'`
- [x] Update `PipelineConfig` interface:
  - [x] `postCount: number` (default: 1)
  - [x] `postStyle: PostStyle` (default: 'variations')
- [x] Update `DEFAULT_CONFIG` with new defaults

### 17.2 CLI Options

**File: `src/cli/program.ts`**
- [x] Add `--post-count <n>` option (1-3, default: 1)
- [x] Add `--post-style <style>` option (series|variations, default: variations)

**File: `src/cli/program.ts` (CommanderOptions)**
- [x] Add `postCount?: string` to CommanderOptions interface
- [x] Add `postStyle?: string` to CommanderOptions interface
- [x] Update `isValidCommanderOptions()` validation

### 17.3 Config Parsing

**File: `src/config.ts`**
- [x] Add `parsePostCount(countStr: string): number`:
  - [x] Validate 1-3 range
  - [x] Log warning on invalid, return 1
- [x] Add `parsePostStyle(styleStr: string): PostStyle`:
  - [x] Validate 'series' | 'variations'
  - [x] Log warning on invalid, return 'variations'
- [x] Update `CliOptions` interface
- [x] Update `buildConfig()` to parse new options

### 17.4 Schema Changes

**File: `src/schemas/synthesisResult.ts`**
- [x] Add `LinkedInPostSchema`:
  ```typescript
  z.object({
    postNumber: z.number().int().min(1),
    totalPosts: z.number().int().min(1),
    linkedinPost: z.string().min(1).max(LINKEDIN_POST_MAX_LENGTH),
    keyQuotes: z.array(KeyQuoteSchema),
    infographicBrief: InfographicBriefSchema,
    seriesTitle: z.string().optional(),
  })
  ```
- [x] Update `SynthesisResultSchema` to support multi-post:
  - [x] Add `postStyle: z.enum(['series', 'variations'])`
  - [x] Add `posts: z.array(LinkedInPostSchema).min(1).max(3).optional()` (optional for backward compat)
  - [x] Keep existing `linkedinPost` field for single-post mode
  - [x] Aggregate `factCheckSummary` across all posts
- [x] Ensure backward compatibility for single-post (postCount: 1)
- [x] Add `GPTMultiPostResponseSchema` for validating GPT output in multi-post mode
- [x] Update barrel export (`src/schemas/index.ts`) with new types

### 17.5 GPT Prompt Engineering

**File: `src/synthesis/gpt.ts`**
- [x] Add `buildMultiPostPrompt(claims, userPrompt, postCount, postStyle)`:
  - [x] For `variations`: Request N distinct posts with different hooks
  - [x] For `series`: Request N-part connected series
  - [x] Include instructions for distributing claims across posts
  - [x] Prevent quote repetition across posts (variations)
- [x] Update JSON schema in prompt to expect `posts` array
- [x] Add series-specific instructions:
  - [x] Part numbering (e.g., "Part 1/3:")
  - [x] Teasers for next parts
  - [x] Logical progression of claims
- [x] Add `parseMultiPostResponse()` for validating multi-post GPT output
- [x] Add `convertMultiPostToSynthesisResult()` for backward-compatible output
- [x] Update `synthesize()` to detect multi-post mode and use appropriate prompt/parser

### 17.6 File Output Changes

**File: `src/utils/fileWriter.ts`**
- [x] Add `writeLinkedInPosts(posts: LinkedInPost[])` method:
  - [x] If 1 post: write `linkedin_post.md` (backward compatible)
  - [x] If > 1: write `linkedin_post_1.md`, `linkedin_post_2.md`, etc.
  - [x] Write `linkedin_posts_combined.md` for multi-post
- [x] Update `OutputWriter` interface with new method
- [x] Update `createOutputWriterFromDir()` implementation
- [x] Add `writeInfographics()` method for multi-infographic support
- [x] Add `formatCombinedPosts()` helper for combined markdown output

### 17.7 Image Generation Updates

**File: `src/image/nanoBanana.ts`**
- [x] Support generating multiple infographics:
  - [x] Each post has its own `infographicBrief`
  - [x] Output: `infographic_1.png`, `infographic_2.png`, etc.
  - [x] For single post: `infographic.png` (backward compatible)
- [x] Add `generateMultipleInfographics()` function
- [x] Export from `src/image/index.ts`

**File: `src/cli/runPipeline.ts`**
- [x] Update image generation loop:
  - [x] Iterate over `synthesis.posts`
  - [x] Generate one infographic per post
  - [x] Use numbered filenames for multi-post

### 17.8 Pipeline Orchestration

**File: `src/cli/runPipeline.ts`**
- [x] Update Stage 4 (Synthesis):
  - [x] Pass `postCount` and `postStyle` to synthesize function
  - [x] Handle new multi-post `SynthesisResult` structure
  - [x] Call `writeLinkedInPosts()` instead of `writeLinkedInPost()`
- [x] Update Stage 5 (Image):
  - [x] Loop through each post for image generation
  - [x] Use appropriate filenames
- [x] Update provenance tracking for multi-post

### 17.9 Tests

**File: `tests/unit/cli.test.ts`**
- [x] Test `--post-count` option parsing
- [x] Test `--post-style` option parsing
- [x] Test validation (1-3 range, series|variations)
- [x] Test default values

**File: `tests/unit/config.test.ts`**
- [x] Test `parsePostCount()` function
- [x] Test `parsePostStyle()` function
- [x] Test `buildConfig()` with new options

**File: `tests/unit/synthesis.test.ts`**
- [ ] Test multi-post prompt building (variations) - TODO: add dedicated tests
- [ ] Test multi-post prompt building (series) - TODO: add dedicated tests
- [ ] Test schema validation for multi-post result - TODO: add dedicated tests

**File: `tests/unit/fileWriter.test.ts`**
- [ ] Test `writeLinkedInPosts()` with 1 post - TODO: add dedicated tests
- [ ] Test `writeLinkedInPosts()` with 3 posts - TODO: add dedicated tests
- [ ] Test combined file generation - TODO: add dedicated tests

### 17.10 Documentation

- [x] Update PRD-v2.md with Multi-Post Generation section
- [x] Update PRD-v2.md CLI options
- [x] Update PRD-v2.md examples
- [x] Update PRD-v2.md changelog

---

## 18. Prompt Refinement Phase

Interactive prompt refinement that runs before data collection. LLM analyzes and optimizes user prompts, asking clarifying questions when ambiguous.

### 18.1 Type Definitions

**File: `src/refinement/types.ts`**
- [x] Define `RefinementModel` type: `'gemini' | 'gpt' | 'claude' | 'kimi2'`
- [x] Define `RefinementConfig` interface:
  ```typescript
  interface RefinementConfig {
    skip: boolean;              // --skip-refinement flag
    model: RefinementModel;     // --refinement-model option
    maxIterations: number;      // Default: 3
    timeoutMs: number;          // Default: 30000
  }
  ```
- [x] Define `PromptAnalysis` interface:
  ```typescript
  interface PromptAnalysis {
    isClear: boolean;
    confidence: number;         // 0.0 - 1.0
    clarifyingQuestions?: string[];
    suggestedRefinement?: string;
    reasoning: string;
    detectedIntents?: string[];
  }
  ```
- [x] Define `RefinementResult` interface:
  ```typescript
  interface RefinementResult {
    refinedPrompt: string;
    originalPrompt: string;
    wasRefined: boolean;
    iterationCount: number;
    modelUsed: RefinementModel;
    processingTimeMs: number;
  }
  ```
- [x] Define `UserResponse` interface for handling user input

### 18.2 Zod Schemas

**File: `src/refinement/schemas.ts`**
- [x] Create `PromptAnalysisSchema`:
  - [x] Validate isClear boolean
  - [x] Validate confidence 0-1 range
  - [x] Require clarifyingQuestions when isClear=false
  - [x] Validate suggestedRefinement when isClear=true
- [x] Create `RefinementResponseSchema` for LLM response validation
- [x] Create `UserAnswersSchema` for collecting clarifying answers

### 18.3 CLI Stdin Utilities

**File: `src/utils/stdin.ts`**
- [x] Implement `createReadlineInterface()`:
  - [x] Create readline.Interface for stdin/stdout
- [x] Implement `askQuestion(rl, question)`:
  - [x] Prompt user and return answer string
- [x] Implement `askYesNo(rl, question, defaultValue)`:
  - [x] Return boolean for Y/n style questions
- [x] Implement `displayRefinedPrompt(prompt)`:
  - [x] Format and display the refined prompt with styling
- [x] Implement `displayClarifyingQuestions(questions)`:
  - [x] Format numbered question list
- [x] Implement `collectAnswers(rl, questions)`:
  - [x] Iterate through questions and collect answers
  - [x] Return answers as Record<string, string>
- [x] Implement `askAcceptRejectFeedback(rl)`:
  - [x] Handle Y/n/feedback user responses
  - [x] Return action and optional feedback text
- [x] Implement `closeReadline(rl)`:
  - [x] Clean up readline interface
- [x] Add display helper functions:
  - [x] `displayAnalyzing()` - Show analyzing message
  - [x] `displaySuccess(message)` - Show green success message
  - [x] `displayWarning(message)` - Show yellow warning message
  - [x] `displaySkipping(reason)` - Show skip message
  - [x] `displayUsingOriginal()` - Show original prompt usage message

### 18.4 System Prompts

**File: `src/refinement/prompts.ts`**
- [x] Define `DELIMITERS` for prompt injection defense:
  - [x] USER_PROMPT_START/END markers
  - [x] USER_ANSWERS_START/END markers
  - [x] FEEDBACK_START/END markers
- [x] Define `ANALYSIS_SYSTEM_PROMPT`:
  - [x] Instructions for analyzing prompt clarity
  - [x] Criteria for determining if prompt is clear vs ambiguous (5 dimensions)
  - [x] JSON output format requirements
  - [x] Security instructions for delimiter handling
- [x] Define `REFINEMENT_SYSTEM_PROMPT`:
  - [x] Instructions for combining prompt with Q&A
  - [x] JSON output format requirements
- [x] Define `FEEDBACK_SYSTEM_PROMPT`:
  - [x] Instructions for adjusting based on user feedback
  - [x] JSON output format requirements
- [x] Implement `buildAnalysisPrompt(userPrompt)`:
  - [x] Sanitize user prompt with `sanitizePromptContent()`
  - [x] Wrap user prompt in delimiters
  - [x] Request JSON response format
- [x] Implement `buildRefinementPrompt(original, questions, answers)`:
  - [x] Sanitize all user inputs
  - [x] Combine original prompt with Q&A context
  - [x] Request optimized refined prompt
- [x] Implement `buildFeedbackPrompt(original, previousRefinement, feedback)`:
  - [x] Sanitize all inputs
  - [x] Include previous refinement and feedback
  - [x] Request adjusted refinement
- [x] Implement utility functions:
  - [x] `extractJsonFromResponse(response)` - Strip markdown fences and extract JSON
  - [x] `looksLikeJson(text)` - Quick validation check

### 18.5 Model Integrations

**File: `src/refinement/gemini.ts`** (Default)
- [x] Implement `analyzeWithGemini(prompt, config)`:
  - [x] Use GoogleGenAI client (singleton pattern)
  - [x] Model: `gemini-2.0-flash-exp` or latest
  - [x] Apply timeout with Promise.race
  - [x] Retry with exponential backoff
  - [x] Parse and validate response
- [x] Follow patterns from `src/prompts/breakdown.ts`

**File: `src/refinement/gpt.ts`**
- [x] Implement `analyzeWithGPT(prompt, config)`:
  - [x] Use OpenAI client (reuse getOpenAIClient)
  - [x] Model: `gpt-5.2` with reasoningEffort: 'low'
  - [x] JSON response format
  - [x] Timeout and retry handling
- [x] Follow patterns from `src/synthesis/gpt.ts`

**File: `src/refinement/claude.ts`** (NEW PROVIDER)
- [x] Add `@anthropic-ai/sdk` dependency to package.json
- [x] Implement `getAnthropicClient()` singleton:
  - [x] Validate ANTHROPIC_API_KEY
  - [x] Create client with race condition protection
- [x] Implement `analyzeWithClaude(prompt, config)`:
  - [x] Model: `claude-sonnet-4-5-20241022`
  - [x] Timeout and retry handling
  - [x] Response parsing and validation
- [x] Export client getter for potential reuse

**File: `src/refinement/kimi.ts`**
- [x] Implement `analyzeWithKimi(prompt, config)`:
  - [x] Reuse OpenRouter patterns from `src/scoring/openrouter.ts`
  - [x] Model: `moonshotai/kimi-k2-thinking`
  - [x] Reasoning effort: low (for speed)
  - [x] Timeout and retry handling

### 18.6 Main Orchestrator

**File: `src/refinement/index.ts`**
- [x] Export all types and schemas
- [x] Implement `refinePrompt(prompt, config)`:
  ```typescript
  async function refinePrompt(
    prompt: string,
    config: RefinementConfig
  ): Promise<RefinementResult> {
    // 1. Skip if config.skip is true
    // 2. Select model based on config.model
    // 3. Loop up to maxIterations:
    //    a. Analyze prompt
    //    b. If clear: show refined, ask to accept
    //    c. If not clear: ask questions, collect answers
    //    d. User can: accept, reject, or provide feedback
    // 4. Return RefinementResult
  }
  ```
- [x] Implement `selectAnalyzer(model)`:
  - [x] Return appropriate analyze function based on model
- [x] Handle escape hatch: user types 'skip' or Ctrl+C
- [x] Implement graceful timeout handling

### 18.7 CLI Integration

**File: `src/cli/program.ts`**
- [x] Add `--skip-refinement` option:
  ```typescript
  .option('--skip-refinement', 'Skip prompt refinement phase')
  ```
- [x] Add `--refinement-model <model>` option:
  ```typescript
  .option('--refinement-model <model>',
    'Refinement model: gemini|gpt|claude|kimi2', 'gemini')
  ```
- [x] Update CommanderOptions interface
- [x] Update isValidCommanderOptions validation
- [x] Update parseCliOptions to handle new options

**File: `src/config.ts`**
- [x] Add `ANTHROPIC_API_KEY` to ENV_KEYS
- [x] Implement `parseRefinementModel(modelStr)`:
  - [x] Validate against allowed values
  - [x] Log warning on invalid, return 'gemini'
- [x] Update `CliOptions` interface with new fields
- [x] Update `buildConfig()` to parse refinement options
- [x] Update `validateApiKeys()`:
  - [x] Check ANTHROPIC_API_KEY when claude model selected

**File: `src/types/index.ts`**
- [x] Add `RefinementModel` type export
- [x] Add `RefinementConfig` to `PipelineConfig` interface

### 18.8 Pipeline Integration

**File: `src/cli/runPipeline.ts`**
- [x] Import refinePrompt from refinement module
- [x] Add Stage 0 before Collection:
  ```typescript
  // Stage 0: Prompt Refinement
  if (!config.refinement.skip) {
    logStage('Prompt Refinement');
    const refinementResult = await refinePrompt(prompt, config.refinement);
    prompt = refinementResult.refinedPrompt;
    logVerbose(`Prompt refined: "${refinementResult.originalPrompt}" → "${prompt}"`);
  }

  // Stage 1: Collection (existing)
  const collection = await collectAll(prompt, config);
  ```
- [x] Update PipelineState if needed for refinement tracking
- [x] Pass refined prompt to all subsequent stages

### 18.9 Tests

**File: `tests/unit/refinement-schemas.test.ts`** (NEW)
- [x] Test RefinementModelSchema:
  - [x] Valid model values (gemini, gpt, claude, kimi2)
  - [x] Invalid model rejection (openai, anthropic, empty)
- [x] Test RefinementConfigSchema:
  - [x] Valid config with all fields
  - [x] Invalid maxIterations bounds
  - [x] Invalid timeoutMs bounds
- [x] Test PromptAnalysisSchema validation:
  - [x] Valid clear prompt analysis
  - [x] Valid ambiguous prompt analysis
  - [x] Rejection of invalid confidence values
  - [x] Requirement of questions when isClear=false
- [x] Test RefinementResponseSchema:
  - [x] Valid response with all fields
  - [x] Invalid refinedPrompt length
- [x] Test UserActionSchema and UserResponseSchema:
  - [x] Valid actions (accept, reject, feedback)
  - [x] Feedback action requires feedback text
- [x] Test UserAnswersSchema:
  - [x] Valid with non-empty answers
  - [x] Invalid with all empty answers
- [x] Test RefinementResultSchema:
  - [x] Valid complete result
  - [x] Invalid iterationCount/processingTimeMs
- [x] Test validation helpers:
  - [x] isValidRefinementModel()
  - [x] parsePromptAnalysis()
  - [x] parseRefinementResponse()
  - [x] formatValidationError()

**File: `tests/unit/stdin.test.ts`** (NEW)
- [x] Test createReadlineInterface() and closeReadline()
- [x] Test askQuestion() with trimmed input
- [x] Test askYesNo() handles Y/n/empty/various cases
- [x] Test askAcceptRejectFeedback() accept/reject/feedback flows
- [x] Test display helpers (displayAnalyzing, displaySuccess, displayWarning, displaySkipping)
- [x] Test collectAnswers()

**File: `tests/unit/refinement-prompts.test.ts`** (NEW)
- [x] Test DELIMITERS constants:
  - [x] All delimiter keys exist with <<<NAME>>> format
  - [x] Unique values, matching START/END pairs
- [x] Test buildAnalysisPrompt:
  - [x] Proper delimiter wrapping and positioning
  - [x] System prompt content present
  - [x] Sanitization of prompt injection attempts
  - [x] Truncation of long prompts (>2000 chars)
- [x] Test buildRefinementPrompt:
  - [x] Q&A formatting with delimiters
  - [x] Support for 1-indexed and 0-indexed answer keys
  - [x] Missing answer handling
  - [x] Input sanitization
- [x] Test buildFeedbackPrompt:
  - [x] Three-section structure (original, refinement, feedback)
  - [x] Input sanitization for all parameters
  - [x] Feedback truncation (>1000 chars)
- [x] Test extractJsonFromResponse:
  - [x] Markdown fence removal
  - [x] Leading/trailing text handling
  - [x] Complex nested JSON extraction
- [x] Test looksLikeJson:
  - [x] Valid JSON object/array detection
  - [x] Invalid/incomplete JSON rejection
  - [x] Whitespace handling
- [x] Security tests:
  - [x] Delimiter injection attacks
  - [x] Role injection (system:/assistant:)
  - [x] Instruction override patterns
  - [x] Template injection (Jinja, Mustache)

**File: `tests/unit/config.test.ts`**
- [x] Add tests for refinement config parsing:
  - [x] parseRefinementModel() valid/invalid values
  - [x] buildConfig() with refinement options
- [x] Test API key validation for claude model (ANTHROPIC_API_KEY)
- [x] Test API key validation for kimi2 model (OPENROUTER_API_KEY)

**File: `tests/mocks/`**
- [x] Create `refinement_clear_response.json` fixture
- [x] Create `refinement_ambiguous_response.json` fixture

### 18.10 Documentation

- [x] Update PRD-v2.md with new Section 14 (Prompt Refinement)
- [x] Update PRD Architecture diagram to show Stage 0
- [x] Update PRD CLI options table
- [x] Update PRD Environment Variables
- [x] Add example usage to docs/HowTo.md
- [x] Update changelog in both PRD and TODO

---

## API Documentation Links

| Service | Documentation |
|---------|---------------|
| Perplexity Sonar | https://docs.perplexity.ai/ |
| ScrapeCreators | https://docs.scrapecreators.com/ |
| Gemini 3 Flash | https://ai.google.dev/gemini-api/docs/gemini-3 |
| OpenAI GPT-5.2 | https://platform.openai.com/docs/models/gpt-5.2 |
| Nano Banana Pro | https://ai.google.dev/gemini-api/docs/image-generation |
| Zod | https://zod.dev/ |
| Vitest | https://vitest.dev/ |

---

## Changelog

### v2.3.0 (2025-12-30)
- Added Section 18: Prompt Refinement Phase
- Interactive prompt refinement with hybrid LLM analysis
- New CLI options: `--skip-refinement` and `--refinement-model <model>`
- Support for 4 refinement models: Gemini 3.0 Flash, GPT-5.2, Claude Sonnet 4.5, Kimi 2
- New Anthropic SDK integration for Claude support

### v2.2.0 (2025-12-30)
- Added Section 17: Multi-Post Generation
- New CLI options: `--post-count` (1-3) and `--post-style` (series|variations)
- Support for generating multiple post variations for A/B testing
- Support for connected multi-part series posts

### v2.1.0 (2025-12-30)
- Added Section 16: Phase 1 Enhancements
- Added smart prompt breakdown for multi-source search (long prompts → web, broken-down → social)
- Added OpenRouter KIMI 2 as alternative scoring model via `--scoring-model` flag

### v2.0.0 (2025-12-26)
- Added Zod schema validation for all data types
- Added ValidatedItem schema (was missing in v1)
- Added verification levels framework
- Added deduplication implementation details
- Added failure modes for each stage
- Added cost estimation utilities
- Added comprehensive CLI flags
- Added sources.json and sources.md outputs
- Added claim extraction before synthesis
- Added fact-check summary
- Added unit/mock/golden/evaluation testing
- Added security/secrets handling requirements
- Added Definition of Done checklist
- Restructured around PRD v2 feedback
