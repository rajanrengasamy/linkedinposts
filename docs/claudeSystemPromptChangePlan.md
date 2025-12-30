# System Prompt Change Implementation Plan

**Document Created:** 2025-12-30
**Based On:** [claudeReviewSystemprompt.md](claudeReviewSystemprompt.md)
**Status:** PLANNING (Not yet executed)

---

## Executive Summary

This document provides a detailed implementation plan for the prompt improvements identified in the Claude Opus 4.5 system prompt review. The plan covers all 4 pipeline stages across 4 source files with 25 individual changes organized into 3 implementation phases.

**Scope:**
- 4 source files to modify
- 10 HIGH priority changes
- 9 MEDIUM priority changes
- 6 LOW priority changes
- 5 Cross-cutting improvements

**Estimated Impact:**
- 30-40% improvement in scoring consistency (per review)
- Significantly improved post engagement and readability
- Better verification accuracy and reasoning transparency
- More consistent and professional image output

---

## Table of Contents

1. [File Inventory & Line References](#1-file-inventory--line-references)
2. [Phase 1: High-Impact Quick Wins](#2-phase-1-high-impact-quick-wins)
3. [Phase 2: Refinements](#3-phase-2-refinements)
4. [Phase 3: Polish & Consistency](#4-phase-3-polish--consistency)
5. [Cross-Cutting Changes](#5-cross-cutting-changes)
6. [Detailed Change Specifications](#6-detailed-change-specifications)
7. [Testing & Validation Strategy](#7-testing--validation-strategy)
8. [Risk Assessment](#8-risk-assessment)
9. [Implementation Checklist](#9-implementation-checklist)

---

## 1. File Inventory & Line References

### Source Files to Modify

| File | Function | Current Lines | Primary Changes |
|------|----------|---------------|-----------------|
| `src/validation/perplexity.ts` | `buildValidationPrompt()` | 350-434 | CoT, Confidence calibration, Quote fuzzy matching |
| `src/scoring/gemini.ts` | `buildScoringPrompt()` | 413-468 | Scoring rubrics, Tie-breaking, Negative signals |
| `src/synthesis/gpt.ts` | `SYSTEM_PROMPT` + `buildSynthesisPrompt()` | 134-142, 624-736 | Post structure, Hook templates, Tone calibration |
| `src/image/nanoBanana.ts` | `buildInfographicPrompt()` + `STYLE_INSTRUCTIONS` | 233-367 | Negative prompting, Composition, Typography |

### Verification of Line Numbers

All line numbers have been verified against current source code:

- **perplexity.ts:350-434**: `buildValidationPrompt()` - VERIFIED ✓
- **gemini.ts:413-468**: `buildScoringPrompt()` - VERIFIED ✓
- **gpt.ts:134-142**: `SYSTEM_PROMPT` constant - VERIFIED ✓
- **gpt.ts:624-736**: `buildSynthesisPrompt()` - VERIFIED ✓
- **nanoBanana.ts:233-257**: `STYLE_INSTRUCTIONS` - VERIFIED ✓
- **nanoBanana.ts:293-367**: `buildInfographicPrompt()` - VERIFIED ✓

---

## 2. Phase 1: High-Impact Quick Wins

**Target:** Highest ROI changes with lowest implementation effort

### 2.1 Validation Stage (perplexity.ts)

#### Change V-H1: Add Chain-of-Thought Guidance
**Priority:** HIGH | **Effort:** Low | **Impact:** High

**Location:** `buildValidationPrompt()` lines 391-398

**Current Code:**
```typescript
## Verification Tasks

1. **Cross-check the content** against web sources to verify accuracy
2. **Verify author attribution** - confirm this content is actually by/about the claimed author
3. **Verify any quotes** - find original sources for quoted text
4. **Find corroborating sources** - identify independent sources that confirm the claims
5. **Determine if primary source** - check if this is from the author's own website, official publication, or verified social media
6. **Verify publication date** - identify when this content was originally published
```

**New Code (Replace entire section):**
```typescript
## Verification Process

IMPORTANT: Think step-by-step. For each verification task, explain your reasoning before providing the result.

### Verification Tasks

1. **Cross-check the content** against web sources to verify accuracy
   - First, identify the key verifiable claims in the content
   - Search for each claim independently
   - Compare findings across multiple sources
   - Document your reasoning for the verification level assigned

2. **Verify author attribution** - Determine the relationship:
   - Is this content authored by the claimed person?
   - Is this content quoting the claimed person?
   - Is this content about the claimed person (but written by others)?
   - Note the relationship type in your verification notes

3. **Verify any quotes** - find original sources for quoted text
   - If an exact match is found, mark verified=true with the source
   - If a close paraphrase is found (>80% semantic similarity), still mark verified=true but add a note indicating it's a paraphrase
   - Only mark verified=false if the quote appears fabricated or significantly altered

4. **Find corroborating sources** - identify independent sources that confirm the claims
   - Evaluate source reliability (prefer official sources, news outlets, academic publications)
   - Cross-reference multiple sources when possible

5. **Determine if primary source** - check if this is from the author's own website, official publication, or verified social media

6. **Verify publication date** - identify when this content was originally published
```

---

#### Change V-H2: Add Confidence Calibration Guide
**Priority:** HIGH | **Effort:** Low | **Impact:** Medium

**Location:** Insert AFTER the "Response Format" section (after line 426)

**New Code (Insert before "Important:"):**
```typescript
## Confidence Calibration Guide

Use this scale for your confidence score:
- 0.0-0.2: No sources found, cannot verify
- 0.2-0.4: Partial match found, or single unreliable source
- 0.4-0.6: One reliable source confirms the content
- 0.6-0.8: Multiple independent sources confirm the content
- 0.8-0.95: Primary source found with direct confirmation
- 0.95-1.0: Primary source with exact match (author's own verified account/publication)

## Handling Contradictions

If sources contradict each other:
- Note the contradiction in the "notes" array
- Set verificationLevel based on the preponderance of evidence
- Reduce confidence score proportionally to the level of disagreement
- Prefer primary sources over secondary sources when they conflict
```

---

### 2.2 Scoring Stage (gemini.ts)

#### Change S-H1: Add Detailed Scoring Rubrics
**Priority:** HIGH | **Effort:** Medium | **Impact:** Very High

**Location:** `buildScoringPrompt()` - Replace scoring dimensions section (lines 445-449)

**Current Code:**
```typescript
For each item, provide scores from 0-100:
- relevance: How relevant to the topic
- authenticity: Based on verification level (UNVERIFIED=low, SOURCE_CONFIRMED=medium, MULTISOURCE_CONFIRMED=high, PRIMARY_SOURCE=highest)
- recency: Based on publication date (recent=high, older=low, unknown=medium)
- engagementPotential: Likely to engage LinkedIn audience based on content quality and topic appeal
```

**New Code (Replace entire section):**
```typescript
## Scoring Rubrics

For each item, provide scores from 0-100 using these detailed rubrics:

### Relevance (0-100)
- 90-100: Directly addresses the topic with specific, actionable insights
- 70-89: Clearly related to the topic with useful information
- 50-69: Tangentially related, mentions the topic but lacks depth
- 30-49: Loosely connected, requires significant interpretation to relate
- 0-29: Off-topic or only superficially mentions related keywords

### Authenticity (0-100) - Base Score
- 80-100: Verified quotes with attribution, data from official sources
- 60-79: Paraphrased content with source references
- 40-59: Unattributed claims but plausible based on context
- 20-39: Unverified claims with no supporting evidence
- 0-19: Contradicts known facts or appears fabricated
Note: Verification boost is applied separately to this base score.

### Recency (0-100)
- 90-100: Published within last 7 days
- 70-89: Published within last 30 days
- 50-69: Published within last 90 days
- 30-49: Published within last year
- 0-29: Older than one year or date unknown

### Engagement Potential (0-100)
- 90-100: Contrarian/surprising insight, data-backed, highly shareable
- 70-89: Valuable insight likely to spark discussion
- 50-69: Standard industry content, moderately interesting
- 30-49: Generic advice or commonly known information
- 0-19: Dry, technical, or unengaging presentation

## Tie-Breaking Guidelines

When multiple items have similar scores:
1. Prefer PRIMARY_SOURCE items over lower verification levels
2. Prefer items with direct quotes over paraphrased content
3. Prefer items with specific data points over general statements
4. Prefer more recent items when other factors are equal

## Red Flags (Apply Score Penalties)

Reduce scores for items with:
- Clickbait headlines without substance (-20 to relevance)
- Promotional/advertising content (-30 to authenticity)
- Outdated information presented as current (-30 to recency)
- Controversial claims without evidence (-20 to authenticity)
- Excessive self-promotion (-20 to engagementPotential)

## Note on Engagement Metrics

High engagement (likes, comments, shares) is a positive signal but not definitive:
- Viral content isn't always high quality - use engagement as one factor among many
- Low engagement on recent content may indicate poor timing, not poor quality
```

---

#### Change S-H2: Make Reasoning Required with Structure
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Medium

**Location:** `buildScoringPrompt()` - Update requirements section (lines 461-465)

**Current Code:**
```typescript
Requirements:
- Include an entry for EVERY item ID provided
- All scores must be integers between 0 and 100
- Provide 2-3 brief reasoning points per item
- Return ONLY the JSON object, no additional text
```

**New Code:**
```typescript
Requirements:
- Include an entry for EVERY item ID provided
- All scores must be integers between 0 and 100
- Reasoning is REQUIRED. Provide exactly 3 points per item:
  1. Why this relevance score? (specific connection to topic)
  2. What supports/undermines authenticity? (sources, verification)
  3. Why this engagement potential? (what makes it shareable/discussable)
- Return ONLY the JSON object, no additional text

## Calibration Examples

A score of 85+ in relevance means: "This item directly answers the user's query with specific, usable information"
A score of 50 in relevance means: "This item is related but doesn't directly address what the user asked"
A score below 30 in relevance means: "This item is off-topic and should likely be excluded"
```

---

### 2.3 Synthesis Stage (gpt.ts)

#### Change SY-H1: Replace System Prompt
**Priority:** HIGH | **Effort:** Medium | **Impact:** Very High

**Location:** `SYSTEM_PROMPT` constant (lines 134-142)

**Current Code:**
```typescript
export const SYSTEM_PROMPT = `You are a professional LinkedIn content creator. Your task is to synthesize verified information into engaging LinkedIn posts.

CRITICAL RULES:
1. ONLY use claims provided in the input - never invent facts
2. Every quote MUST have a sourceUrl from the provided claims
3. Keep the post under 3000 characters
4. Include 3-5 relevant hashtags
5. Use professional but approachable tone
6. Always respond with valid JSON matching the requested schema`;
```

**New Code:**
```typescript
export const SYSTEM_PROMPT = `You are an expert LinkedIn content strategist who creates high-performing professional posts. Your posts achieve 3-5x average engagement because you understand:

1. ATTENTION: LinkedIn shows only first 2-3 lines before "see more" - make them count
2. STRUCTURE: Short paragraphs, white space, and visual hierarchy keep readers engaged
3. CREDIBILITY: Every claim must be backed by the provided verified sources
4. ACTION: Every post should prompt readers to think, feel, or do something specific

INVIOLABLE RULES:
- ONLY use facts, quotes, and statistics from the provided claims
- Every quote MUST include its sourceUrl from the claims
- Never invent, embellish, or extrapolate beyond the source material
- If claims are insufficient for the topic, acknowledge limitations rather than fabricate
- Keep the post under 3000 characters
- Include 3-5 relevant hashtags
- Always respond with valid JSON matching the requested schema`;
```

---

#### Change SY-H2: Enhance LinkedIn Post Structure Guidance
**Priority:** HIGH | **Effort:** Medium | **Impact:** Very High

**Location:** `buildSynthesisPrompt()` - Replace REQUIREMENTS section 1 (around lines 682-688)

**Current Code:**
```typescript
1. LinkedIn Post (max ${LINKEDIN_POST_MAX_LENGTH} characters):
   - Hook: Engaging first line that grabs attention
   - Body: 2-3 key insights using the verified claims
   - For each quote or statistic, use the EXACT text from claims above
   - Call to action at end
   - ${LINKEDIN_HASHTAGS_MIN}-${LINKEDIN_HASHTAGS_MAX} relevant hashtags
```

**New Code:**
```typescript
1. LinkedIn Post Structure (max ${LINKEDIN_POST_MAX_LENGTH} characters):

   Opening Hook (first 2 lines - CRITICAL, this appears above "...see more"):
   - Start with a surprising statistic, provocative question, or contrarian take
   - Create curiosity gap that compels readers to click "see more"
   - Examples: "Most people think X. They're wrong." / "After analyzing 1000+ posts, here's what works:"

   Body (2-3 key insights):
   - Use short paragraphs (1-3 sentences each)
   - Include ONE specific quote or statistic per insight
   - For each quote or statistic, use the EXACT text from claims above
   - Add line breaks between paragraphs for readability
   - Use bullet points or numbered lists where appropriate

   Closing:
   - Summarize the key takeaway in one sentence
   - Include a specific call-to-action (question to audience OR actionable next step)
   - Add ${LINKEDIN_HASHTAGS_MIN}-${LINKEDIN_HASHTAGS_MAX} hashtags on final line (mix of broad and niche)

   Formatting Rules:
   - Use line breaks liberally (LinkedIn rewards white space)
   - Avoid walls of text
   - Bold key phrases sparingly (using *asterisks* won't work - use CAPS or spacing instead)
```

---

#### Change SY-H3: Add Hook Templates
**Priority:** MEDIUM | **Effort:** Low | **Impact:** High

**Location:** Insert AFTER the LinkedIn Post Structure section in `buildSynthesisPrompt()`

**New Code (Insert after closing section):**
```typescript
## Hook Templates by Content Type

For Data/Statistics:
- "[X%] of [audience] don't realize [surprising fact]."
- "I analyzed [N] [things]. Here's what the data revealed:"

For Expert Insights:
- "[Expert name]'s take on [topic] challenges everything we thought we knew."
- "The best advice on [topic] I've ever heard came from an unexpected source:"

For Trends/Predictions:
- "[Topic] is about to change. Here's what's coming:"
- "Everyone's talking about [X]. But they're missing [Y]."

For Lessons/Takeaways:
- "After [experience/analysis], I learned [counter-intuitive lesson]."
- "The biggest mistake in [domain]? [Specific mistake]."
```

---

### 2.4 Image Generation Stage (nanoBanana.ts)

#### Change I-H1: Add Negative Prompting
**Priority:** HIGH | **Effort:** Low | **Impact:** High

**Location:** `buildInfographicPrompt()` - Add AFTER "Important:" section (around line 352)

**Current Code (ends with):**
```typescript
Important:
- Text must be crisp and readable
- Balanced composition
- Corporate/professional aesthetic
- No watermarks or artifacts`;
```

**New Code (Replace "Important:" section with expanded version):**
```typescript
Important:
- Text must be crisp and readable
- Balanced composition
- Corporate/professional aesthetic
- No watermarks or artifacts

MUST AVOID (Negative Prompts):
- Stock photo aesthetics or generic corporate imagery
- Busy backgrounds or distracting patterns
- Text that's too small to read at mobile resolution
- Gradients that make text unreadable
- More than 5 visual elements competing for attention
- Clip art or dated design elements
- Rounded corners on everything (overused aesthetic)
- Generic tech/business imagery (handshakes, light bulbs, gears, puzzle pieces)`;
```

---

#### Change I-H2: Add Composition Guidelines
**Priority:** HIGH | **Effort:** Low | **Impact:** High

**Location:** `buildInfographicPrompt()` - Add AFTER "Requirements:" section

**New Code (Insert after Resolution line):**
```typescript
Composition Guidelines:
- Title should occupy top 20-30% of visual space
- Visual weight should flow: Title → Primary statistic/quote → Supporting points
- Leave breathing room between elements (minimum 5% margins)
- Use the rule of thirds for element placement
- Ensure key content is visible when cropped to square (LinkedIn preview)
```

---

#### Change I-H3: Add Typography Specification
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Medium

**Location:** `buildInfographicPrompt()` - Add AFTER Composition Guidelines

**New Code:**
```typescript
Typography Requirements:
- Title: Bold, high contrast, minimum 5% of image height
- Body text: Regular weight, high readability
- Ensure minimum 4.5:1 contrast ratio for all text
- Maximum 3 font sizes in the design
- Avoid decorative fonts for body text
- Use sans-serif fonts (Helvetica, Inter, Roboto families)
```

---

## 3. Phase 2: Refinements

### 3.1 Validation Stage (perplexity.ts)

#### Change V-M1: Publication Date Format Guidance
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Low

**Location:** Within the JSON schema description (around line 425)

**Current Code:**
```typescript
"publishedAtVerified": "ISO 8601 datetime string" (optional, include if publication date was verified)
```

**New Code:**
```typescript
"publishedAtVerified": "ISO 8601 datetime string" (optional)
   - Use ISO 8601 format (e.g., "2025-01-15T10:30:00Z")
   - If only the date is known, use "2025-01-15T00:00:00Z"
   - If only month/year is known, use the first of the month
   - Omit this field entirely if publication date cannot be determined
```

---

### 3.2 Synthesis Stage (gpt.ts)

#### Change SY-M1: Add Tone Guidelines
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Medium

**Location:** Insert in `buildSynthesisPrompt()` AFTER Hook Templates section

**New Code:**
```typescript
## Tone Guidelines

Adapt your tone based on the topic:
- Technical topics: More formal, emphasize expertise, use industry terminology
- Leadership/culture topics: Warmer, use "we" language, be inspirational
- Career advice: Personal, use "you" language, be encouraging
- News/trends: Authoritative, neutral, factual

Regardless of topic:
- Avoid corporate jargon ("synergy", "leverage", "ecosystem")
- Write like a knowledgeable colleague, not a press release
- Use contractions naturally (it's, don't, we're)
- Be specific rather than general
```

---

#### Change SY-M2: Enhance keyQuotes Selection Guidance
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Medium

**Location:** `buildSynthesisPrompt()` - Replace REQUIREMENTS section 2 (around lines 689-692)

**Current Code:**
```typescript
2. keyQuotes Array:
   - Extract 2-4 key quotes used in the post
   - Each must have: quote, author, sourceUrl, verificationLevel
   - sourceUrl MUST match exactly from the claims above
```

**New Code:**
```typescript
2. keyQuotes Selection (2-4 quotes):
   Prioritize quotes that are:
   - From recognized authorities in the field
   - Specific and memorable (not generic statements)
   - Verifiable with PRIMARY_SOURCE or MULTISOURCE_CONFIRMED level
   - Directly support the main thesis of the post

   Avoid quotes that are:
   - Too long (truncate to ~150 characters if needed)
   - Generic platitudes anyone could have said
   - From unknown or unverifiable sources

   Each must have: quote, author, sourceUrl, verificationLevel
   sourceUrl MUST match exactly from the claims above
```

---

#### Change SY-M3: Enhance infographicBrief with Visual Thinking
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Medium

**Location:** `buildSynthesisPrompt()` - Replace REQUIREMENTS section 3 (around lines 693-698)

**Current Code:**
```typescript
3. infographicBrief:
   - title: Catchy title for visual
   - keyPoints: 3-5 bullet points summarizing main insights
   - suggestedStyle: "minimal", "data-heavy", or "quote-focused"
   - colorScheme: Optional color suggestion
```

**New Code:**
```typescript
3. infographicBrief Design:

   title: Should be the ONE thing viewers remember (max 8 words)

   keyPoints: Design for visual hierarchy (3-5 points):
   - First point: The most impactful/surprising element
   - Middle points: Supporting evidence or steps
   - Last point: Call-to-action or key takeaway

   suggestedStyle selection:
   - "minimal": Best for thought leadership, quotes, simple concepts
   - "data-heavy": Best when you have 2+ statistics to visualize
   - "quote-focused": Best when a single quote is the star of the content

   colorScheme: Suggest based on topic emotional tone:
   - Finance/Corporate: Blues, grays, gold accents
   - Tech/Innovation: Purple, cyan, electric blue
   - Health/Wellness: Greens, soft blues
   - Growth/Success: Orange, gold, warm tones
```

---

### 3.3 Image Generation Stage (nanoBanana.ts)

#### Change I-M1: Enhance Color Scheme Interpretation
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Medium

**Location:** Insert in `buildInfographicPrompt()` AFTER Typography Requirements

**New Code:**
```typescript
Color Scheme Application:
- Primary color: Use for title and key elements (60% of color usage)
- Secondary color: Use for supporting elements and accents (30%)
- Neutral: Use for text and backgrounds (10%)

When color scheme is general (e.g., "blue and white"):
- Select a specific shade appropriate for professional context
- Avoid pure primary colors (#0000FF) - use sophisticated variants
- Ensure sufficient contrast for accessibility
```

---

#### Change I-M2: Enhance Data Visualization Style
**Priority:** MEDIUM | **Effort:** Low | **Impact:** Medium

**Location:** Update `STYLE_INSTRUCTIONS['data-heavy']` (lines 244-250)

**Current Code:**
```typescript
'data-heavy': `Style Guidelines (Data-Heavy):
- Include charts, graphs, or statistical callouts
- Use number visualizations prominently
- Infographic-style data representations
- Clear data labels and annotations
- Comparison visuals where relevant
- Percentage bars, pie charts, or trend lines`,
```

**New Code:**
```typescript
'data-heavy': `Style Guidelines (Data-Heavy):
- Include charts, graphs, or statistical callouts
- Use number visualizations prominently
- Infographic-style data representations
- Clear data labels and annotations
- Comparison visuals where relevant

Data Visualization Selection:
- 1 number: Use large typography with supporting icon
- 2 numbers (comparison): Use side-by-side bars or before/after
- 3-4 numbers (progression): Use horizontal bar chart or timeline
- 5+ numbers: Use simplified pie/donut chart or ranked list
- Percentages: Donut charts or progress bars work well
- Growth/change: Arrow indicators with percentage change

Design the visualization to be understood in 3 seconds.`,
```

---

## 4. Phase 3: Polish & Consistency

### 4.1 Synthesis Stage (gpt.ts)

#### Change SY-L1: Add Handling for Thin Content
**Priority:** LOW | **Effort:** Low | **Impact:** Medium

**Location:** Insert at END of `buildSynthesisPrompt()` BEFORE the JSON format specification

**New Code:**
```typescript
## Handling Limited Claims

If provided claims are sparse:
- Keep the post shorter (quality over quantity)
- Focus on the ONE strongest insight rather than stretching
- Use questions to engage audience rather than making unsupported statements
- Acknowledge when more research is needed: "The data on this is still emerging..."

Do NOT:
- Add generic advice not supported by claims
- Repeat the same point in different words
- Make broad claims beyond what sources support
```

---

#### Change SY-L2: Add Engagement Optimization Tips
**Priority:** LOW | **Effort:** Low | **Impact:** Medium

**Location:** Insert AFTER Tone Guidelines section

**New Code:**
```typescript
## Engagement Optimization

Techniques that increase engagement:
- Ask a specific question (not "What do you think?" but "Have you experienced X?")
- Use "you" language to make it personal
- Include a mild controversy or hot take
- End with a concrete action readers can take today

Techniques to avoid:
- Engagement bait ("Like if you agree!")
- Vague calls-to-action ("Let me know your thoughts")
- Self-promotional plugs
- Excessive hashtags (>5)
```

---

### 4.2 Image Generation Stage (nanoBanana.ts)

#### Change I-L1: Add Mobile-First Guidance
**Priority:** LOW | **Effort:** Low | **Impact:** Low

**Location:** Insert AFTER Typography Requirements

**New Code:**
```typescript
Mobile Optimization:
- 70%+ of LinkedIn views are mobile - design for small screens
- Title must be readable at thumbnail size
- Key statistic/insight should be visible even when cropped
- Test mental thumbnail: Would the core message survive 100x100px preview?
```

---

## 5. Cross-Cutting Changes

These changes should be applied consistently across all 4 files.

### 5.1 Standardize Delimiter Conventions

**Applies To:** All 4 files

**Recommendation:** Audit and standardize all delimiter patterns across the codebase to use consistent format:

```typescript
// Standard delimiter format
<<<SECTION_NAME_START>>>
<<<SECTION_NAME_END>>>
```

**Current State:**
- perplexity.ts: `<<<CONTENT_START>>>`, `<<<CONTEXT_START>>>`
- gemini.ts: `<<<ITEM_START>>>`, `<<<USER_PROMPT_START>>>`
- gpt.ts: `<<<USER_PROMPT_START>>>`, `<<<VERIFIED_CLAIMS_START>>>`
- nanoBanana.ts: No delimiters (user content in prompt body)

**Action:** No change needed - current delimiters are already consistent within the expected pattern.

---

### 5.2 Add Error Recovery Guidance

**Applies To:** All 4 files (add to each prompt)

**Recommended Addition (standardized for all prompts):**
```typescript
## Error Handling

If you encounter any of these situations, handle as follows:
- Ambiguous input: State your interpretation before proceeding
- Insufficient information: Acknowledge gaps rather than fabricating
- Conflicting requirements: Prioritize [specific priority order for this stage]
- Unable to complete: Return partial results with explanatory notes
```

**Stage-Specific Priority Orders:**
- **Validation:** Accuracy > Completeness > Speed
- **Scoring:** Consistency > Speed > Granularity
- **Synthesis:** Source Attribution > Engagement > Length
- **Image:** Readability > Aesthetics > Complexity

---

### 5.3 Add JSON Self-Validation Instructions

**Applies To:** perplexity.ts, gemini.ts, gpt.ts (all JSON-producing stages)

**Recommended Addition (add before "Return ONLY" instruction):**
```typescript
Before returning your response:
1. Verify JSON is syntactically valid
2. Check all required fields are present
3. Validate arrays are non-empty where required
4. Ensure all URLs are complete (not truncated)
```

---

## 6. Detailed Change Specifications

### Change Implementation Matrix

| ID | File | Function/Location | Priority | Type | LOC Change |
|----|------|-------------------|----------|------|------------|
| V-H1 | perplexity.ts | buildValidationPrompt() L391-398 | HIGH | Replace | +25 |
| V-H2 | perplexity.ts | After L426 | HIGH | Insert | +18 |
| V-M1 | perplexity.ts | L425 | MEDIUM | Modify | +4 |
| S-H1 | gemini.ts | buildScoringPrompt() L445-449 | HIGH | Replace | +55 |
| S-H2 | gemini.ts | L461-465 | MEDIUM | Replace | +12 |
| SY-H1 | gpt.ts | SYSTEM_PROMPT L134-142 | HIGH | Replace | +8 |
| SY-H2 | gpt.ts | buildSynthesisPrompt() L682-688 | HIGH | Replace | +28 |
| SY-H3 | gpt.ts | After SY-H2 | MEDIUM | Insert | +15 |
| SY-M1 | gpt.ts | After SY-H3 | MEDIUM | Insert | +14 |
| SY-M2 | gpt.ts | L689-692 | MEDIUM | Replace | +12 |
| SY-M3 | gpt.ts | L693-698 | MEDIUM | Replace | +18 |
| SY-L1 | gpt.ts | Before JSON format | LOW | Insert | +12 |
| SY-L2 | gpt.ts | After SY-M1 | LOW | Insert | +14 |
| I-H1 | nanoBanana.ts | After L352 | HIGH | Expand | +10 |
| I-H2 | nanoBanana.ts | After Requirements | HIGH | Insert | +6 |
| I-H3 | nanoBanana.ts | After I-H2 | MEDIUM | Insert | +7 |
| I-M1 | nanoBanana.ts | After I-H3 | MEDIUM | Insert | +9 |
| I-M2 | nanoBanana.ts | STYLE_INSTRUCTIONS L244-250 | MEDIUM | Replace | +12 |
| I-L1 | nanoBanana.ts | After Typography | LOW | Insert | +5 |

**Total Estimated LOC Changes:** ~259 lines added/modified

---

## 7. Testing & Validation Strategy

### 7.1 Unit Testing

For each modified function, verify:
- Prompt string is generated without errors
- Prompt length is within API limits
- Sanitization is applied correctly to user inputs
- Template interpolation works for edge cases

### 7.2 Integration Testing

Run the full pipeline with:
1. **Minimal input**: Single source, short content
2. **Maximal input**: 50 sources, maximum content length
3. **Edge cases**: Empty quotes, unicode characters, special characters

### 7.3 A/B Testing (Recommended)

If possible, compare outputs between:
- Current prompts vs. Phase 1 changes
- Phase 1 vs. Phase 1+2 changes
- Phase 1+2 vs. Complete implementation

### 7.4 Quality Metrics to Track

| Stage | Metric | Target |
|-------|--------|--------|
| Validation | Confidence score distribution | More even spread 0.3-0.9 |
| Validation | Verification level accuracy | Fewer false positives |
| Scoring | Score consistency across similar items | ±5 points variance |
| Scoring | Reasoning quality | 3 specific points per item |
| Synthesis | Post length | 800-2500 chars (optimal) |
| Synthesis | Hashtag count | Exactly 3-5 |
| Synthesis | Source attribution | 100% quotes have sourceUrl |
| Image | Generation success rate | >95% |
| Image | Mobile readability | Title visible at 100px |

---

## 8. Risk Assessment

### 8.1 Low Risk Changes

- Adding documentation/guidelines (does not change logic)
- Inserting new sections without modifying existing text
- Adding optional recommendations

### 8.2 Medium Risk Changes

- Replacing entire prompt sections (verify no semantic drift)
- Modifying JSON schema descriptions (ensure backward compatibility)
- Adding required fields to reasoning output

### 8.3 High Risk Changes (Require Extra Testing)

| Change | Risk | Mitigation |
|--------|------|------------|
| S-H1 Scoring Rubrics | Model may interpret score ranges differently | Test with 20+ items, verify distribution |
| SY-H1 System Prompt | May affect overall output style | A/B test before full deployment |
| I-H1 Negative Prompts | Image model may over-restrict output | Test each negative prompt individually |

### 8.4 Rollback Strategy

All changes are prompt-only (no code logic changes), so rollback is straightforward:
1. Keep backup copies of original prompts
2. Git commit after each phase
3. If issues detected, revert specific prompt sections

---

## 9. Implementation Checklist

### Phase 1 Checklist (HIGH Priority)

- [ ] **V-H1**: Add Chain-of-Thought to perplexity.ts
- [ ] **V-H2**: Add Confidence Calibration to perplexity.ts
- [ ] **S-H1**: Add Scoring Rubrics to gemini.ts
- [ ] **SY-H1**: Replace SYSTEM_PROMPT in gpt.ts
- [ ] **SY-H2**: Enhance Post Structure in gpt.ts
- [ ] **I-H1**: Add Negative Prompting to nanoBanana.ts
- [ ] **I-H2**: Add Composition Guidelines to nanoBanana.ts
- [ ] Run unit tests
- [ ] Run integration test with sample data
- [ ] Git commit Phase 1

### Phase 2 Checklist (MEDIUM Priority)

- [ ] **S-H2**: Make Reasoning Required in gemini.ts
- [ ] **V-M1**: Publication Date Format in perplexity.ts
- [ ] **SY-H3**: Add Hook Templates to gpt.ts
- [ ] **SY-M1**: Add Tone Guidelines to gpt.ts
- [ ] **SY-M2**: Enhance keyQuotes Selection in gpt.ts
- [ ] **SY-M3**: Enhance infographicBrief in gpt.ts
- [ ] **I-H3**: Add Typography Specification to nanoBanana.ts
- [ ] **I-M1**: Enhance Color Scheme in nanoBanana.ts
- [ ] **I-M2**: Enhance Data Visualization in nanoBanana.ts
- [ ] Run integration test
- [ ] Git commit Phase 2

### Phase 3 Checklist (LOW Priority + Cross-Cutting)

- [ ] **SY-L1**: Add Thin Content Handling to gpt.ts
- [ ] **SY-L2**: Add Engagement Tips to gpt.ts
- [ ] **I-L1**: Add Mobile Optimization to nanoBanana.ts
- [ ] **CC-1**: Add Error Recovery to all prompts
- [ ] **CC-2**: Add JSON Self-Validation to JSON-producing stages
- [ ] Run full integration test
- [ ] Git commit Phase 3
- [ ] Final review and documentation update

---

## Appendix A: Original vs. New Prompt Comparison

### Validation Prompt Length

| Version | Estimated Characters | Estimated Tokens |
|---------|---------------------|------------------|
| Current | ~2,400 | ~600 |
| After Changes | ~3,200 | ~800 |
| Increase | +33% | +33% |

### Scoring Prompt Length

| Version | Estimated Characters | Estimated Tokens |
|---------|---------------------|------------------|
| Current | ~650 + items | ~160 + items |
| After Changes | ~1,800 + items | ~450 + items |
| Increase | +177% | +177% |

### Synthesis Prompt Length

| Version | Estimated Characters | Estimated Tokens |
|---------|---------------------|------------------|
| Current | ~1,500 + claims | ~375 + claims |
| After Changes | ~2,800 + claims | ~700 + claims |
| Increase | +87% | +87% |

### Image Prompt Length

| Version | Estimated Characters | Estimated Tokens |
|---------|---------------------|------------------|
| Current | ~800 | ~200 |
| After Changes | ~1,300 | ~325 |
| Increase | +62% | +62% |

**Note:** Increased prompt length will slightly increase API costs. However, the expected improvement in output quality should more than justify the additional cost.

---

## Appendix B: Dependencies & Prerequisites

### No External Dependencies

All changes are prompt text modifications only. No new packages, APIs, or configuration changes are required.

### Internal Dependencies

Changes should be applied in order within each file to maintain proper section organization:

**gpt.ts Order:**
1. SYSTEM_PROMPT (line 134)
2. buildSynthesisPrompt() modifications in order:
   - Post Structure (replaces existing)
   - Hook Templates (insert after)
   - Tone Guidelines (insert after)
   - Engagement Tips (insert after)
   - keyQuotes (replaces existing)
   - infographicBrief (replaces existing)
   - Thin Content Handling (insert before JSON)

**nanoBanana.ts Order:**
1. STYLE_INSTRUCTIONS (line 233)
2. buildInfographicPrompt() modifications in order:
   - Composition Guidelines (insert)
   - Typography Requirements (insert)
   - Mobile Optimization (insert)
   - Color Scheme Application (insert)
   - Negative Prompts (replace Important section)

---

*Document prepared for implementation planning. All changes are pending approval and testing before execution.*
