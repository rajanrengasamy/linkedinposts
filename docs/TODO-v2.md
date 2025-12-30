# LinkedIn Post Generator - Project TODO v2

**Version**: 2.0
**Last Updated**: 2025-12-26
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
