# Repository Instructions

## Local tools

- This repository's local development environment is Windows with Node.js 24,
  Python 3.13, and Terraform 1.15.7.
- Run `.\scripts\setup.ps1` once per checkout or worktree, then use
  `.\scripts\check.ps1 -Scope <scope>` for validation. Valid scopes are
  `Backend`, `Frontend`, `Email`, `Terraform`, and `All`.
- Do not invoke the Microsoft Store `python` or `py` launchers. Use
  `.venv\Scripts\python.exe` directly; the setup and check scripts already do
  this.
- The normal Codex workspace sandbox protects `.git` as read-only. Request host
  permission before commands that write Git metadata, including fetch, add,
  commit, switch, merge, rebase, and push. Do not first run a command that is
  known to require `.git` writes inside the sandbox.
- Preserve all unrelated working-tree changes. Local screenshots are ignored and
  must not be added to commits.

## AWS access

- The application AWS account is in `us-east-1`. Use the existing
  `codex-audit` profile for explicitly requested, read-only live AWS inspection.
- If the profile session is expired, ask the user to complete
  `aws login --profile nfl-prod-setup`; `codex-audit` assumes the constrained
  audit role from that short-lived source session. Never request, create, store,
  or paste root access keys.
- Keep routine dev and production deployment on GitHub Actions' OIDC roles. Do
  not use `nfl-prod-setup`, broaden IAM permissions, run Terraform apply locally,
  or mutate AWS resources unless the user explicitly requests that operation.
- Confirm the AWS principal with `aws sts get-caller-identity` before live work,
  and keep audit output narrow; never print credentials, secrets, or raw user
  data.

## Branch roles

- `dev` is the automatic integration branch for development work.
- `prod` is the production branch. Never modify, merge, push, or deploy `prod`
  unless the user explicitly requests it.

## Commits on `dev`

- Commit direct `dev` changes as small, coherent units with specific messages.
  Stage only the files or hunks belonging to each commit.
- After relevant checks pass, fetch and integrate the latest `origin/dev`, rerun
  the relevant checks, and push normally to `origin/dev` without asking for a
  separate review or pull request.
- Never force-push `dev`. If a concurrent update rejects the push, integrate the
  new `origin/dev`, rerun checks, and retry. If authentication, integration, or
  tests fail, leave local commits intact, do not push, and report the blocker.

## Codex worktrees based on `dev`

- Complete the requested work, run relevant checks, and commit every completed
  change; do not leave finished work uncommitted in a detached worktree.
- Fetch the latest `origin/dev` and safely rebase or merge the worktree commits
  onto it. Preserve both histories. Stop on ambiguous conflicts rather than
  discarding changes or guessing.
- Rerun relevant checks on the combined result, then push `HEAD` directly to
  `origin/dev` with a normal push. Handle concurrent push rejection using the
  same integrate-check-retry cycle above.
- Do not require a pull request or manual handoff after successful integration,
  and never automatically merge, push, or deploy to `prod`.

Expected flow: Codex worktree -> implement -> check -> atomic commits -> sync
with `origin/dev` -> check combined result -> push to `dev` -> GitHub Actions
deploys dev.
