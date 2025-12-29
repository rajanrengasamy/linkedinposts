---
description: Fix QA issues by spawning parallel senior-developer agents
argument-hint: <qa-issue-files...>
---

You are a **QA Fix Coordinator** tasked with resolving issues identified in QA reports. You will coordinate 5 senior-developer agents working in parallel to fix the issues.

## Arguments

The user will provide one or more QA issue files as arguments:
- Files: $ARGUMENTS

## Phase 1: Parse QA Issues

1. Read each QA issue file provided in the arguments
2. Extract all issues, categorizing them by severity:
   - **CRITICAL**: Must fix immediately (production blockers)
   - **MAJOR**: Should fix (significant issues)
   - **MINOR**: Nice to have (polish items)
3. Skip any issues already marked as "FIXED" in the report
4. Create a consolidated list of all unfixed issues with:
   - Issue ID (e.g., CRIT-1, MAJ-5)
   - File location
   - Issue description
   - Recommended fix (if provided)

## Phase 2: Create Fix Tracking

Create or update `docs/QA-Fix-Tracker.md` with the following structure:

```markdown
# QA Fix Tracker

**Generated:** [DATE]
**Source Files:** [list of QA files]

## Issues to Fix

### Critical Issues
- [ ] CRIT-1: [description] - [file:line]
- [ ] CRIT-2: ...

### Major Issues
- [ ] MAJ-1: [description] - [file:line]
...

### Minor Issues
- [ ] MIN-1: [description] - [file:line]
...

## Fix Progress

| Issue | Agent | Status | Notes |
|-------|-------|--------|-------|
| CRIT-1 | Agent 1 | Pending | |
...
```

## Phase 3: Distribute Issues to Agents

Divide the unfixed issues among 5 agents:
- **Agent 1**: Critical issues (first half) + any architectural/barrel export issues
- **Agent 2**: Critical issues (second half) + security-related issues
- **Agent 3**: Major issues (first third) - focus on error handling
- **Agent 4**: Major issues (second third) - focus on type safety & validation
- **Agent 5**: Major issues (final third) + all minor issues

If there are few issues, some agents may get fewer tasks. That's fine.

## Phase 4: Spawn Fix Agents

Use the **Task tool** to spawn **5 senior-developer agents in parallel** (in a single message with 5 Task tool calls).

**IMPORTANT**: Launch all 5 agents in a SINGLE message to run them in parallel.

### Agent Template

For each agent, use this structure:

```
subagent_type: "senior-developer"
prompt: |
  You are a senior developer fixing QA issues for the LinkedIn Quotes CLI project.

  ## Your Assigned Issues

  [List the specific issues assigned to this agent with full details]

  ## For Each Issue

  1. Read the file(s) mentioned in the issue
  2. Understand the current implementation
  3. Implement the recommended fix (or devise an appropriate fix)
  4. Ensure the fix doesn't break existing functionality
  5. Run type checking: `npx tsc --noEmit`
  6. Run tests if applicable: `npm test`

  ## Guidelines

  - Follow existing code patterns and conventions
  - Add JSDoc comments for new functions
  - Use Zod schemas for validation where appropriate
  - Ensure all TypeScript types are correct
  - Don't over-engineer - make minimal changes to fix the issue

  ## Report Back

  For each issue you fix, report:
  - Issue ID
  - Files modified
  - Summary of changes
  - Any concerns or follow-up needed
```

## Phase 5: Consolidate Results

After all 5 agents complete:

1. Collect all fix reports from each agent
2. Update `docs/QA-Fix-Tracker.md`:
   - Mark completed issues as [x]
   - Update the Fix Progress table with status and notes
3. Run final verification:
   - `npx tsc --noEmit` (type check)
   - `npm test` (run tests)
4. Create a summary for the user:
   - Total issues fixed
   - Any issues that couldn't be fixed
   - Any new issues discovered
   - Build/test status

## Phase 6: Journal Entry

After completing Phase 5, run the `/journal` command to create a session entry documenting:
- The QA issues that were fixed
- Any issues that remain open
- Key decisions made during the fixes
- Context for the next session

## Execution Checklist

- [ ] All QA issue files read and parsed
- [ ] Fix tracker created/updated
- [ ] Issues distributed among 5 agents
- [ ] All 5 agents launched in parallel (single message)
- [ ] All agent results collected
- [ ] Fix tracker updated with results
- [ ] Type check passed
- [ ] Tests passed
- [ ] Summary provided to user
- [ ] Journal entry created via /journal
