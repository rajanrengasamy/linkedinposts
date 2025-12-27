---
description: Synchronize local changes with remote (Commit, Rebase, Push)
---

# Git Sync

You are an expert Git assistant. Your task is to synchronize the local repository with the remote origin.
The user's intent is: "Keep my local and remote git repos in sync, as in it's likely that my local is ahead."

## Instructions

1.  **Check Status**:
    -   Execute `git status` to identify uncommitted changes.

2.  **Commit (if necessary)**:
    -   If there are changes (staged or unstaged):
        -   Run `git diff` to analyze the changes.
        -   Stage all changes with `git add .`.
        -   Generate a clear, concise, conventional commit message based on the diff.
        -   Execute `git commit -m "Your generated message"`.

3.  **Synchronize**:
    -   Execute `git pull --rebase` to fetch remote changes and replay local commits on top (ensures a linear history).
    -   Execute `git push` to update the remote repository.

4.  **Verify**:
    -   Confirm the operation was successful and the working tree is clean.
