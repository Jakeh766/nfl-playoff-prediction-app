# Repository Instructions

## Commits on `dev`

- Whenever changes are made directly on the `dev` branch, commit them as small, atomic units of work.
- Each commit must represent one coherent change and have a commit message that describes that change specifically.
- Do not combine unrelated fixes, features, refactors, documentation updates, configuration changes, or other independent work in one commit merely because they were completed together.
- A single atomic commit may include multiple files when all of those files are required for the same coherent change.
- Before committing, review the diff and stage only the files or hunks that belong to that commit. Never include pre-existing or unrelated changes from the working tree.
- After creating the required atomic commit or commits on `dev`, push them to the remote `dev` branch automatically. Do not leave completed commits only in the local repository unless pushing is blocked by authentication, permissions, failed checks, or another error outside the agent's control.
- If a push is blocked, report the blocker and leave the local atomic commits intact.
