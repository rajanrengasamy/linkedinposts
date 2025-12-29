---
description: "Run a deep QA review on a specific section. Usage: /prompts:qa <section_number>"
---

Act as a **Senior QA Software Developer**.

Your task is to review **Section {{ args }}** of `docs/TODO-v2.md`.
The implementation for this section is marked as complete. You must verify if it meets the highest quality standards.

## Instructions

1.  **Load Context**:
    -   Read `docs/PRD-v2.md` for product requirements.
    -   Read `docs/TODO-v2.md` to identify tasks in Section {{ args }}.
    -   **Crucial**: Identify and read the actual source code files associated with Section {{ args }}.

2.  **Analyze & Validate (Comprehensive)**:
    -   Compare the code against the PRD and TODO section requirements.
    -   Scrutinize for edge cases, error handling, and type safety.
    -   Review architecture/maintainability: DRY violations, duplicate constants/types, unused code, and cohesion across files.
    -   Inspect costs/configs/constants for inconsistencies across modules (e.g., pricing tables, model IDs, resolution maps).
    -   Evaluate test coverage: check relevant tests and identify missing cases for error paths, retries, timeouts, and validation.
    -   **"Rethink and Ultrathink"**: Simulate failure modes. Verify logic deeply.

3.  **Report**:
    -   If you find issues, capture them in `docs/Section{{ args }}-QA-issuesCodex.md`.
    -   Make findings **super detailed**.

4.  **Completion**:
    -   If flawless, state "QA Passed".
    -   Otherwise, summarize issues and point to the report.
