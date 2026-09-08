# Repository Instructions

## Branch roles

- `dev` is the automatic integration branch for development work.
- `prod` is the production branch. Codex must never automatically modify, merge, push, or deploy changes to `prod`; do so only when the user explicitly requests it.

## Commits on `dev`

- Whenever changes are made directly on the `dev` branch, commit them as small, atomic units of work.
- Each commit must represent one coherent change and have a commit message that describes that change specifically.
- Do not combine unrelated fixes, features, refactors, documentation updates, configuration changes, or other independent work in one commit merely because they were completed together.
- A single atomic commit may include multiple files when all of those files are required for the same coherent change.
- Before committing, review the diff and stage only the files or hunks that belong to that commit. Never include pre-existing or unrelated changes from the working tree.
- After creating the required atomic commit or commits on `dev`, push them to the remote `dev` branch automatically. Do not leave completed commits only in the local repository unless pushing is blocked by authentication, permissions, failed checks, or another error outside the agent's control.
- If a push is blocked, report the blocker and leave the local atomic commits intact.

## Codex-managed worktrees based on `dev`

When working in a Codex-managed worktree based on `dev`, Codex must:

1. Complete the requested task.
2. Run the relevant tests and checks for the task.
3. Commit all completed changes as small, atomic commits with descriptive commit messages. Never leave completed work uncommitted in a detached worktree.
4. Fetch the latest `origin/dev`.
5. Integrate the worktree commits on top of the latest `origin/dev` using a safe Git strategy that preserves both the worktree changes and changes that landed on `dev` since the worktree was created.
6. If a merge or rebase conflict is ambiguous, stop and report it. Do not discard another task's changes or guess at a conflict resolution merely to make the integration succeed.
7. After integrating the latest `dev`, rerun all relevant tests and checks against the combined code.
8. If the tests and checks pass, push the resulting `HEAD` directly to `origin/dev` with a normal non-force push.
9. Never force-push `dev`.
10. If the push is rejected because another task updated `dev` concurrently, fetch the new `origin/dev`, integrate it again, rerun the relevant tests and checks, and retry the normal push.
11. If integration or tests fail, do not push and report the failure.
12. When integration and tests succeed, do not require manual review, approval, handoff, or a pull request.
13. Never automatically merge, push, or otherwise deploy changes to `prod`.

The expected workflow is: Codex worktree → make changes → test → commit → sync with the latest `dev` → test the combined result → push directly to `dev` → existing GitHub Actions handles the dev deployment.
