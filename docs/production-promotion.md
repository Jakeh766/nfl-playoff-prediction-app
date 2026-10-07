# Production promotion

Promote shared application changes from `dev` to `prod` through a pull request.
Opening the PR does not deploy production. Merging it triggers the production
GitHub Actions workflow, which runs tests before applying Terraform.

## Environment differences to preserve

These differences belong to deployment configuration and runtime guards. They
do not require removing commits or manually deleting features before each release.

| Behavior | Dev | Production | Source of truth |
| --- | --- | --- | --- |
| Randomize seeds and bracket | Available while picks are editable; also available on localhost | Hidden; the handler also refuses calls | `frontend/app.js` (`TEST_MODE`), `frontend/picks.js` (`randomizeBracket`) |
| NFL picks after the deadline | Reopened for testing | Locked; API rejects saves with HTTP 423 | `backend/lambda/app.py` (`prediction_window`), `terraform/envs/prod/terraform.tfvars` |
| NBA picks | Follow the NBA deadline; no NFL testing override | Follow the NBA deadline | `backend/lambda/nba_season.json`, `frontend/sports.js` |
| Demo participants and groups | Seeded by the dev workflow | Never seeded by the prod workflow | `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml` |
| Private admin analytics page and API | Available to Cognito admins | Page, routes, and supporting resources excluded | `terraform/modules/app/main.tf`, `terraform/modules/app/admin-analytics.tf` |
| GoatCounter and active-time measurements | Enabled subject to GPC/DNT | Disabled by environment guards | `frontend/goatcounter.js`, `frontend/engagement.js`, `backend/lambda/engagement.py` |

Production's current NFL lock is `2026-09-10T00:20:00Z`. Advance it only as an
intentional season-maintenance change. Keep it separate from reopening dev for
testing. Production still collects guarded first-party aggregate activity via
`frontend/monitoring.js`; the private reporting interface remains dev-only.

Terraform sets `environment = "prod"` in `terraform/envs/prod/main.tf` and
generates both `window.AUTH_CONFIG.environment` and the Lambda `ENVIRONMENT`
from that value. The checked-in `frontend/auth-config.js` is a local preview
stub, not the deployed configuration. A branch name or browser query parameter
does not enable the dev-only NFL override.

## Promotion checklist

1. Fetch current `origin/dev` and `origin/prod`, preserve both histories, and
   reconcile any conflicts before opening the PR. Retain production fixes that
   have already been ported to dev, including password-manager compatibility.
2. Review the complete diff and the environment differences above. Add any new
   dev-only behavior to this table and protect it with an environment guard.
3. Run `.\scripts\setup.ps1` once per checkout, then
   `.\scripts\check.ps1 -Scope All` on the combined result.
4. Confirm `backend/test_production_guards.cjs` passes for randomize visibility
   and direct-call protection. `backend/test_auth.py` verifies production NFL
   locking, HTTP 423 after kickoff, and dev-only reopening. Both are discovered
   by the shared local and deployment checks.
5. Push the checked changes and open a PR targeting `prod`. Record the preserved
   environment differences and validation in its description. Merge only when
   production deployment is requested.
6. After deployment, check production's public prediction-window response and
   picks page: NFL picks must be locked, with no randomize action. NBA must use
   its own deadline. Do not use real user predictions as a release probe.
