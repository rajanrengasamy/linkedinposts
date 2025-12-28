# Section 8 QA Issues

## 1) Missing ValidatedItemSchema enforcement allows invalid verification states (Severity: High)
Evidence:
- src/validation/perplexity.ts:521-528 returns validated items without validating against ValidationSchema or ValidatedItemSchema.
- src/schemas/validatedItem.ts:112-118 requires sourcesFound length >= 1 for PRIMARY_SOURCE and >= 2 for MULTISOURCE_CONFIRMED.
- src/validation/perplexity.ts:387-414 (toValidation) can return PRIMARY_SOURCE when isPrimarySource is true even if sourcesFound is empty.
Impact:
- Invalid validation objects can propagate (e.g., PRIMARY_SOURCE with zero sourcesFound), violating provenance rules and inflating authenticity.
- Downstream stages can treat unsubstantiated items as highly verified.
Recommendation:
- Validate each returned item against ValidatedItemSchema (or ValidationSchema) and fall back to UNVERIFIED when schema validation fails.

## 2) Publication date verification is not captured or enforced (Severity: Medium)
Evidence:
- Section 8.1 requires verifying publication date.
- buildValidationPrompt in src/validation/perplexity.ts:250-256 does not ask the model to verify or return a publication date.
- ValidationResponseSchema in src/validation/perplexity.ts:180-212 has no field for publication date or publishedAt verification.
Impact:
- Recency scoring can rely on unverified or missing publishedAt values, undermining the PRD verification framework.
Recommendation:
- Extend the prompt and response schema to capture a verified publishedAt (or a publishedAtVerified flag) and persist it (or record in notes if not updating the item).

## 3) Validation capping ignores recency despite requirement (Severity: Medium)
Evidence:
- validateItems in src/validation/perplexity.ts:568-575 sorts only by engagement score.
- TODO Section 8.1 states selection should be based on engagement/recency.
Impact:
- Older high-engagement items can crowd out recent items, conflicting with the PRD "trending" time window.
Recommendation:
- Incorporate a recency component into the selection logic (use publishedAt when available, fallback to retrievedAt), or document the rationale for excluding recency.

## 4) Perplexity timeout handling is per-item, not stage-level (Severity: Medium)
Evidence:
- validateSingleItem marks a single item UNVERIFIED on error and continues (src/validation/perplexity.ts:529-535).
- PRD Failure Modes and TODO 8.3 specify that a Perplexity timeout should mark all items UNVERIFIED and continue.
Impact:
- During a Perplexity outage, the validator still attempts every item (with retries), increasing runtime and cost instead of failing open quickly.
Recommendation:
- Add a circuit breaker in validateItems that detects timeout errors (or a failure threshold) and short-circuits the remaining items to UNVERIFIED.

## 5) Validation tests are stubbed out (Severity: Low)
Evidence:
- tests/unit/validation.test.ts:323-497 contains it.todo blocks for buildValidationPrompt, parseValidationResponse, validateSingleItem, and validateItems.
- PRD testing strategy calls for a mocked Perplexity validation flow.
Impact:
- Core validation behaviors (schema enforcement, batching, timeout handling) are untested, increasing regression risk.
Recommendation:
- Implement the TODO tests and add fixture-driven validation flow coverage.
