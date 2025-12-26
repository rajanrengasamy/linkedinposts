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
- [ ] Create `package.json` with `npm init -y`
- [ ] Configure `tsconfig.json`:
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
- [ ] Create `.gitignore`:
  ```
  node_modules/
  dist/
  output/
  .env
  *.log
  ```
- [ ] Initialize git repository

### 1.2 Install Dependencies

**Production:**
- [ ] `@google/generative-ai` - Gemini 3 Flash + Nano Banana Pro
- [ ] `axios` - HTTP client for ScrapeCreators
- [ ] `chalk` - Terminal styling
- [ ] `commander` - CLI framework
- [ ] `dotenv` - Environment variables
- [ ] `openai` - GPT-5.2 SDK
- [ ] `zod` - Schema validation (NEW)
- [ ] `uuid` - Stable ID generation (NEW)

**Development:**
- [ ] `@types/node`
- [ ] `@types/uuid`
- [ ] `typescript`
- [ ] `tsx` - TypeScript execution
- [ ] `vitest` - Testing framework (NEW)

### 1.3 Environment Configuration
- [ ] Create `.env.example`:
  ```env
  # Required
  PERPLEXITY_API_KEY=
  GOOGLE_AI_API_KEY=
  OPENAI_API_KEY=

  # Optional (for social sources)
  SCRAPECREATORS_API_KEY=
  ```
- [ ] Document which keys are required vs optional

### 1.4 Directory Structure
- [ ] Create full directory structure:
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
- [ ] Define `RawItemSchema`:
  - [ ] `id: z.string().uuid()`
  - [ ] `schemaVersion: z.literal('1.0.0')`
  - [ ] `source: z.enum(['web', 'linkedin', 'x'])`
  - [ ] `sourceUrl: z.string().url()` (required!)
  - [ ] `retrievedAt: z.string().datetime()`
  - [ ] `content: z.string().min(1)`
  - [ ] `contentHash: z.string()`
  - [ ] `title: z.string().optional()`
  - [ ] `author: z.string().optional()`
  - [ ] `authorHandle: z.string().optional()`
  - [ ] `authorUrl: z.string().url().optional()`
  - [ ] `publishedAt: z.string().datetime().optional()`
  - [ ] `engagement` object with platform-specific fields
  - [ ] `citations: z.array(z.string().url()).optional()`
- [ ] Export type: `type RawItem = z.infer<typeof RawItemSchema>`

**File: `src/schemas/validatedItem.ts`**
- [ ] Define `VerificationLevelSchema`:
  ```typescript
  z.enum([
    'UNVERIFIED',
    'SOURCE_CONFIRMED',
    'MULTISOURCE_CONFIRMED',
    'PRIMARY_SOURCE'
  ])
  ```
- [ ] Define `ValidationSchema`:
  - [ ] `level: VerificationLevelSchema`
  - [ ] `confidence: z.number().min(0).max(1)`
  - [ ] `checkedAt: z.string().datetime()`
  - [ ] `sourcesFound: z.array(z.string().url())`
  - [ ] `notes: z.array(z.string())` (brief bullets, not CoT)
  - [ ] `quotesVerified: z.array(...)` with quote, verified, sourceUrl
- [ ] Define `ValidatedItemSchema` extending RawItem

**File: `src/schemas/scoredItem.ts`**
- [ ] Define `ScoresSchema`:
  - [ ] `relevance: z.number().min(0).max(100)`
  - [ ] `authenticity: z.number().min(0).max(100)`
  - [ ] `recency: z.number().min(0).max(100)`
  - [ ] `engagementPotential: z.number().min(0).max(100)`
  - [ ] `overall: z.number().min(0).max(100)`
- [ ] Define `ScoredItemSchema` extending ValidatedItem

**File: `src/schemas/synthesisResult.ts`**
- [ ] Define `KeyQuoteSchema`:
  - [ ] `quote: z.string()`
  - [ ] `author: z.string()`
  - [ ] `sourceUrl: z.string().url()` (required!)
  - [ ] `verificationLevel: VerificationLevelSchema`
- [ ] Define `InfographicBriefSchema`
- [ ] Define `FactCheckSummarySchema`:
  - [ ] `totalSourcesUsed: z.number()`
  - [ ] `verifiedQuotes: z.number()`
  - [ ] `unverifiedClaims: z.number()`
  - [ ] `primarySources: z.number()`
  - [ ] `warnings: z.array(z.string())`
- [ ] Define `SynthesisResultSchema`

**File: `src/schemas/sourceReference.ts`**
- [ ] Define `SourceReferenceSchema`:
  - [ ] `id: z.string()` (references RawItem.id)
  - [ ] `url: z.string().url()`
  - [ ] `title: z.string()`
  - [ ] `verificationLevel: VerificationLevelSchema`
  - [ ] `usedInPost: z.boolean()`

### 2.2 Schema Validation Helpers

**File: `src/schemas/index.ts`**
- [ ] Export all schemas
- [ ] Create `validateOrThrow<T>(schema, data)` helper
- [ ] Create `tryValidate<T>(schema, data)` helper (returns Result type)
- [ ] Create `parseModelResponse(text)` helper:
  - [ ] Strip markdown code fences
  - [ ] Handle trailing text after JSON
  - [ ] Return parsed object or throw

### 2.3 Retry with Fix-JSON Prompt
- [ ] Create `retryWithFixPrompt(model, originalPrompt, badResponse)`:
  - [ ] Send "Fix this JSON: {badResponse}" prompt
  - [ ] Re-validate
  - [ ] Return fixed response or throw

---

## 3. Type Definitions

**File: `src/types/index.ts`**
- [ ] Export all inferred Zod types
- [ ] Define `PipelineConfig` interface:
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
- [ ] Define `PipelineResult` interface
- [ ] Define `StageResult<T>` interface with success/failure

---

## 4. Configuration

**File: `src/config.ts`**
- [ ] Load environment variables with dotenv
- [ ] Validate required API keys based on sources:
  - [ ] PERPLEXITY_API_KEY (always required)
  - [ ] GOOGLE_AI_API_KEY (always required)
  - [ ] OPENAI_API_KEY (always required)
  - [ ] SCRAPECREATORS_API_KEY (required only if linkedin/x sources)
- [ ] Fail fast with clear error messages if keys missing
- [ ] **Never log API keys** (sanitize all output)
- [ ] Export quality profile defaults:
  ```typescript
  const QUALITY_PROFILES = {
    fast: { maxTotal: 30, skipValidation: true, skipScoring: true, skipImage: true },
    default: { maxTotal: 75, skipValidation: false, skipScoring: false, skipImage: false },
    thorough: { maxTotal: 150, skipValidation: false, skipScoring: false, skipImage: false }
  };
  ```
- [ ] Define concurrency limits per API
- [ ] Define stage timeouts

---

## 5. Utility Functions

### 5.1 Logger (with Secrets Sanitization)

**File: `src/utils/logger.ts`**
- [ ] Create `sanitize(text)` to remove API keys from output
- [ ] `logStage(name)` - Stage header with timestamp
- [ ] `logProgress(current, total, message)` - Progress indicator
- [ ] `logSuccess(message)` - Green success
- [ ] `logWarning(message)` - Yellow warning
- [ ] `logError(message)` - Red error
- [ ] `logCost(estimates)` - Format cost breakdown
- [ ] `logVerbose(message)` - Only if --verbose flag
- [ ] All functions call `sanitize()` before output

### 5.2 File Writer (with Provenance)

**File: `src/utils/fileWriter.ts`**
- [ ] `ensureOutputDir(basePath)` - Create timestamped output directory
- [ ] `writeJSON<T>(path, data, schema?)` - Write with optional validation
- [ ] `writeMarkdown(path, content)` - Write markdown file
- [ ] `writePNG(path, buffer)` - Write binary image
- [ ] `writeSourcesJson(sources: SourceReference[])` - Provenance file
- [ ] `writeSourcesMd(sources: SourceReference[])` - Human-readable sources
- [ ] `writePipelineStatus(status)` - Run metadata and errors

### 5.3 Retry with Exponential Backoff

**File: `src/utils/retry.ts`**
- [ ] `withRetry<T>(fn, options)`:
  ```typescript
  interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retryOn?: (error: Error) => boolean;
  }
  ```
- [ ] Handle rate limit errors specifically (429)
- [ ] Log retry attempts if verbose
- [ ] Return last error if all retries fail

### 5.4 Cost Estimator (NEW)

**File: `src/utils/cost.ts`**
- [ ] Define cost per token/image for each API:
  ```typescript
  const COSTS = {
    perplexity: { inputPerMillion: 3, outputPerMillion: 15 },
    gemini: { inputPerMillion: 0.50, outputPerMillion: 3.00 },
    openai: { inputPerMillion: 10, outputPerMillion: 30 },
    nanoBanana: { '2k': 0.139, '4k': 0.24 }
  };
  ```
- [ ] `estimateCost(config: PipelineConfig)` - Pre-run estimate
- [ ] `calculateActualCost(usage)` - Post-run actual cost
- [ ] Return breakdown by service + total

---

## 6. Content Processing (NEW)

### 6.1 Normalization

**File: `src/processing/normalize.ts`**
- [ ] `normalizeContent(content: string)`:
  - [ ] Convert to lowercase
  - [ ] Remove URLs
  - [ ] Remove emoji
  - [ ] Remove punctuation
  - [ ] Collapse whitespace
  - [ ] Trim
- [ ] `generateContentHash(content: string)`:
  - [ ] Call normalizeContent
  - [ ] SHA-256 hash
  - [ ] Return first 16 characters
- [ ] `normalizeTimestamp(date: string | Date)`:
  - [ ] Convert to ISO 8601
  - [ ] Handle various input formats
- [ ] `normalizeUrl(url: string)`:
  - [ ] Remove tracking parameters
  - [ ] Ensure https
  - [ ] Normalize trailing slashes

### 6.2 Deduplication

**File: `src/processing/dedup.ts`**
- [ ] `deduplicateByHash(items: RawItem[])`:
  - [ ] Group by contentHash
  - [ ] Keep first occurrence (by retrievedAt)
  - [ ] Return deduplicated array
- [ ] `jaccardSimilarity(a: string, b: string)`:
  - [ ] Tokenize normalized strings
  - [ ] Calculate Jaccard index
- [ ] `deduplicateBySimilarity(items: RawItem[], threshold = 0.85)`:
  - [ ] For each pair, check similarity
  - [ ] Mark duplicates for removal
  - [ ] Return deduplicated array
- [ ] `deduplicate(items: RawItem[])`:
  - [ ] First pass: hash dedup
  - [ ] Second pass: similarity dedup (if still > threshold)
  - [ ] Log duplicates removed

---

## 7. Data Collectors

### 7.1 Web Collector (Perplexity) - Required

**File: `src/collectors/web.ts`**
- [ ] Implement `searchWeb(query: string, config: PipelineConfig)`:
  - [ ] Build Perplexity API request:
    ```typescript
    {
      model: "sonar-reasoning-pro",
      messages: [{ role: "user", content: buildSearchPrompt(query) }]
    }
    ```
  - [ ] Parse response extracting:
    - [ ] Main content
    - [ ] Citations (URLs)
    - [ ] Source titles
  - [ ] Generate stable UUIDs for each item
  - [ ] Set `retrievedAt` timestamp
  - [ ] Calculate contentHash
  - [ ] Validate against RawItemSchema
  - [ ] Return `RawItem[]`
- [ ] `buildSearchPrompt(query)`:
  - [ ] Derive 3-5 sub-queries from main prompt
  - [ ] Request structured output with citations
- [ ] Error handling: **FATAL** if web collector fails (required source)
- [ ] Respect concurrency limit (3)

### 7.2 LinkedIn Collector (Optional, Gated)

**File: `src/collectors/linkedin.ts`**
- [ ] Check if 'linkedin' in config.sources, skip if not
- [ ] Validate SCRAPECREATORS_API_KEY exists
- [ ] Research ScrapeCreators LinkedIn endpoints:
  - [ ] `/v1/linkedin/search` - Search posts
  - [ ] `/v1/linkedin/posts` - Get posts from profile
- [ ] Implement `searchLinkedIn(query, config)`:
  - [ ] Build API request with x-api-key header
  - [ ] Parse response to RawItem[]:
    - [ ] Map engagement (reactions → likes, comments, shares)
    - [ ] Extract author info
    - [ ] Generate contentHash
  - [ ] Validate against RawItemSchema
  - [ ] Return items or empty array on failure (non-fatal)
- [ ] Log compliance warning on first use
- [ ] Respect concurrency limit (5)

### 7.3 Twitter Collector (Optional, Gated)

**File: `src/collectors/twitter.ts`**
- [ ] Check if 'x' in config.sources, skip if not
- [ ] Validate SCRAPECREATORS_API_KEY exists
- [ ] Research ScrapeCreators Twitter endpoints:
  - [ ] `/v1/twitter/search` - Search tweets
  - [ ] `/v1/twitter/community/tweets` - Community tweets
- [ ] Implement `searchTwitter(query, config)`:
  - [ ] Build API request with x-api-key header
  - [ ] Parse response to RawItem[]:
    - [ ] Map X-specific engagement:
      - [ ] likes
      - [ ] retweets
      - [ ] quotes
      - [ ] replies
      - [ ] impressions (if available)
    - [ ] Extract author handle
    - [ ] Generate contentHash
  - [ ] Validate against RawItemSchema
  - [ ] Return items or empty array on failure (non-fatal)
- [ ] Log compliance warning on first use
- [ ] Respect concurrency limit (5)

### 7.4 Collector Orchestrator

**File: `src/collectors/index.ts`**
- [ ] Implement `collectAll(query, config)`:
  - [ ] Determine which collectors to run based on config.sources
  - [ ] Run collectors in parallel with `Promise.allSettled`
  - [ ] Handle partial failures:
    - [ ] Web fails → FATAL, throw error
    - [ ] LinkedIn/Twitter fails → log warning, continue
  - [ ] Merge results with source tagging
  - [ ] Apply maxPerSource limit before merge
  - [ ] Deduplicate merged results
  - [ ] Apply maxTotal limit
  - [ ] Return `RawItem[]` and collection metadata
- [ ] Return `CollectionResult`:
  ```typescript
  interface CollectionResult {
    items: RawItem[];
    metadata: {
      webCount: number;
      linkedinCount: number;
      twitterCount: number;
      duplicatesRemoved: number;
      errors: string[];
    };
  }
  ```

---

## 8. Validation Engine

**File: `src/validation/perplexity.ts`**

### 8.1 Core Validation
- [ ] Implement `validateItems(items: RawItem[], config)`:
  - [ ] If config.skipValidation, return items as UNVERIFIED ValidatedItems
  - [ ] Cap items for validation (only top N by engagement/recency)
  - [ ] Batch items (config.validationBatchSize)
  - [ ] For each batch, call Perplexity to verify:
    - [ ] Quote authenticity
    - [ ] Author attribution
    - [ ] Publication date
  - [ ] Assign verification level per item
  - [ ] Validate against ValidatedItemSchema
  - [ ] Return `ValidatedItem[]`

### 8.2 Verification Level Assignment
- [ ] Implement `assignVerificationLevel(verificationResult)`:
  ```typescript
  if (foundInPrimarySource) return 'PRIMARY_SOURCE';
  if (sourcesFound.length >= 2) return 'MULTISOURCE_CONFIRMED';
  if (sourcesFound.length === 1) return 'SOURCE_CONFIRMED';
  return 'UNVERIFIED';
  ```

### 8.3 Failure Handling
- [ ] If Perplexity times out:
  - [ ] Mark all items as UNVERIFIED
  - [ ] Set confidence to 0
  - [ ] Log warning
  - [ ] Continue pipeline
- [ ] If parse error:
  - [ ] Retry once with fix-JSON prompt
  - [ ] If still fails, mark UNVERIFIED

### 8.4 Concurrency & Batching
- [ ] Respect concurrency limit (3 concurrent Perplexity requests)
- [ ] Process batches sequentially to manage rate limits
- [ ] Log progress: "Validating batch 1/5..."

---

## 9. Scoring Engine

### 9.1 Gemini Scoring

**File: `src/scoring/gemini.ts`**
- [ ] Implement `scoreItems(items: ValidatedItem[], prompt, config)`:
  - [ ] If config.skipScoring, use fallback scoring
  - [ ] Batch items (config.scoringBatchSize)
  - [ ] Build Gemini prompt requesting JSON output:
    ```
    Score each item 0-100 on:
    - relevance: How relevant to "{prompt}"
    - authenticity: Based on verification level
    - recency: How recent (items have publishedAt)
    - engagementPotential: Likely to engage audience

    Return JSON array with id, scores, and brief reasoning.
    ```
  - [ ] Parse and validate response against ScoresSchema
  - [ ] Calculate weighted overall:
    ```typescript
    overall = (relevance * 0.35) + (authenticity * 0.30) +
              (recency * 0.20) + (engagementPotential * 0.15)
    ```
  - [ ] Sort by overall descending
  - [ ] Assign rank
  - [ ] Return top N as `ScoredItem[]`

### 9.2 Authenticity Score Boost
- [ ] Apply verification level boost to base authenticity:
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
- [ ] Implement `fallbackScore(items: ValidatedItem[])`:
  - [ ] Use heuristic:
    ```typescript
    overall = (recencyScore * 0.5) + (engagementScore * 0.5);
    ```
  - [ ] recencyScore: Based on publishedAt (newer = higher)
  - [ ] engagementScore: Normalize engagement metrics
  - [ ] Sort and rank
  - [ ] Return `ScoredItem[]`
- [ ] Use when Gemini fails or --skip-scoring

### 9.4 Failure Handling
- [ ] If Gemini error: Use fallback scoring
- [ ] If parse error:
  - [ ] Retry once with fix-JSON prompt
  - [ ] If still fails, use fallback

---

## 10. Synthesis Engine

### 10.1 Claim Extraction (NEW - Critical)

**File: `src/synthesis/claims.ts`**
- [ ] Implement `extractGroundedClaims(items: ScoredItem[])`:
  - [ ] Filter: only items with verification >= SOURCE_CONFIRMED
  - [ ] Identify quotable statements
  - [ ] Extract statistics and data points
  - [ ] Ensure each claim has sourceUrl
  - [ ] Return `GroundedClaim[]`:
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
- [ ] **Rule**: No claim without sourceUrl

### 10.2 Post Generation

**File: `src/synthesis/gpt.ts`**
- [ ] Implement `synthesize(claims: GroundedClaim[], prompt, config)`:
  - [ ] Build GPT-5.2 Thinking prompt:
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
  - [ ] Parse response
  - [ ] Validate against SynthesisResultSchema
  - [ ] **Verify**: No quote in post without sourceUrl in claims
  - [ ] Return `SynthesisResult`

### 10.3 Output Constraints
- [ ] Enforce max 3000 characters for linkedinPost
- [ ] Require 3-5 hashtags
- [ ] Verify all quotes have sourceUrl

### 10.4 Failure Handling
- [ ] If GPT error: **FATAL** (cannot complete without synthesis)
- [ ] If parse error:
  - [ ] Retry once with fix-JSON prompt
  - [ ] If still fails, save partial outputs and exit with error

---

## 11. Image Generation

**File: `src/image/nanoBanana.ts`**
- [ ] Implement `generateInfographic(brief: InfographicBrief, config)`:
  - [ ] If config.skipImage, return null immediately
  - [ ] Convert brief to image prompt:
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
  - [ ] Make Nano Banana Pro API request
  - [ ] Return image buffer
- [ ] Error handling:
  - [ ] Log warning on failure
  - [ ] Return null (non-blocking)
  - [ ] Pipeline continues without image
- [ ] Add note in output: "Image text may contain errors; review before use"

---

## 12. CLI Entry Point

**File: `src/index.ts`**

### 12.1 Commander Setup
- [ ] Configure CLI with all options:
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
- [ ] Parse options into PipelineConfig
- [ ] Apply quality profile overrides
- [ ] Validate source flags
- [ ] Handle --fast as shortcut for profile

### 12.3 Pre-flight Checks
- [ ] Validate API keys for requested sources
- [ ] If --print-cost-estimate:
  - [ ] Print estimate and exit
- [ ] If --dry-run:
  - [ ] Validate config, print summary, exit

### 12.4 Main Pipeline
- [ ] Implement `runPipeline(prompt, config)`:
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
- [ ] Catch all errors
- [ ] Write partial outputs if available
- [ ] Write pipeline_status.json with error details
- [ ] Exit with code 1 on failure

---

## 13. Testing (NEW - Critical)

### 13.1 Unit Tests

**Directory: `tests/unit/`**

- [ ] `normalize.test.ts`:
  - [ ] Test normalizeContent with various inputs
  - [ ] Test contentHash stability
  - [ ] Test URL normalization
  - [ ] Test timestamp normalization

- [ ] `dedup.test.ts`:
  - [ ] Test hash-based deduplication
  - [ ] Test Jaccard similarity calculation
  - [ ] Test similarity-based deduplication
  - [ ] Test edge cases (empty content, identical content)

- [ ] `schemas.test.ts`:
  - [ ] Test RawItem validation
  - [ ] Test ValidatedItem validation
  - [ ] Test ScoredItem validation
  - [ ] Test rejection of invalid data
  - [ ] Test parseModelResponse edge cases

- [ ] `cost.test.ts`:
  - [ ] Test cost estimation accuracy
  - [ ] Test different quality profiles

- [ ] `scoring.test.ts`:
  - [ ] Test weighted score calculation
  - [ ] Test verification level boost
  - [ ] Test fallback scoring

### 13.2 Mocked API Tests

**Directory: `tests/mocks/`**

- [ ] Create API response fixtures:
  - [ ] `perplexity_search_response.json`
  - [ ] `perplexity_validation_response.json`
  - [ ] `scrapecreators_linkedin_response.json`
  - [ ] `scrapecreators_twitter_response.json`
  - [ ] `gemini_scoring_response.json`
  - [ ] `gpt_synthesis_response.json`

**Directory: `tests/integration/`**

- [ ] `collectors.test.ts`:
  - [ ] Test web collector with mocked Perplexity
  - [ ] Test LinkedIn collector with mocked ScrapeCreators
  - [ ] Test Twitter collector with mocked ScrapeCreators
  - [ ] Test collector orchestrator with partial failures

- [ ] `validation.test.ts`:
  - [ ] Test validation with mocked Perplexity
  - [ ] Test verification level assignment
  - [ ] Test timeout handling

- [ ] `scoring.test.ts`:
  - [ ] Test scoring with mocked Gemini
  - [ ] Test fallback scoring on error

- [ ] `synthesis.test.ts`:
  - [ ] Test claim extraction
  - [ ] Test synthesis with mocked GPT

### 13.3 Golden Tests

**Directory: `tests/golden/`**

- [ ] Create golden test cases:
  - [ ] Input prompt → expected output structure
  - [ ] Validate JSON schema compliance
  - [ ] Check required fields present

- [ ] `golden.test.ts`:
  - [ ] Run pipeline with mocked APIs
  - [ ] Compare output structure to golden files
  - [ ] Fail on unexpected schema changes

### 13.4 Evaluation Harness (NEW)

**File: `tests/evaluate.ts`**
- [ ] Create evaluation script:
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
- [ ] `checkNoQuotesWithoutSources`: Every quote in linkedin_post.md has URL
- [ ] `checkPostLengthConstraints`: Under 3000 characters
- [ ] `checkAllFilesWritten`: All expected files exist
- [ ] `checkSourcesJsonValid`: Valid against SourceReferenceSchema
- [ ] `checkIdReferences`: top_50.json IDs exist in validated_data.json
- [ ] `checkVerificationLevels`: Levels correctly assigned

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
