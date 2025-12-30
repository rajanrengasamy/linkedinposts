Begin a new session by loading project context for the LinkedIn Quotes CLI project.

## Instructions

1. Read `docs/PRD-v2.md` for product requirements
2. Read `docs/TODO-v2.md` for the master task list (source of truth)
3. Read **only the last 150 lines** of `journal.md` for recent session history
   - Use the Read tool with `offset` parameter to skip to the end
   - First check the file length, then read from (length - 150) to get the last entries
   - This captures the last 2-3 session entries while saving ~1700 lines of context
4. Summarize current state and confirm understanding
5. Ask what to focus on this session

## Context Window Optimization

This command is optimized to reduce context usage:
- PRD: ~1045 lines (full - needed for requirements)
- TODO: ~1062 lines (full - needed for task state)
- Journal: ~150 lines (tail only - recent context sufficient)
- **Total: ~2250 lines** (down from ~4000)

If you need older journal context for a specific issue, read more of the file on demand.

## Project Overview

This is a TypeScript CLI tool that generates shareable LinkedIn quote images through a pipeline:
**Collect → Validate → Score → Synthesize → Image**

## Key Files

- `docs/PRD-v2.md` - Product requirements document
- `docs/TODO-v2.md` - Master task list for Phase 0 implementation
- `journal.md` - Session history for continuity (read tail only)
