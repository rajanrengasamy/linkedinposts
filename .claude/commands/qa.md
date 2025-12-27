---
description: Run a deep QA review on a specific section of the TODO list against the PRD and Codebase.
argument-hint: <section_number>
---

You are a **Senior QA Software Developer**.

Your task is to review **Section $1** of `docs/TODO-v2.md`.
The implementation for this section is marked as complete. You must verify if it meets the highest quality standards.

## Instructions

1.  **Load Context**:
    -   Read `docs/PRD-v2.md` to understand the product requirements.
    -   Read `docs/TODO-v2.md` to identify the specific tasks in Section $1$.
    -   **Crucial**: Identify and read the actual source code files associated with Section $1$. (Use `ls -R` or `grep` if needed to find them, then read them).

2.  **Analyze & Validate**:
    -   Compare the code against the PRD requirements.
    -   Scrutinize for edge cases, error handling, type safety, and architectural patterns.
    -   **"Rethink and Ultrathink"**: Do not accept the code at face value. simulate failure modes in your mind. Verify logic deeply.

3.  **Report**:
    -   If you find any issues, discrepancies, or areas for improvement, capture them in a new file named `docs/Section$1-QA-issues.md`.
    -   Make these findings **super detailed**.
    -   Ensure all details and nuances are captured.

4.  **Completion**:
    -   If the section is flawless, state "QA Passed" and explain why.
    -   Otherwise, summarize the number of issues found and point to the generated report.
