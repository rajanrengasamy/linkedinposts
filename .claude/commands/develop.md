---
description: Develop features using 5 parallel senior-developer agents
argument-hint: <section_number | feature description>
---

You are a **Development Lead** coordinating 5 senior-developer agents to implement features in parallel.

## Arguments

The user's development request: $ARGUMENTS

This could be:
- A section number (e.g., "10" to implement Section 10 from TODO-v2.md)
- A feature description (e.g., "add retry logic to all API calls")
- A specific task (e.g., "implement the image generation module")

## Phase 1: Understand the Request

1. **If a section number is provided:**
   - Read `docs/TODO-v2.md` and extract all tasks from that section
   - Read `docs/PRD-v2.md` for relevant requirements
   - Identify existing files that relate to this section

2. **If a feature/task description is provided:**
   - Read `docs/PRD-v2.md` to understand how it fits the product
   - Read `docs/TODO-v2.md` to see if it's already documented
   - Search the codebase for related existing code

3. **Create a development brief:**
   - What needs to be built
   - Which files need to be created/modified
   - Dependencies on existing code
   - Key requirements and constraints

## Phase 2: Plan the Work

Break down the development work into 5 parallel workstreams. Consider:

- **Natural boundaries**: Different files, modules, or concerns
- **Dependencies**: Tasks that can run independently vs. those that need sequencing
- **Complexity balance**: Distribute work roughly evenly

Example workstream division:
- **Agent 1**: Core types/schemas and interfaces
- **Agent 2**: Main implementation logic (part 1)
- **Agent 3**: Main implementation logic (part 2)
- **Agent 4**: Utility functions and helpers
- **Agent 5**: Integration, exports, and tests

Adjust based on what's actually being built.

## Phase 3: Spawn Development Agents

Use the **Task tool** to spawn **5 senior-developer agents in parallel** (in a single message with 5 Task tool calls).

**IMPORTANT**: Launch all 5 agents in a SINGLE message to run them in parallel.

### Agent Template

For each agent, customize this template:

```
subagent_type: "senior-developer"
prompt: |
  You are a senior developer implementing features for the LinkedIn Quotes CLI project.

  ## Project Context

  This is a TypeScript CLI tool with a pipeline: Collect → Validate → Score → Synthesize → Image

  Key references:
  - PRD: docs/PRD-v2.md
  - TODO: docs/TODO-v2.md
  - Existing patterns: [mention relevant existing files]

  ## Your Assignment

  [Specific tasks for this agent - be detailed and specific]

  ## Files to Create/Modify

  [List exact files this agent is responsible for]

  ## Implementation Guidelines

  1. Follow existing code patterns in the project
  2. Use TypeScript with strict types (no `any`)
  3. Use Zod schemas for runtime validation
  4. Add JSDoc comments for exported functions
  5. Handle errors gracefully with descriptive messages
  6. Keep functions focused and under 50 lines when possible

  ## Coordination Notes

  [Any info about what other agents are building that this agent needs to know]

  ## Verification

  After implementing:
  1. Run `npx tsc --noEmit` to verify types
  2. Ensure code follows project conventions
  3. Test manually if applicable

  ## Report Back

  Provide:
  - Files created/modified
  - Summary of implementation
  - Any decisions made
  - Any concerns or TODOs for follow-up
```

## Phase 4: Consolidate Results

After all 5 agents complete:

1. **Collect all reports** from each agent
2. **Verify integration**:
   - Check that files don't conflict
   - Verify imports/exports work together
   - Run `npx tsc --noEmit` for full type check
3. **Run tests**: `npm test`
4. **Update TODO** (if implementing a section):
   - Mark completed tasks as [x] in `docs/TODO-v2.md`
5. **Create summary** for the user:
   - What was built
   - Files created/modified
   - Any issues encountered
   - Suggested next steps

## Phase 5: Journal Entry

After completing Phase 4, run the `/journal` command to document:
- Features implemented
- Key implementation decisions
- Any open items or follow-up needed
- Context for the next session

## Execution Checklist

- [ ] Development request understood
- [ ] PRD and TODO reviewed for context
- [ ] Work broken into 5 parallel workstreams
- [ ] All 5 agents launched in parallel (single message)
- [ ] All agent results collected
- [ ] Type check passed (`npx tsc --noEmit`)
- [ ] Tests passed (`npm test`)
- [ ] TODO updated (if applicable)
- [ ] Summary provided to user
- [ ] Journal entry created via /journal

## Tips for Effective Parallelization

1. **Schemas first**: If new types are needed, have one agent create them so others can import
2. **Clear file ownership**: Each agent should own specific files to avoid conflicts
3. **Interface contracts**: Define function signatures upfront so agents can code to interfaces
4. **Minimize dependencies**: Structure work so agents don't block each other
