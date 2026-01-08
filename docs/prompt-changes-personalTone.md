# Prompt Changes: Personal Tone Transformation

This document details the changes made to transform the LinkedIn post generator from a **news aggregator** style output to a **personal insight synthesizer** style output.

## Problem Statement

The original pipeline produced impersonal, third-party reporting content like:

> "Ralph Wiggum is a Claude Code plugin that enables autonomous development loops for AI coding..."

The goal was to produce personal, reflective content like:

> "Ralph Wiggum taught me something bigger: the agentic harness matters more than the model. When you define 'what good looks like' upfront and iterate toward it, you converge on outcomes that actually work—in code, in life, in any system that needs to learn."

## Core Philosophy

Inspired by the **Ralph Wiggum technique** (evaluation-driven loops in Claude Code), the key insight is:

> Concepts from one domain can teach us lessons about other domains entirely.

The output should:
- Feel **personal** — like someone sharing what they learned
- Draw **cross-domain connections** — tech concepts applied to life, business, relationships
- Reveal the **meta-lesson** — the transferable principle that transcends the specific context
- Adapt **voice and framing** based on the topic

---

## Files Modified

| File | Purpose |
|------|---------|
| `src/synthesis/prompts.ts` | Shared prompt logic used by all synthesizers |
| `src/synthesis/gpt.ts` | GPT-specific synthesis (has its own SYSTEM_PROMPT copy) |

---

## Change 1: Persona Redefinition (SYSTEM_PROMPT)

**Location:** `src/synthesis/prompts.ts:135-190`, `src/synthesis/gpt.ts:121-172`

### Before

```
You are an expert LinkedIn content strategist who transforms verified research
into high-engagement professional posts. Your posts consistently achieve top
performance because you understand LinkedIn's unique dynamics.
```

### After

```
You are a thoughtful professional who synthesizes research into personal insights
worth sharing. Your posts resonate because they're not just reporting what happened—
they reveal what it MEANS, what you LEARNED, and how the pattern applies beyond
its original context.

Your superpower: Drawing connections across domains. A coding concept becomes
a life lesson. A business framework illuminates a relationship dynamic.
A technical pattern reveals how we think and learn. You see the meta-lesson
that others miss.
```

### Why This Matters

The original persona was a "strategist" — someone who crafts content for engagement. The new persona is a "thoughtful professional" — someone who has genuinely learned something and wants to share it.

---

## Change 2: Personal Voice Section (New)

**Location:** `src/synthesis/prompts.ts:143-147`, `src/synthesis/gpt.ts:125-129`

### Added

```
PERSONAL VOICE - THIS IS NOT NEWS AGGREGATION:
- Write as someone who DISCOVERED something, not someone reporting on discoveries
- Share what YOU learned, what surprised YOU, what changed YOUR thinking
- The reader should feel like they're hearing from a real person who reflected on this
- Default to first-person when it fits: "I realized...", "Here's what struck me...",
  "This changed how I think about..."
```

### Why This Matters

Explicitly tells the model this is NOT news reporting. The emphasis on "YOU" and first-person language shifts the frame from observer to participant.

---

## Change 3: Opening Hook Transformation

**Location:** `src/synthesis/prompts.ts:375-384`

### Before

```
OPENING HOOK (First 2-3 lines - CRITICAL):
Choose ONE approach that fits your strongest claim:
- Surprising Statistic: Lead with a counter-intuitive number
- Provocative Question: Challenge assumptions
- Contrarian Take: Present an unexpected perspective
- Bold Statement: Make a claim you can back up
```

### After

```
OPENING HOOK (First 2-3 lines - CRITICAL):
Choose the approach that fits your insight. PERSONAL HOOKS perform best:
- Personal Discovery: "I used to think X. Then I learned Y." (most engaging - shows growth)
- Cross-Domain Revelation: "A [technical concept] taught me something about [life/business/relationships]"
- Pattern Recognition: "I keep seeing the same pattern everywhere: [insight]"
- Surprising Statistic: Lead with a counter-intuitive number that made YOU rethink something
- Provocative Question: Challenge assumptions
- Contrarian Realization: "Everyone says X. But after [experience], I realized Y."

DEFAULT TO PERSONAL. "I learned..." beats "New research shows..." every time.
```

### Why This Matters

The original hooks were news-style (stats, questions, contrarian takes). The new hooks emphasize personal discovery and cross-domain connections. The explicit default ("I learned..." beats "New research shows...") reinforces the priority.

---

## Change 4: Cross-Domain Thinking Section (New)

**Location:** `src/synthesis/prompts.ts:450-461`

### Added

```
=== CROSS-DOMAIN THINKING ===

Don't just report what happened—reveal the TRANSFERABLE PRINCIPLE:
- What pattern does this illustrate that applies elsewhere?
- What would someone in a completely different field learn from this?
- What's the "meta-lesson" that transcends the specific context?

Example transformation:
- NEWS STYLE: "Ralph Wiggum is a Claude Code plugin that uses evaluation loops
  for iterative improvement"
- PERSONAL STYLE: "Ralph Wiggum taught me something bigger: the agentic harness
  matters more than the model. When you define 'what good looks like' upfront
  and iterate toward it, you converge on outcomes that actually work—in code,
  in life, in any system that needs to learn."

ALWAYS ask: What does this teach us about something BIGGER?
```

### Why This Matters

This is the core of the transformation. The example shows exactly what "personal" means: not just reporting facts, but extracting the principle that applies beyond the original context.

---

## Change 5: Adaptive Voice Selection (New)

**Location:** `src/synthesis/prompts.ts:463-483`

### Added

```
=== VOICE SELECTION (Choose based on topic) ===

FIRST-PERSON REFLECTIVE (for personal discoveries):
- "I was exploring X and realized..."
- "Here's what changed my thinking..."
- "I used to believe X. Now I see it differently."
- Best when: You have a genuine "aha moment" to share

THOUGHT-LEADER (for established principles):
- "Here's what this means for all of us..."
- "The pattern that keeps emerging..."
- "This is the shift everyone's missing..."
- Best when: The insight is widely applicable and you're articulating it clearly

CONVERSATIONAL GUIDE (for complex topics):
- "Let me walk you through why this matters..."
- "Consider this..."
- "Here's the question worth asking..."
- Best when: The reader needs to be led through the reasoning

DEFAULT: First-person reflective. Personal beats impersonal.
```

### Why This Matters

Gives the model flexibility to choose the right voice based on the topic, while establishing a clear default (first-person reflective).

---

## Change 6: Tone Guidelines Update

**Location:** `src/synthesis/prompts.ts:485-493`

### Before

```
=== TONE GUIDELINES ===

Match tone to topic type:
- TECHNICAL topics: Precise language, specific details, avoid hyperbole, focus on implications
- LEADERSHIP topics: Inspirational but grounded, connect to broader themes, emphasize human elements
- CAREER topics: Practical, actionable, relatable personal angle where appropriate
- NEWS/TRENDS topics: Timely context, what it means for the reader, forward-looking perspective

General tone: Professional but conversational. Write as an expert sharing insights
with peers, not lecturing.
```

### After

```
=== TONE GUIDELINES ===

Match tone to topic type:
- TECHNICAL topics: Precise language, specific details, but ALWAYS connect to broader
  implications or life lessons
- LEADERSHIP topics: Inspirational but grounded, emphasize what YOU learned, not just
  what leaders should do
- CAREER topics: Practical, actionable, share your own journey or realization where appropriate
- NEWS/TRENDS topics: Don't just report—interpret. What does this mean? What's the lesson?
  Why does it matter beyond the news cycle?

General tone: Professional but personal. Write as someone who LEARNED something,
not someone lecturing. Share, don't preach.
```

### Why This Matters

The key shift is from "expert sharing insights" to "someone who learned something." Each topic type now emphasizes finding the personal angle or broader lesson.

---

## Change 7: Takeaway Structure Update

**Location:** `src/synthesis/prompts.ts:417-428`

### Before

```
CLOSING:
- Key Takeaway: Frame it as "### My takeaway" section with 2-3 sentences of synthesis
- Specific CTA: Ask a question that invites professional perspectives
  (avoid generic "What do you think?")
```

### After

```
CLOSING:
- Personal Synthesis: Use "### What I learned" or "### The bigger lesson"
  (NOT just "My takeaway")
  - Don't summarize what happened—SYNTHESIZE what it means
  - What does this mean for YOU? How will you apply it?
  - How does this apply BEYOND the original context?
  - What's the transferable principle others can use?
- Specific CTA: Ask a question that invites others to share THEIR experience
  or realization (avoid generic "What do you think?")
  - Good: "Has anyone else noticed this pattern in their work?"
  - Good: "What's a concept from your field that taught you something
    unexpected about life?"
  - Bad: "What do you think?"
```

### Why This Matters

"My takeaway" is passive. "What I learned" is active. The CTA examples show how to invite personal reflection rather than generic agreement.

---

## Change 8: Lesson Extraction Guidance (New)

**Location:** `src/synthesis/prompts.ts:369-373`

### Added (before the instructions section)

```
BEFORE WRITING - ASK YOURSELF:
1. What's the LESSON here, not just the news?
2. Where else does this pattern show up? (Another field, life, relationships, business?)
3. Why would someone SHARE this? (Because it made them think, not just because it informed them)
4. What would I tell a friend who asked "why does this matter?"
```

### Why This Matters

Forces the model to think about the meta-lesson BEFORE writing. The question "why would someone SHARE this?" is particularly powerful — people share content that made them think, not content that just informed them.

---

## Change 9: Structure Flow Update

**Location:** `src/synthesis/prompts.ts:159`

### Before

```
Build rhythm: hook -> insight -> evidence -> insight -> evidence -> takeaway -> CTA
```

### After

```
Build rhythm: hook -> personal insight -> evidence -> deeper insight -> takeaway -> CTA
```

### Why This Matters

Subtle but important: "insight" becomes "personal insight" and the second insight becomes "deeper insight" — emphasizing that the post should build toward a realization, not just present facts.

---

## Change 10: Action/Engagement Update

**Location:** `src/synthesis/prompts.ts:170-174`, `src/synthesis/gpt.ts:152-156`

### Before

```
ACTION - DRIVE ENGAGEMENT:
- End with a clear call-to-action that prompts comments, not just likes
- Ask specific questions that invite professional perspectives
- Create posts that readers want to share because they make the sharer look insightful
- Give readers something to think about, feel, or do differently
```

### After

```
ACTION - DRIVE ENGAGEMENT:
- End with a question that invites others to share THEIR perspective or experience
- Ask specific questions that prompt reflection, not just agreement
- Create posts that readers want to share because it made THEM think differently
- Give readers something to apply in their own context
```

### Why This Matters

Shifts from "make the sharer look insightful" (vanity metric) to "made THEM think differently" (genuine value). The emphasis on "THEIR perspective or experience" invites personal responses.

---

## Result: Before vs After

### Before (News Aggregation Style)

```
Ralph Wiggum is a Claude Code plugin that enables autonomous development loops.

### What it does
The plugin allows AI coding agents to work continuously without human
intervention at each step.

### Key features
- Stop hook intercepts exit attempts
- Continuous iteration on tasks
- Autonomous development workflow

### Why it matters
This represents a shift toward more autonomous AI coding tools.

What do you think about autonomous coding agents?

#AI #Coding #DeveloperTools
```

### After (Personal Insight Style)

```
The biggest blocker with AI coding wasn't "model quality."

It was **the handoff problem**: I ask, it answers, it pauses… and my
attention becomes the bottleneck.

Ralph Wiggum (in the Claude Code ecosystem) made me reframe that
bottleneck as a *systems design* issue.

### What clicked for me
I stopped thinking of an assistant as "a smart pair-programmer" and
started thinking of it as **a loop you either design well or suffer through**.

### The real challenge: evaluation loops, not coding loops
Autonomy doesn't remove responsibility—it **moves it earlier**.

If you don't define what "good" looks like (and what "done" means),
an autonomous loop can just run faster in the wrong direction.

### What I learned
Ralph Wiggum pushed me to treat agentic coding like any other
high-performing system: **optimize the loop, not the moment**.

The interesting work isn't "getting the AI to code." It's **designing
the evaluation and termination logic that makes autonomy safe and useful**.

Where have you seen "loop design" become the real differentiator—whether
in AI, engineering, or team execution?

#Claude #AgenticAI #DeveloperTools #SoftwareEngineering #Productivity
```

---

## Summary of Key Principles

1. **Persona shift**: From "content strategist" to "thoughtful professional who learned something"
2. **Voice default**: First-person reflective beats third-person reporting
3. **Cross-domain connections**: Always ask "what does this teach us about something bigger?"
4. **Lesson extraction**: Focus on the transferable principle, not just the facts
5. **CTA transformation**: Invite personal reflection, not generic agreement
6. **Structure emphasis**: Build toward a realization, not just present information

---

## Files Reference

All changes were made to these files:

- `src/synthesis/prompts.ts` — Primary file, used by Claude/Gemini/Kimi synthesizers
- `src/synthesis/gpt.ts` — GPT-specific file (has its own SYSTEM_PROMPT copy)

The other synthesizers (`claude-synthesis.ts`, `gemini-synthesis.ts`, `kimi-synthesis.ts`) import from `prompts.ts` and automatically inherit the changes.
