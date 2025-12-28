# Section 7 QA Findings (Data Collectors)

Context: Reviewed Section 7 of `docs/TODO-v2.md` (Data Collectors) against implementations in `src/collectors/web.ts`, `src/collectors/linkedin.ts`, `src/collectors/twitter.ts`, and `src/collectors/index.ts`, with `docs/PRD-v2.md`, `src/schemas/rawItem.ts`, and `src/types/index.ts` for requirements and schema expectations. Findings are ordered by severity.

## 1) Twitter collector can fabricate non-existent source URLs (violates provenance)
- **Evidence**:
  - `extractTweetId` falls back to `uuidv4()` when the API response lacks `id`/`tweet_id` (`src/collectors/twitter.ts:109-111`).
  - `buildTweetUrl` always builds `https://x.com/{handle}/status/{tweetId}` using that ID (`src/collectors/twitter.ts:145-149`).
  - `tweetToRawItem` uses the built URL when `tweet.url`/`tweet.tweet_url` are absent (`src/collectors/twitter.ts:254-259`).
  - PRD principle requires true provenance URLs; RawItem enforces `sourceUrl` (`src/schemas/rawItem.ts:35-56`).
- **Expected**: If a tweet lacks a real ID/URL, the item should be skipped; source URLs must be actual tweet URLs, not synthetic placeholders.
- **Risk**: This can produce valid-looking but non-existent URLs, undermining provenance guarantees and potentially allowing unverified or unreachable sources into the pipeline (especially if validation is skipped).
- **Suggested fix**: Only build a URL when a real tweet ID is present; otherwise return `null`. Consider requiring either `tweet.url`/`tweet.tweet_url` or a verified `id` before accepting the item.

## 2) ScrapeCreators endpoint usage does not match PRD
- **Evidence**:
  - PRD lists ScrapeCreators endpoints as LinkedIn `/v1/linkedin/search`, `/v1/linkedin/posts` and Twitter `/v1/twitter/search`, `/v1/twitter/community/tweets` (`docs/PRD-v2.md:145-148`).
  - Implementation uses LinkedIn `/v1/linkedin/profile` and `/v1/linkedin/post` (`src/collectors/linkedin.ts:345-405`) and only Twitter `/v1/twitter/search` (`src/collectors/twitter.ts:332-335`).
- **Expected**: Collector endpoints should align with PRD to avoid breaking integrations and to meet the stated product contract.
- **Risk**: If the PRD is authoritative, these collectors may hit unsupported endpoints or miss required coverage (e.g., community tweets). This can lead to empty or irrelevant results despite the feature being marked complete.
- **Suggested fix**: Reconcile the PRD and implementation. Either update PRD to reflect the implemented endpoints or switch the collectors to the documented search/posts/community endpoints and adjust parsing accordingly.

## 3) Web collector attaches unvalidated citations array to every item
- **Evidence**:
  - `RawItemSchema` requires `citations` entries to be valid URLs (`src/schemas/rawItem.ts:113-115`).
  - Each web item sets `citations: response.citations` without normalization or filtering (`src/collectors/web.ts:272-283`).
  - If a single citation is malformed, `RawItemSchema.safeParse` fails and the item is dropped (`src/collectors/web.ts:286-292`).
- **Expected**: Citations should be normalized/filtered once, and only valid URLs should be attached to items (ideally scoped to the relevant content block).
- **Risk**: One bad citation string can invalidate every web item, leading to empty collection results even when content is present. This cascades into later stages and violates the PRD’s “all fail -> clear error” intent.
- **Suggested fix**: Normalize/filter `response.citations` before attaching; store only valid URLs. Consider mapping citations to each block instead of attaching the full list to all items.

## 4) LinkedIn collector ignores the query and returns static-profile posts
- **Evidence**:
  - `searchLinkedIn` logs the query but fetches hard-coded profiles (`DEFAULT_LINKEDIN_PROFILES`) regardless of query (`src/collectors/linkedin.ts:460-533`).
  - The inline comment explicitly notes the query is not used for filtering (`src/collectors/linkedin.ts:473-475`).
- **Expected**: LinkedIn collection should be driven by the user query to satisfy the PRD’s “collect relevant content” goal.
- **Risk**: Results may be unrelated to the user prompt, polluting the dataset and degrading scoring/selection and the final post quality.
- **Suggested fix**: Implement basic keyword filtering of fetched posts or dynamically select profiles based on the query. If this is intentional, mark the limitation explicitly in docs/PRD and TODO.

## 5) Collection does not error when all items are invalid/empty
- **Evidence**:
  - PRD requires “Collection: All fail -> Exit with clear error message” (`docs/PRD-v2.md:526-532`).
  - `collectAll` always returns `finalItems` and never throws when `finalItems.length === 0` (`src/collectors/index.ts:222-259`).
  - `searchWeb` can return an empty array if all parsed items fail schema (no explicit error after validation loop) (`src/collectors/web.ts:286-296`).
- **Expected**: If all sources yield no usable items, `collectAll` should throw a clear error.
- **Risk**: The pipeline can proceed with no data, causing downstream stages to fail unpredictably or generate empty output without a clear diagnosis.
- **Suggested fix**: After dedup/maxTotal, check `finalItems.length`. If zero, throw an error with collected source errors and hints (e.g., missing citations, invalid URLs).

## 6) Collection metadata shape mismatches TODO spec (`xCount` vs `twitterCount`)
- **Evidence**:
  - TODO spec expects `twitterCount` in `CollectionResult.metadata` (`docs/TODO-v2.md:480-487`).
  - Implementation uses `xCount` in `CollectionMetadata` and `collectAll` (`src/types/index.ts:175-181`, `src/collectors/index.ts:229-239`).
- **Expected**: The metadata shape should match the documented interface so downstream code and tests can rely on it.
- **Risk**: Consumers expecting `twitterCount` will break or silently ignore the count.
- **Suggested fix**: Align naming across code and docs. Either rename to `twitterCount` or update TODO/PRD to standardize on `xCount`. Consider a temporary alias for backward compatibility.

## 7) “Stable UUID” requirement not met (IDs are random per run)
- **Evidence**:
  - TODO calls out “Generate stable UUIDs for each item” (`docs/TODO-v2.md:410`).
  - Collectors use `uuidv4()` which is non-deterministic (`src/collectors/web.ts:274`, `src/collectors/linkedin.ts:222,295`, `src/collectors/twitter.ts:270`).
- **Expected**: Stable IDs should be deterministic for identical content (e.g., derived from `contentHash` + `sourceUrl`).
- **Risk**: IDs change across runs, complicating provenance tracking, caching, and cross-run deduplication.
- **Suggested fix**: Use `uuidv5` or a deterministic hash-based UUID seeded by stable fields (source URL + content hash + publishedAt). If stability is not required across runs, clarify the requirement in TODO/PRD.
