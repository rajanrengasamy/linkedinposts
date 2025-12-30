# System Prompt Review: LinkedIn Quotes Pipeline

**Reviewer:** Claude Opus 4.5
**Date:** 2025-12-30
**Scope:** Complete review of all LLM system prompts in the multi-model pipeline

---

## Executive Summary

This document provides a comprehensive review of all system prompts used across the LinkedIn Quotes pipeline. The pipeline employs four distinct LLM stages, each with specialized prompts:

1. **Validation (Perplexity sonar-reasoning-pro)** - Fact-checking and source verification
2. **Scoring (Gemini 3 Flash)** - Content relevance and quality assessment
3. **Synthesis (GPT-5.2 Thinking)** - LinkedIn post generation
4. **Image Generation (Nano Banana Pro)** - Infographic creation

Overall, the prompts are well-structured with strong security measures. However, several improvements could enhance output quality, consistency, and robustness.

---

## Table of Contents

1. [Stage 1: Validation Prompt (Perplexity)](#stage-1-validation-prompt-perplexity)
2. [Stage 2: Scoring Prompt (Gemini)](#stage-2-scoring-prompt-gemini)
3. [Stage 3: Synthesis Prompt (GPT-5.2)](#stage-3-synthesis-prompt-gpt-52)
4. [Stage 4: Image Generation Prompt (Nano Banana Pro)](#stage-4-image-generation-prompt-nano-banana-pro)
5. [Cross-Cutting Concerns](#cross-cutting-concerns)
6. [Priority Matrix](#priority-matrix)
7. [Implementation Recommendations](#implementation-recommendations)

---

## Stage 1: Validation Prompt (Perplexity)

**File:** `src/validation/perplexity.ts` (lines 350-434)
**Function:** `buildValidationPrompt()`

### Current Prompt Structure

```
You are a fact-checking assistant. Your task is to verify the following content...

## Content to Verify
- Author, Handle, Source URL
- Content (wrapped in delimiters)

## Original Context
- User search prompt (wrapped in delimiters)

## Verification Tasks
1. Cross-check content
2. Verify author attribution
3. Verify quotes
4. Find corroborating sources
5. Determine if primary source
6. Verify publication date

## Verification Level Definitions
- UNVERIFIED, SOURCE_CONFIRMED, MULTISOURCE_CONFIRMED, PRIMARY_SOURCE

## Response Format
- JSON schema specification
```

### Strengths

| Aspect | Assessment |
|--------|------------|
| Security | Excellent - Uses structured delimiters (`<<<>>>`) to prevent prompt injection |
| Structure | Clear hierarchical organization with explicit sections |
| Output Format | Well-defined JSON schema with type constraints |
| Task Specificity | Six distinct verification tasks provide comprehensive coverage |

### Issues & Improvements

#### HIGH PRIORITY

**Issue 1: Missing Chain-of-Thought (CoT) Guidance**

The prompt asks for verification results but doesn't explicitly request the reasoning process. Perplexity's sonar-reasoning-pro model benefits significantly from explicit CoT prompting.

**Current:**
```
1. **Cross-check the content** against web sources to verify accuracy
```

**Recommended:**
```
1. **Cross-check the content** against web sources to verify accuracy
   - First, identify the key claims in the content
   - Search for each claim independently
   - Compare findings across multiple sources
   - Document your reasoning for the verification level assigned
```

**Impact:** Better reasoning transparency, more accurate verification levels, improved confidence scores.

---

**Issue 2: Ambiguous Confidence Score Guidance**

The prompt says "Confidence should reflect your certainty" but provides no calibration guidance. This leads to inconsistent confidence values.

**Current:**
```
- Confidence should reflect your certainty in the verification (0.0 = no confidence, 1.0 = fully confident)
```

**Recommended:**
```
- Confidence scoring guide:
  - 0.0-0.3: Unable to find any corroborating sources
  - 0.3-0.5: Found partial matches or similar content but not exact
  - 0.5-0.7: Found one reliable source confirming the content
  - 0.7-0.9: Found multiple independent sources confirming the content
  - 0.9-1.0: Found primary source (author's own publication) with exact match
```

**Impact:** More consistent confidence scores across items, better downstream ranking.

---

**Issue 3: Quote Verification Lacks Fuzzy Matching Instruction**

The prompt doesn't account for paraphrased or slightly modified quotes, which are common in social media reposts.

**Recommended Addition:**
```
Note on quote verification:
- If an exact match is found, mark verified=true with the source
- If a close paraphrase is found (>80% semantic similarity), still mark verified=true
  but add a note indicating it's a paraphrase
- Only mark verified=false if the quote appears fabricated or significantly altered
```

**Impact:** Reduces false negatives for legitimate quotes that have been slightly paraphrased.

---

#### MEDIUM PRIORITY

**Issue 4: Missing Publication Date Format Guidance**

The prompt asks for `publishedAtVerified` in ISO 8601 but doesn't specify handling of partial dates.

**Recommended Addition:**
```
- publishedAtVerified: Use ISO 8601 format (e.g., "2025-01-15T10:30:00Z")
  - If only the date is known, use "2025-01-15T00:00:00Z"
  - If only month/year is known, use the first of the month
  - Omit this field entirely if publication date cannot be determined
```

---

**Issue 5: No Handling for Contradictory Sources**

When sources disagree, the model has no guidance on how to proceed.

**Recommended Addition:**
```
Handling contradictions:
- If sources contradict each other, note this in the "notes" array
- Set verificationLevel based on the preponderance of evidence
- Reduce confidence score proportionally to the level of disagreement
- Prefer primary sources over secondary sources when they conflict
```

---

#### LOW PRIORITY

**Issue 6: Author Attribution Could Be More Specific**

The prompt asks to "verify author attribution" but doesn't distinguish between:
- Content BY the author (they wrote it)
- Content ABOUT the author (someone else wrote about them)
- Content QUOTING the author (their words in someone else's article)

**Recommended Clarification:**
```
2. **Verify author attribution** - Determine the relationship:
   - Is this content authored by the claimed person?
   - Is this content quoting the claimed person?
   - Is this content about the claimed person (but written by others)?
   Note the relationship type in your verification notes.
```

---

### Recommended Revised Prompt (Key Sections)

```
You are a fact-checking assistant specializing in content verification. Your task is to systematically verify the following content using web searches and reasoning.

IMPORTANT: Think step-by-step. For each verification task, explain your reasoning before providing the result.

## Verification Process

For each piece of content:
1. Identify the key verifiable claims
2. Search for corroborating sources for each claim
3. Evaluate source reliability (prefer official sources, news outlets, academic publications)
4. Cross-reference multiple sources when possible
5. Document your reasoning chain

## Confidence Calibration

Use this scale for your confidence score:
- 0.0-0.2: No sources found, cannot verify
- 0.2-0.4: Partial match found, or single unreliable source
- 0.4-0.6: One reliable source confirms the content
- 0.6-0.8: Multiple independent sources confirm the content
- 0.8-0.95: Primary source found with direct confirmation
- 0.95-1.0: Primary source with exact match (author's own verified account/publication)

[Rest of prompt...]
```

---

## Stage 2: Scoring Prompt (Gemini)

**File:** `src/scoring/gemini.ts` (lines 413-468)
**Function:** `buildScoringPrompt()`

### Current Prompt Structure

```
You are a content scoring assistant. Score each item's potential for a LinkedIn post...

Topic: [User prompt wrapped in delimiters]

Scoring dimensions (0-100):
- relevance
- authenticity
- recency
- engagementPotential

Items to score: [Formatted items with delimiters]

Output: JSON with scores array
```

### Strengths

| Aspect | Assessment |
|--------|------------|
| Clarity | Clear 4-dimension scoring framework |
| Security | Proper delimiter usage for user content |
| Output Format | Well-structured JSON specification |
| Batch Processing | Handles multiple items efficiently |

### Issues & Improvements

#### HIGH PRIORITY

**Issue 1: Scoring Dimensions Lack Detailed Rubrics**

Each dimension has only a one-line description. Without detailed rubrics, scoring will be inconsistent.

**Current:**
```
- relevance: How relevant to the topic
- authenticity: Based on verification level (UNVERIFIED=low, SOURCE_CONFIRMED=medium, ...)
```

**Recommended:**
```
## Scoring Rubrics

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
```

**Impact:** 30-40% improvement in scoring consistency expected.

---

**Issue 2: No Tie-Breaking or Edge Case Guidance**

When items have similar scores, there's no guidance on how to differentiate.

**Recommended Addition:**
```
## Tie-Breaking Guidelines

When multiple items have similar scores:
1. Prefer PRIMARY_SOURCE items over lower verification levels
2. Prefer items with direct quotes over paraphrased content
3. Prefer items with specific data points over general statements
4. Prefer more recent items when other factors are equal
```

---

**Issue 3: Missing Negative Signal Detection**

The prompt doesn't instruct the model to identify and penalize problematic content.

**Recommended Addition:**
```
## Red Flags (Apply Score Penalties)

Reduce scores for items with:
- Clickbait headlines without substance (-20 to relevance)
- Promotional/advertising content (-30 to authenticity)
- Outdated information presented as current (-30 to recency)
- Controversial claims without evidence (-20 to authenticity)
- Excessive self-promotion (-20 to engagementPotential)
```

---

#### MEDIUM PRIORITY

**Issue 4: Reasoning Field Is Optional and Underspecified**

The `reasoning` array is optional and only says "2-3 brief points". This loses valuable signal.

**Recommended:**
```
- reasoning: REQUIRED. Provide exactly 3 points:
  1. Why this relevance score? (specific connection to topic)
  2. What supports/undermines authenticity? (sources, verification)
  3. Why this engagement potential? (what makes it shareable/discussable)
```

---

**Issue 5: No Calibration Anchors**

Without example scores, the model may drift in its interpretations.

**Recommended Addition at End:**
```
## Calibration Examples

A score of 85+ in relevance means: "This item directly answers the user's query with specific, usable information"
A score of 50 in relevance means: "This item is related but doesn't directly address what the user asked"
A score below 30 in relevance means: "This item is off-topic and should likely be excluded"
```

---

#### LOW PRIORITY

**Issue 6: Engagement Metrics Not Weighted**

The prompt shows engagement data but doesn't explain how to use it.

**Recommended Addition:**
```
Note on engagement metrics:
- High engagement (likes, comments, shares) is a positive signal but not definitive
- Viral content isn't always high quality - use engagement as one factor among many
- Low engagement on recent content may indicate poor timing, not poor quality
```

---

### Recommended System Instruction Addition

Consider adding a system-level instruction before the main prompt:

```
SYSTEM: You are an expert content curator specializing in LinkedIn professional content.
You evaluate content based on its potential to inform, engage, and resonate with
professional audiences. Your scoring should be:
- Calibrated: Scores should form a reasonable distribution, not cluster at extremes
- Consistent: Similar content should receive similar scores
- Justified: Every score should have a clear rationale
```

---

## Stage 3: Synthesis Prompt (GPT-5.2)

**File:** `src/synthesis/gpt.ts` (lines 134-142 for SYSTEM_PROMPT, lines 624-736 for buildSynthesisPrompt())

### Current Prompt Structure

**System Prompt:**
```
You are a professional LinkedIn content creator. Your task is to synthesize verified
information into engaging LinkedIn posts.

CRITICAL RULES:
1. ONLY use claims provided in the input - never invent facts
2. Every quote MUST have a sourceUrl from the provided claims
3. Keep the post under 3000 characters
4. Include 3-5 relevant hashtags
5. Use professional but approachable tone
6. Always respond with valid JSON matching the requested schema
```

**User Prompt Template:**
```
Create a professional LinkedIn post about the following topic.
[User prompt in delimiters]

USE ONLY the following verified claims...
[Claims in delimiters]

Source Summary: [counts by verification level]

REQUIREMENTS:
1. LinkedIn Post specifications
2. keyQuotes Array requirements
3. infographicBrief requirements
4. factCheckSummary requirements

JSON output format specification
```

### Strengths

| Aspect | Assessment |
|--------|------------|
| Provenance | Excellent emphasis on source attribution |
| Security | Strong delimiter system preventing injection |
| Output Structure | Comprehensive JSON schema with all needed fields |
| Constraint Enforcement | Clear character limits and required elements |

### Issues & Improvements

#### HIGH PRIORITY

**Issue 1: No LinkedIn Post Structure Guidance**

The prompt specifies requirements but doesn't guide the actual structure of an engaging LinkedIn post.

**Current:**
```
1. LinkedIn Post (max 3000 characters):
   - Hook: Engaging first line that grabs attention
   - Body: 2-3 key insights using the verified claims
   - Call to action at end
   - 3-5 relevant hashtags
```

**Recommended:**
```
1. LinkedIn Post Structure (max 3000 characters):

   Opening Hook (first 2 lines - CRITICAL, this appears above "...see more"):
   - Start with a surprising statistic, provocative question, or contrarian take
   - Create curiosity gap that compels readers to click "see more"
   - Examples: "Most people think X. They're wrong." / "After analyzing 1000+ posts, here's what works:"

   Body (2-3 key insights):
   - Use short paragraphs (1-3 sentences each)
   - Include ONE specific quote or statistic per insight
   - Add line breaks between paragraphs for readability
   - Use bullet points or numbered lists where appropriate

   Closing:
   - Summarize the key takeaway in one sentence
   - Include a specific call-to-action (question to audience OR actionable next step)
   - Add 3-5 hashtags on final line (mix of broad and niche)

   Formatting Rules:
   - Use line breaks liberally (LinkedIn rewards white space)
   - Avoid walls of text
   - Bold key phrases sparingly (using *asterisks* won't work - use CAPS or spacing instead)
```

**Impact:** Significantly improved post engagement and readability.

---

**Issue 2: Hook Examples Are Generic**

The prompt mentions "hook" but doesn't provide templates for different content types.

**Recommended Addition:**
```
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

**Issue 3: No Tone/Voice Calibration**

"Professional but approachable" is too vague. Different topics warrant different tones.

**Recommended Addition:**
```
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

#### MEDIUM PRIORITY

**Issue 4: keyQuotes Selection Guidance Missing**

The prompt requires 2-4 key quotes but doesn't explain which quotes to prioritize.

**Recommended Addition:**
```
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
```

---

**Issue 5: infographicBrief Lacks Visual Thinking Guidance**

The prompt asks for an infographic brief but doesn't help the model think visually.

**Recommended Enhancement:**
```
3. infographicBrief Design:

   Title: Should be the ONE thing viewers remember (max 8 words)

   keyPoints: Design for visual hierarchy:
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

#### LOW PRIORITY

**Issue 6: No Guidance on Handling Thin Content**

When claims are sparse, the model may pad with generic filler.

**Recommended Addition:**
```
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

**Issue 7: Missing Engagement Hooks**

No guidance on specific techniques that drive LinkedIn engagement.

**Recommended Addition:**
```
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

### Recommended Revised System Prompt

```
You are an expert LinkedIn content strategist who creates high-performing professional posts.
Your posts achieve 3-5x average engagement because you understand:

1. ATTENTION: LinkedIn shows only first 2-3 lines before "see more" - make them count
2. STRUCTURE: Short paragraphs, white space, and visual hierarchy keep readers engaged
3. CREDIBILITY: Every claim must be backed by the provided verified sources
4. ACTION: Every post should prompt readers to think, feel, or do something specific

INVIOLABLE RULES:
- ONLY use facts, quotes, and statistics from the provided claims
- Every quote MUST include its sourceUrl from the claims
- Never invent, embellish, or extrapolate beyond the source material
- If claims are insufficient for the topic, acknowledge limitations rather than fabricate
```

---

## Stage 4: Image Generation Prompt (Nano Banana Pro)

**File:** `src/image/nanoBanana.ts` (lines 233-367)
**Function:** `buildInfographicPrompt()` + `STYLE_INSTRUCTIONS`

### Current Prompt Structure

```
Create a professional infographic for LinkedIn:

Title: [sanitized title]

Key Points:
[formatted key points]

[Style-specific instructions based on minimal/data-heavy/quote-focused]

Color Scheme: [sanitized scheme or default]

Requirements:
- Clean, modern professional design
- Legible text
- High visual hierarchy
- Data visualization where appropriate
- Suitable for LinkedIn sharing
- Professional quality output
- Resolution: [size]

Important:
- Text must be crisp and readable
- Balanced composition
- Corporate/professional aesthetic
- No watermarks or artifacts
```

### Style Instructions

```
STYLE_INSTRUCTIONS = {
  minimal: "Use generous whitespace, simple icons, limited colors (2-3), typography focus...",
  'data-heavy': "Include charts, graphs, statistical callouts, data visualizations...",
  'quote-focused': "Large prominent quote text, elegant quotation marks, author attribution..."
}
```

### Strengths

| Aspect | Assessment |
|--------|------------|
| Style Customization | Three distinct styles with clear differentiation |
| Input Sanitization | Proper sanitization and truncation of all inputs |
| LinkedIn Focus | Specific mention of LinkedIn suitability |
| Quality Constraints | Clear requirements for readability and professionalism |

### Issues & Improvements

#### HIGH PRIORITY

**Issue 1: No Negative Prompting**

Image models benefit greatly from explicit negative prompts telling them what NOT to include. Current prompt only says what to do.

**Recommended Addition:**
```
AVOID (Negative Prompts):
- Stock photo aesthetics or generic corporate imagery
- Busy backgrounds or distracting patterns
- Text that's too small to read at mobile resolution
- Gradients that make text unreadable
- More than 5 visual elements competing for attention
- Clip art or dated design elements
- Rounded corners on everything (oversused aesthetic)
- Generic tech/business imagery (handshakes, light bulbs, gears)
```

---

**Issue 2: No Composition Guidance**

The prompt doesn't guide visual hierarchy or layout principles.

**Recommended Addition:**
```
Composition Guidelines:
- Title should occupy top 20-30% of visual space
- Visual weight should flow: Title → Primary statistic/quote → Supporting points
- Leave breathing room between elements (minimum 5% margins)
- Use the rule of thirds for element placement
- Ensure key content is visible when cropped to square (LinkedIn preview)
```

---

**Issue 3: Typography Not Specified**

"Sans-serif fonts" is the only typography guidance, and only for minimal style.

**Recommended Addition:**
```
Typography Requirements:
- Title: Bold, high contrast, minimum 5% of image height
- Body text: Regular weight, high readability
- Ensure minimum 4.5:1 contrast ratio for all text
- Maximum 3 font sizes in the design
- Avoid decorative fonts for body text

Font Pairing Suggestions:
- Professional: Helvetica/Arial family
- Modern: Inter, DM Sans
- Authoritative: Roboto, Source Sans
```

---

#### MEDIUM PRIORITY

**Issue 4: Color Scheme Interpretation Is Vague**

The prompt passes through the color scheme from synthesis without interpretation guidance.

**Recommended Enhancement:**
```
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

**Issue 5: Data Visualization Style Lacks Specificity**

"Include charts, graphs" doesn't guide what type of visualization.

**Recommended Enhancement for data-heavy style:**
```
Data Visualization Guidelines:
- 1 number: Use large typography with supporting icon
- 2 numbers (comparison): Use side-by-side bars or before/after
- 3-4 numbers (progression): Use horizontal bar chart or timeline
- 5+ numbers: Use simplified pie/donut chart or ranked list
- Percentages: Donut charts or progress bars work well
- Growth/change: Arrow indicators with percentage change

Design the visualization to be understood in 3 seconds.
```

---

#### LOW PRIORITY

**Issue 6: No Mobile-First Guidance**

Most LinkedIn consumption is mobile. The prompt doesn't address this.

**Recommended Addition:**
```
Mobile Optimization:
- 70%+ of LinkedIn views are mobile - design for small screens
- Title must be readable at thumbnail size
- Key statistic/insight should be visible even when cropped
- Test mental thumbnail: Would the core message survive 100x100px preview?
```

---

**Issue 7: Style Selection Could Be More Nuanced**

Three styles may not cover all content types optimally.

**Consider Adding:**
```
Style Selection Guidance (for synthesis stage):
- minimal: Best for abstract concepts, thought leadership, brand posts
- data-heavy: Best for reports, survey findings, market analysis
- quote-focused: Best for expert interviews, inspiration, testimonials
- Consider: timeline (for processes), comparison (for alternatives), checklist (for how-tos)
```

---

### Recommended Revised Prompt Template

```
Create a professional LinkedIn infographic that captures attention in the feed.

CONTENT:
Title: ${sanitizedTitle}
Key Points (visual hierarchy - first is most important):
${keyPointsSection}

DESIGN SYSTEM:
Style: ${brief.suggestedStyle}
Color Scheme: ${colorScheme}
Target Resolution: ${imageSize}

${styleInstructions}

COMPOSITION REQUIREMENTS:
- Title: Top 25% of image, bold, high contrast
- Key visual element: Center-weighted, immediately visible
- Supporting points: Clear hierarchy, scannable
- White space: Minimum 5% margins, breathing room between elements
- Mobile-first: Content visible at thumbnail size (100x100px preview)

TYPOGRAPHY:
- Maximum 3 font sizes
- Minimum contrast ratio 4.5:1
- Sans-serif fonts only
- Title minimum 5% of image height

MUST AVOID:
- Generic stock imagery (handshakes, lightbulbs, puzzle pieces)
- Text too small to read on mobile
- Busy backgrounds or patterns behind text
- More than 5 competing visual elements
- Watermarks, logos, or branding
- Clip art or dated design elements

OUTPUT:
- Clean PNG with transparent or solid background
- Professional quality suitable for corporate LinkedIn
- All text crisp and readable
```

---

## Cross-Cutting Concerns

### 1. Consistency Across Stages

**Issue:** Each stage uses slightly different delimiter conventions and instruction formats.

**Recommendation:** Standardize across all prompts:
- Use identical delimiter patterns (`<<<SECTION_START>>>` / `<<<SECTION_END>>>`)
- Use consistent section headers (## for main sections, ### for subsections)
- Use consistent formatting for requirements (numbered lists vs bullets)

### 2. Error Recovery Guidance

**Issue:** Prompts don't guide LLMs on handling edge cases gracefully.

**Recommendation:** Add to each prompt:
```
If you encounter any of these situations, handle as follows:
- Ambiguous input: State your interpretation before proceeding
- Insufficient information: Acknowledge gaps rather than fabricating
- Conflicting requirements: Prioritize [specific priority order]
- Unable to complete: Return partial results with explanatory notes
```

### 3. Output Validation Instructions

**Issue:** Prompts request JSON output but don't instruct self-validation.

**Recommendation:** Add to all prompts requesting JSON:
```
Before returning your response:
1. Verify JSON is syntactically valid
2. Check all required fields are present
3. Validate arrays are non-empty where required
4. Ensure all URLs are complete (not truncated)
```

### 4. Token Efficiency

**Issue:** Some prompts are verbose with repetitive instructions.

**Recommendation:**
- Move static instructions to system prompts where possible
- Use concise bullet points instead of prose paragraphs
- Remove redundant restatements of the same requirement

---

## Priority Matrix

| Issue | Stage | Priority | Effort | Impact |
|-------|-------|----------|--------|--------|
| Missing CoT guidance | Validation | HIGH | Low | High |
| Scoring rubrics missing | Scoring | HIGH | Medium | Very High |
| LinkedIn post structure | Synthesis | HIGH | Medium | Very High |
| Negative prompting for images | Image | HIGH | Low | High |
| Confidence calibration | Validation | HIGH | Low | Medium |
| Hook templates | Synthesis | MEDIUM | Low | High |
| Tone calibration | Synthesis | MEDIUM | Low | Medium |
| Tie-breaking guidance | Scoring | MEDIUM | Low | Medium |
| Typography specification | Image | MEDIUM | Low | Medium |
| Composition guidelines | Image | MEDIUM | Low | Medium |
| Quote fuzzy matching | Validation | MEDIUM | Low | Medium |
| Data viz specificity | Image | MEDIUM | Low | Medium |
| Engagement techniques | Synthesis | LOW | Low | Medium |
| Mobile-first guidance | Image | LOW | Low | Low |
| Author attribution types | Validation | LOW | Low | Low |

---

## Implementation Recommendations

### Phase 1: High-Impact Quick Wins (1-2 days)

1. **Add Chain-of-Thought to Validation** (`perplexity.ts`)
   - Add explicit reasoning steps to verification tasks
   - Include confidence calibration guide

2. **Add Scoring Rubrics** (`gemini.ts`)
   - Define 5-level rubrics for each dimension
   - Add tie-breaking guidance

3. **Add LinkedIn Post Structure** (`gpt.ts`)
   - Include hook templates
   - Add formatting rules for readability

4. **Add Negative Prompts to Image Generation** (`nanoBanana.ts`)
   - List specific elements to avoid
   - Add composition guidelines

### Phase 2: Refinements (3-5 days)

5. Update system prompts with role clarity
6. Add edge case handling instructions
7. Include calibration examples
8. Add self-validation instructions for JSON outputs
9. Implement consistent delimiter and formatting standards

### Phase 3: Testing & Iteration

10. A/B test prompt changes with real content
11. Measure output quality improvements
12. Gather user feedback on generated content
13. Iterate based on failure modes observed

---

## Appendix: Prompt Engineering Best Practices

### For Reasoning Models (Perplexity, GPT-5.2 Thinking)

- Explicitly request step-by-step reasoning
- Use "Let's think through this" or "Reasoning:" sections
- Provide worked examples when possible
- Ask for confidence/uncertainty estimates

### For Scoring/Evaluation Tasks (Gemini)

- Provide detailed rubrics with anchor points
- Use numerical scales consistently
- Request justification for each score
- Include calibration examples

### For Creative Tasks (GPT for Synthesis)

- Balance constraints with creative freedom
- Provide templates/patterns as inspiration, not requirements
- Include examples of good output
- Specify what NOT to do as well as what to do

### For Image Generation (Nano Banana Pro)

- Be specific about composition and layout
- Include negative prompts for common failure modes
- Specify technical requirements (resolution, format)
- Describe the intended audience/context

---

*This review was conducted using Claude Opus 4.5, analyzing the complete source code of the LinkedIn Quotes pipeline system prompts.*
