# LinkedIn Quote Generator - Project TODO

## Phase 0: CLI Implementation

---

### 1. Project Setup
- [ ] Initialize Node.js project (`npm init -y`)
- [ ] Install TypeScript and configure `tsconfig.json`
- [ ] Install production dependencies:
  - [ ] `@google/generative-ai` - Gemini & Nano Banana Pro
  - [ ] `axios` - HTTP client for ScrapeCreators
  - [ ] `chalk` - Terminal styling
  - [ ] `commander` - CLI framework
  - [ ] `dotenv` - Environment variables
  - [ ] `openai` - GPT-5.2 SDK
- [ ] Install dev dependencies:
  - [ ] `@types/node`
  - [ ] `typescript`
  - [ ] `tsx` - TypeScript execution
- [ ] Create `.gitignore` (node_modules, .env, output/, dist/)
- [ ] Create `.env.example` with API key placeholders
- [ ] Initialize git repository
- [ ] Create directory structure:
  ```
  src/
  ├── index.ts
  ├── config.ts
  ├── types/
  ├── collectors/
  ├── validation/
  ├── scoring/
  ├── synthesis/
  ├── image/
  └── utils/
  ```

---

### 2. Core Types & Configuration
- [ ] Create `src/types/index.ts`:
  - [ ] `ScrapedItem` interface
  - [ ] `ValidatedItem` interface
  - [ ] `ScoredItem` interface
  - [ ] `SynthesisResult` interface
  - [ ] `InfographicBrief` interface
  - [ ] `PipelineConfig` interface
- [ ] Create `src/config.ts`:
  - [ ] Load environment variables
  - [ ] Validate required API keys
  - [ ] Export typed configuration object
  - [ ] Define default values (max results, image resolution, etc.)

---

### 3. Utility Functions
- [ ] Create `src/utils/logger.ts`:
  - [ ] `logStage(name)` - Stage header with timestamp
  - [ ] `logProgress(current, total, message)` - Progress indicator
  - [ ] `logSuccess(message)` - Green success message
  - [ ] `logWarning(message)` - Yellow warning message
  - [ ] `logError(message)` - Red error message
- [ ] Create `src/utils/fileWriter.ts`:
  - [ ] `writeJSON(path, data)` - Write JSON with pretty formatting
  - [ ] `writeMarkdown(path, content)` - Write markdown file
  - [ ] `writePNG(path, buffer)` - Write binary image
  - [ ] `ensureOutputDir(path)` - Create output directory if missing
- [ ] Create `src/utils/retry.ts`:
  - [ ] `withRetry(fn, maxRetries, backoff)` - Exponential backoff wrapper
  - [ ] Handle rate limit errors specifically

---

### 4. Data Collectors

#### 4.1 LinkedIn Collector
- [ ] Create `src/collectors/linkedin.ts`:
  - [ ] Research ScrapeCreators LinkedIn endpoints:
    - [ ] `/v1/linkedin/search` - Search posts by keyword
    - [ ] `/v1/linkedin/profile` - Get profile details
    - [ ] `/v1/linkedin/posts` - Get posts from profile
  - [ ] Implement `searchLinkedIn(query, limit)`:
    - [ ] Build API request with x-api-key header
    - [ ] Parse response to `ScrapedItem[]`
    - [ ] Handle pagination if available
    - [ ] Extract: content, author, timestamp, engagement metrics
  - [ ] Add error handling for API failures
  - [ ] Add rate limiting awareness

#### 4.2 Twitter Collector
- [ ] Create `src/collectors/twitter.ts`:
  - [ ] Research ScrapeCreators Twitter endpoints:
    - [ ] `/v1/twitter/search` - Search tweets
    - [ ] `/v1/twitter/profile` - Get profile
    - [ ] `/v1/twitter/community/tweets` - Community tweets
  - [ ] Implement `searchTwitter(query, limit)`:
    - [ ] Build API request with x-api-key header
    - [ ] Parse response to `ScrapedItem[]`
    - [ ] Handle pagination
    - [ ] Extract: content, author, handle, timestamp, engagement
  - [ ] Add error handling
  - [ ] Add rate limiting

#### 4.3 Web Collector (Perplexity)
- [ ] Create `src/collectors/web.ts`:
  - [ ] Implement `searchWeb(query)`:
    - [ ] Build Perplexity API request:
      ```typescript
      {
        model: "sonar-reasoning-pro",
        messages: [{ role: "user", content: query }]
      }
      ```
    - [ ] Parse response with citations
    - [ ] Convert to `ScrapedItem[]` format
    - [ ] Extract citation URLs and source info
  - [ ] Handle reasoning output (CoT)
  - [ ] Add error handling

#### 4.4 Collector Orchestrator
- [ ] Create `src/collectors/index.ts`:
  - [ ] `collectAll(prompt)`:
    - [ ] Run all collectors in parallel (`Promise.all`)
    - [ ] Merge results with source tagging
    - [ ] Deduplicate by content similarity
    - [ ] Return combined `ScrapedItem[]`

---

### 5. Validation Engine

- [ ] Create `src/validation/perplexity.ts`:
  - [ ] Implement `validateItems(items)`:
    - [ ] Batch items to reduce API calls
    - [ ] For each batch, query Perplexity:
      - [ ] Verify author attribution
      - [ ] Check if quote/claim is real
      - [ ] Validate publication date
      - [ ] Cross-reference with web data
    - [ ] Parse reasoning output
    - [ ] Return `ValidatedItem[]` with:
      - [ ] `isVerified: boolean`
      - [ ] `verificationNotes: string`
      - [ ] `confidenceScore: number`
  - [ ] Handle items that can't be verified
  - [ ] Add progress logging

---

### 6. Scoring Engine

- [ ] Create `src/scoring/gemini.ts`:
  - [ ] Implement `scoreItems(items, prompt, validationData)`:
    - [ ] Build Gemini 3 Flash prompt:
      ```
      Score each item on:
      - Relevance to "{prompt}" (0-100)
      - Authenticity based on validation (0-100)
      - Recency/timeliness (0-100)
      - Engagement potential (0-100)

      Return JSON array with scores and reasoning.
      ```
    - [ ] Configure thinking_level (medium recommended)
    - [ ] Parse structured JSON response
    - [ ] Calculate weighted overall score:
      - [ ] Relevance: 35%
      - [ ] Authenticity: 30%
      - [ ] Recency: 20%
      - [ ] Engagement: 15%
    - [ ] Sort by overall score
    - [ ] Return top 50 as `ScoredItem[]`
  - [ ] Handle batch processing for large sets
  - [ ] Add fallback for parsing errors

---

### 7. Synthesis Engine

- [ ] Create `src/synthesis/gpt.ts`:
  - [ ] Implement `synthesize(scoredItems, prompt)`:
    - [ ] Build GPT-5.2 Thinking prompt:
      ```
      Create a LinkedIn post about "{prompt}" using these sources:
      {scoredItems}

      Requirements:
      - Engaging hook in first line
      - 2-3 key insights with quotes
      - Call to action
      - Relevant hashtags (3-5)
      - Professional but approachable tone

      Also create an infographic brief with:
      - Title
      - 3-5 key data points
      - Visual style recommendation
      - Color scheme suggestion
      ```
    - [ ] Use reasoning mode for better structure
    - [ ] Parse response into:
      - [ ] `linkedinPost: string`
      - [ ] `keyQuotes: Array<{quote, author, source}>`
      - [ ] `infographicBrief: InfographicBrief`
    - [ ] Return `SynthesisResult`
  - [ ] Handle context length limits
  - [ ] Add error handling

---

### 8. Image Generation

- [ ] Create `src/image/nanoBanana.ts`:
  - [ ] Research Nano Banana Pro API:
    - [ ] Endpoint configuration
    - [ ] Resolution options (2K, 4K)
    - [ ] Style parameters
  - [ ] Implement `generateInfographic(brief, resolution)`:
    - [ ] Convert InfographicBrief to image prompt:
      ```
      Create a professional infographic:
      Title: {title}
      Key points: {keyPoints}
      Style: {style}
      Colors: {colorScheme}

      Requirements:
      - Clean, modern design
      - Legible text
      - Data visualization
      - Professional quality
      ```
    - [ ] Set resolution (2K default, 4K optional)
    - [ ] Make API request
    - [ ] Return image buffer
  - [ ] Handle generation failures
  - [ ] Add retry logic

---

### 9. CLI Entry Point

- [ ] Create `src/index.ts`:
  - [ ] Set up Commander CLI:
    ```typescript
    program
      .name('linkedinquotes')
      .description('Generate LinkedIn posts from trending content')
      .argument('<prompt>', 'Topic or theme for the post')
      .option('--max-results <n>', 'Max items per source', '50')
      .option('--image-resolution <res>', '2k or 4k', '2k')
      .option('--output-dir <path>', 'Output directory', './output')
      .option('--skip-image', 'Skip infographic generation')
      .option('--verbose', 'Show detailed progress')
    ```
  - [ ] Implement main pipeline:
    ```typescript
    async function main(prompt, options) {
      // Stage 1: Collect
      logStage('Data Collection')
      const rawItems = await collectAll(prompt)
      writeJSON('raw_data.json', rawItems)

      // Stage 2a: Validate
      logStage('Validation')
      const validatedItems = await validateItems(rawItems)
      writeJSON('validated_data.json', validatedItems)

      // Stage 2b: Score
      logStage('Scoring')
      const scoredItems = await scoreItems(validatedItems, prompt)
      writeJSON('scored_data.json', scoredItems)
      writeJSON('top_50.json', scoredItems.slice(0, 50))

      // Stage 3: Synthesize
      logStage('Synthesis')
      const synthesis = await synthesize(scoredItems.slice(0, 50), prompt)
      writeJSON('synthesis.json', synthesis)
      writeMarkdown('linkedin_post.md', synthesis.linkedinPost)

      // Stage 4: Generate Image
      if (!options.skipImage) {
        logStage('Image Generation')
        const image = await generateInfographic(synthesis.infographicBrief)
        writePNG('infographic.png', image)
      }

      logSuccess('Done!')
    }
    ```
  - [ ] Add error handling wrapper
  - [ ] Add timing/performance logging

---

### 10. Testing & Validation

- [ ] Create test prompts for validation:
  - [ ] "AI trends in healthcare 2025"
  - [ ] "Remote work best practices"
  - [ ] "Startup funding strategies"
- [ ] Test each component individually:
  - [ ] LinkedIn collector returns valid data
  - [ ] Twitter collector returns valid data
  - [ ] Web collector returns valid data
  - [ ] Validation engine processes items
  - [ ] Scoring engine ranks items correctly
  - [ ] Synthesis creates valid LinkedIn post
  - [ ] Image generation produces PNG
- [ ] Test full pipeline end-to-end
- [ ] Verify output file formats
- [ ] Check error handling for:
  - [ ] Missing API keys
  - [ ] API rate limits
  - [ ] Empty results
  - [ ] Network failures

---

### 11. Documentation

- [ ] Update README.md with:
  - [ ] Project description
  - [ ] Installation instructions
  - [ ] API key setup guide
  - [ ] Usage examples
  - [ ] Output format descriptions
- [ ] Add inline code comments for complex logic
- [ ] Document API response formats

---

### 12. Polish & Optimization

- [ ] Add progress spinners for long operations
- [ ] Optimize batch sizes for API calls
- [ ] Add caching for repeated queries (optional)
- [ ] Profile and optimize slow operations
- [ ] Clean up console output formatting

---

## API Documentation Links

| Service | Documentation |
|---------|---------------|
| ScrapeCreators | https://docs.scrapecreators.com/ |
| Perplexity Sonar | https://docs.perplexity.ai/getting-started/models/models/sonar-pro |
| Gemini 3 Flash | https://ai.google.dev/gemini-api/docs/gemini-3 |
| OpenAI GPT-5.2 | https://platform.openai.com/docs/models/gpt-5.2 |
| Nano Banana Pro | https://ai.google.dev/gemini-api/docs/image-generation |

---

## Environment Variables Required

```env
SCRAPECREATORS_API_KEY=
PERPLEXITY_API_KEY=
GOOGLE_AI_API_KEY=
OPENAI_API_KEY=
```

---

## Notes

- All collectors run in parallel for speed
- Validation is optional but recommended for quality
- Image generation can be skipped with `--skip-image` flag
- All intermediate JSON files are saved for debugging
- Target completion time: < 2 minutes per run
