Reflect on the current session and create a journal entry. This serves as a retrospective capturing what was accomplished, issues encountered, and context needed for future sessions.

## Instructions

1. **Review the session** - Analyze what was discussed and accomplished in this conversation
2. **Read existing context** - Check journal.md (if exists), task.md, and prd.md for continuity
3. **Generate entry** - Append a new dated entry to `journal.md` in the project root

## Journal Entry Structure

Use this format for the new entry:
```
---

## Session: [DATE] [TIME AEST]

### Summary
[2-3 sentence overview of what was accomplished]

### Work Completed
- [Specific task/change completed]
- [Files modified/created]

### Issues & Resolutions
| Issue | Resolution | Status |
|:------|:-----------|:-------|
| [Problem encountered] | [How it was solved] | ✅ Resolved / ⏳ Open |

### Key Decisions
- [Decision made and rationale]

### Learnings
- [Technical insight or pattern discovered]

### Open Items / Blockers
- [ ] [Item needing attention next session]

### Context for Next Session
[Brief narrative of where things stand and recommended next steps]

---
```

## Behavior

- **If journal.md exists**: Append new entry at the end
- **If journal.md doesn't exist**: Create it with a header and first entry
- **Tone**: Concise, factual, future-oriented
- **Focus**: Capture enough context that a fresh session can resume seamlessly

## File Header (for new journal.md)
```
# Project Journal

This file maintains session history for continuity across Claude Code sessions.
Use alongside `task.md` (task for the project) and `prd.md (prd for the project) when starting new sessions.
```