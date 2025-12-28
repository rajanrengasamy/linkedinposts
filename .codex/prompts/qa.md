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

2.  **Analyze & Validate**:
    -   Compare the code against the PRD.
    -   Scrutinize for edge cases, error handling, and type safety.
    -   **"Rethink and Ultrathink"**: Simulate failure modes. Verify logic deeply.

3.  **Report**:
    -   If you find issues, capture them in `docs/Section{{ args }}-QA-issuesCodex.md`.
    -   Make findings **super detailed**.

4.  **Completion**:
    -   If flawless, state "QA Passed".
    -   Otherwise, summarize issues and point to the report.
