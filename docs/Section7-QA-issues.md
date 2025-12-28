# Section 7 QA Findings (Data Collectors) - Comprehensive Review

**Reviewed**: 2025-12-28
**Reviewer**: Senior QA (Ultrathink Analysis)
**Files Reviewed**:
- `src/collectors/web.ts`
- `src/collectors/linkedin.ts`
- `src/collectors/twitter.ts`
- `src/collectors/index.ts`
- `tests/integration/collectors.test.ts`
- `tests/mocks/*.json`

**Reference Documents**:
- `docs/PRD-v2.md`
- `docs/TODO-v2.md` (Section 7)
- `src/schemas/rawItem.ts`

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 5 |
| Medium | 5 |
| Low | 2 |
| **Total** | **15** |

---

## Critical Issues (Must Fix)

### 1. Twitter collector fabricates non-existent source URLs (PROVENANCE VIOLATION)

**Location**: `src/collectors/twitter.ts:109-111, 145-149, 254-259`

**Evidence**:
```typescript
// Line 109-111: Falls back to random UUID if no tweet ID
function extractTweetId(tweet: ScrapeCreatorsTweet): string {
  return tweet.id ?? tweet.tweet_id ?? uuidv4();  // PROBLEM: Random ID!
}

// Line 145-149: Builds URL using that potentially-random ID
function buildTweetUrl(tweetId: string, authorHandle?: string): string {
  const cleanHandle = authorHandle?.replace(/^@/, '') ?? 'i';
  return `https://x.com/${cleanHandle}/status/${tweetId}`;
}

// Line 254-259: Uses fabricated URL as sourceUrl
const sourceUrl = tweet.url ?? tweet.tweet_url ?? buildTweetUrl(tweetId, authorHandle);
```

**PRD Requirement**: "No quote or claim appears in the final output unless it has a verified source URL" (PRD line 41)

**Risk**: Creates valid-looking but non-existent URLs like `https://x.com/user/status/a1b2c3d4-e5f6-...`. These pass URL validation but link to nothing, completely undermining provenance guarantees.

**Fix**: Return `null` and skip items that lack real tweet IDs. Never generate synthetic URLs.

---

### 2. Web collector attaches UNFILTERED citations to every item

**Location**: `src/collectors/web.ts:282-283`

**Evidence**:
```typescript
// In searchWeb(), building RawItem:
const rawItem: RawItem = {
  // ... other fields
  engagement: createDefaultEngagement(),
  citations: response.citations,  // RAW API response - NOT filtered!
};
```

Meanwhile, `parsePerplexityResponse()` (lines 153-185) carefully validates individual URLs with `normalizeUrl()` and skips bad ones. But the final item gets the RAW `response.citations` array attached.

**Schema Requirement**: `citations: z.array(z.string().url())` - every citation must be a valid URL

**Risk**: A single malformed citation URL (e.g., `"source [1]"` or truncated URL) causes `RawItemSchema.safeParse` to fail, dropping the entire item. This cascades: all web items could be dropped due to one bad citation.

**Fix**: Filter citations through `normalizeUrl()` before attaching, or attach only the validated URLs from `parsePerplexityResponse()`.

---

### 3. Collection does NOT error when all items are invalid/empty

**Location**: `src/collectors/index.ts:222-259`

**Evidence**:
```typescript
// collectAll() always returns, even with 0 items:
return {
  items: finalItems,  // Could be empty!
  metadata,
};
// No check: if (finalItems.length === 0) throw new Error(...)
```

**PRD Requirement**: "Collection: All fail → Exit with clear error message" (PRD line 530)

**Scenario**:
1. Web collector succeeds at API level
2. All returned content fails schema validation (e.g., all citations malformed)
3. `finalItems.length === 0`
4. Pipeline continues with no data
5. Downstream stages fail unpredictably or produce empty output

**Risk**: Silent failure with no diagnosis. User gets empty or broken output without understanding why.

**Fix**: After dedup/limits, check `if (finalItems.length === 0) throw new Error('No valid items collected. Errors: ...')`.

---

## High Severity Issues

### 4. Web collector incorrectly maps content blocks to citations (WRONG PROVENANCE)

**Location**: `src/collectors/web.ts:140-144`

**Evidence**:
```typescript
for (let i = 0; i < blocks.length; i++) {
  const block = blocks[i];
  const citationIndex = i % citations.length;  // MODULO CYCLES!
  const sourceUrl = citations[citationIndex];
```

**Problem**: If there are 5 content blocks and 3 citations:
- Block 0 → Citation 0 ✓
- Block 1 → Citation 1 ✓
- Block 2 → Citation 2 ✓
- Block 3 → Citation 0 (WRONG - recycled!)
- Block 4 → Citation 1 (WRONG - recycled!)

**Risk**: Content blocks get attributed to wrong sources. A quote from Source A could be labeled as from Source B.

**Fix**: Only create items for blocks where `i < citations.length`, or implement smarter citation-to-block matching based on content analysis.

---

### 5. LinkedIn collector ignores the query entirely

**Location**: `src/collectors/linkedin.ts:460-533`

**Evidence**:
```typescript
// Line 511: Logs the query
logInfo(`Searching LinkedIn for: "${query}"`);

// Line 521: But fetches from hardcoded profiles!
const profiles = DEFAULT_LINKEDIN_PROFILES;  // Never uses query
```

The inline comment (lines 473-475) acknowledges this limitation but PRD/TODO don't document it.

**PRD Requirement**: "Collects relevant content from web sources (default) or social platforms" (PRD line 94)

**Risk**: Returns posts from Satya Nadella and Jeff Weiner regardless of query. A search for "healthcare AI" returns generic tech leadership posts.

**Fix**:
- Option A: Implement client-side keyword filtering of posts
- Option B: Select profiles dynamically based on query topic
- Option C: Document limitation prominently in PRD/README

---

### 6. ScrapeCreators endpoints don't match PRD specification

**Location**: Multiple files vs PRD lines 145-148

| Source | PRD Says | Implementation Uses |
|--------|----------|---------------------|
| LinkedIn | `/v1/linkedin/search`, `/v1/linkedin/posts` | `/v1/linkedin/profile`, `/v1/linkedin/post` |
| Twitter | `/v1/twitter/search`, `/v1/twitter/community/tweets` | `/v1/twitter/search` only |

**Risk**:
- If PRD is authoritative, collectors may hit wrong/non-existent endpoints
- Missing `/v1/twitter/community/tweets` means community tweets never collected
- Integration tests may pass but production API calls may fail

**Fix**: Reconcile PRD with actual ScrapeCreators API capabilities. Either update PRD or implementation.

---

### 7. LinkedIn authorUrl assigned without validation

**Location**: `src/collectors/linkedin.ts:217-218, 231`

**Evidence**:
```typescript
const authorUrl = post.author?.url;  // Could be malformed
// ...
const item: RawItem = {
  // ...
  authorUrl,  // Assigned directly, no normalizeUrl()
};
```

**Schema**: `authorUrl: z.string().url().optional()` - invalid URL fails entire item

**Risk**: Malformed author URLs (e.g., `"linkedin.com/in/user"` missing protocol) cause entire items to be dropped silently.

**Fix**: Wrap in try/catch with `normalizeUrl()`, or set to undefined if invalid.

---

### 8. "Stable UUID" requirement not met

**Location**: `web.ts:274`, `linkedin.ts:222,295`, `twitter.ts:270`

**TODO Requirement**: "Generate stable UUIDs for each item" (TODO-v2.md line 410)

**Evidence**: All collectors use `uuidv4()` which generates random UUIDs each run.

**Impact**:
- Same content produces different IDs across runs
- Breaks cross-run deduplication
- Complicates provenance tracking if outputs are compared

**Fix**: Use `uuidv5` with namespace seeded by `contentHash + sourceUrl + publishedAt` for deterministic IDs.

---

## Medium Severity Issues

### 9. Twitter/LinkedIn collector concurrency can overlap

**Location**: `src/collectors/index.ts:174-176`

**Evidence**:
```typescript
// All collectors start simultaneously:
const settledResults = await Promise.allSettled(
  collectors.map((collector) => collector.fn(query, config))
);
```

LinkedIn internally batches (5 concurrent), Twitter makes single request. But both collectors START at the same time, so their ScrapeCreators requests can overlap.

**Risk**: If both linkedin + x sources enabled, ScrapeCreators API could receive 6+ concurrent requests (5 from LinkedIn batch + 1 from Twitter), potentially exceeding rate limits.

**Fix**: Consider single ScrapeCreators request queue, or stagger collector starts.

---

### 10. Test expects twitter.com but code generates x.com URLs

**Location**: `tests/integration/collectors.test.ts:392-393` vs `twitter.ts:148`

**Evidence**:
```typescript
// Test expects:
expect(item.sourceUrl).toContain('twitter.com');

// But fallback generates:
return `https://x.com/${cleanHandle}/status/${tweetId}`;
```

**Why it passes**: Mock data has real `twitter.com` URLs, so fallback never triggers in tests.

**Risk**: If real API returns tweets without URLs, fabricated URLs would be `x.com` and wouldn't match test expectations. Inconsistent URL domains.

**Fix**: Decide on canonical domain (twitter.com or x.com) and use consistently.

---

### 11. LinkedIn authorHandle not normalized with @ prefix

**Location**: `src/collectors/linkedin.ts:302-304`

**Evidence**:
```typescript
author: profileData.name,
authorHandle: profileData.handle,  // No @ prefix!
authorUrl: profileData.url,
```

But Twitter collector normalizes (twitter.ts:131):
```typescript
return handle.startsWith('@') ? handle : `@${handle}`;
```

**PRD**: "authorHandle: @handle for social" (PRD line 93)

**Risk**: Inconsistent handle formats between Twitter (`@user`) and LinkedIn (`user`).

**Fix**: Add @ prefix in LinkedIn collector for consistency.

---

### 12. Metadata naming: xCount vs twitterCount

**Location**: TODO-v2.md:480-487 vs types/index.ts:175-181

**TODO Spec**: `twitterCount` in `CollectionResult.metadata`
**Implementation**: Uses `xCount`

**Previous Session Note**: Said this was "resolved" by renaming to `xCount`, but TODO not updated.

**Fix**: Update TODO-v2.md to document `xCount` as the canonical name.

---

### 13. Dead code path in twitter.ts

**Location**: `src/collectors/twitter.ts:213-216`

**Evidence**:
```typescript
// In makeTwitterRequest():
const apiKey = getApiKey('SCRAPECREATORS_API_KEY');
if (!apiKey) {
  throw new Error('SCRAPECREATORS_API_KEY not configured');
}
```

But `searchTwitter` already checks this at lines 317-320:
```typescript
if (!hasApiKey('SCRAPECREATORS_API_KEY')) {
  logVerbose('Twitter: SCRAPECREATORS_API_KEY not set, skipping');
  return [];
}
```

**Risk**: None (defensive code), but clutters codebase.

**Fix**: Remove redundant check in `makeTwitterRequest`, or change to assertion.

---

## Low Severity Issues

### 14. Web items lack publishedAt (affects recency scoring)

**Location**: `src/collectors/web.ts` (entire file)

**Evidence**: No `publishedAt` extraction for web items. Perplexity response doesn't provide publication dates.

**Impact**: Web items have `publishedAt: undefined`, which means:
- Recency scoring will be less accurate
- Cannot filter by time window

**Mitigation**: Document as known limitation. Consider parsing dates from content/titles if available.

---

### 15. Web collector logs concurrency limit but doesn't enforce batching

**Location**: `src/collectors/web.ts:212`

**Evidence**:
```typescript
logVerbose(`Using model: ${PERPLEXITY_MODEL}, concurrency limit: ${API_CONCURRENCY_LIMITS.perplexity}`);
```

But `searchWeb` makes a single API request (no batching needed for single query).

**Risk**: None currently (single request use case), but misleading log.

**Fix**: Remove concurrency log, or implement batching for multi-query support.

---

## Recommendations Summary

### Immediate (Critical/High):
1. **Fix Twitter URL fabrication** - Skip items without real tweet IDs
2. **Fix citations attachment** - Filter before attaching
3. **Add empty collection error** - Throw when no valid items
4. **Fix citation-to-block mapping** - Don't cycle with modulo
5. **Validate LinkedIn authorUrl** - Use normalizeUrl or skip

### Soon (Medium):
6. Document LinkedIn query limitation in PRD
7. Reconcile ScrapeCreators endpoints with PRD
8. Implement stable UUIDs with uuidv5
9. Normalize LinkedIn handles with @ prefix
10. Update TODO-v2.md for xCount naming

### Later (Low):
11. Document web publishedAt limitation
12. Clean up dead code paths
13. Remove misleading concurrency logs

---

## Test Coverage Gaps

The integration tests are comprehensive but don't cover:
- [ ] Fabricated URL scenario (tweet without ID)
- [ ] Malformed citation handling
- [ ] Empty collection after all items fail validation
- [ ] Citation-to-block mapping accuracy
- [ ] Cross-platform authorHandle consistency
