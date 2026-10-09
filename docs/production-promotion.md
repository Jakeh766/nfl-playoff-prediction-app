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
| Private admin analytics page and API | Available to dev Cognito admins | Available only to production Cognito admins; separate pool/group/cache/parameters | `terraform/modules/app/main.tf`, `terraform/modules/app/admin-analytics.tf`, `backend/lambda/admin_analytics.py` |
| GoatCounter traffic | Enabled subject to GPC/DNT | Enabled subject to GPC/DNT; fixed `/prod/...` page labels isolate counts on the existing site | `frontend/goatcounter.js`, `backend/lambda/analytics_providers.py`, `backend/lambda/goatcounter_sessions.py` |
| Active engagement time | Anonymous page/sport totals subject to GPC/DNT and foreground/idle rules | Same definitions and privacy rules; own aggregate cache; per-session value is explicitly an estimate | `frontend/engagement.js`, `backend/lambda/engagement.py`, `terraform/modules/app/main.tf` |

Production's current NFL lock is `2026-09-10T00:20:00Z`. Advance it only as an
intentional season-maintenance change. Keep it separate from reopening dev for
testing. Production still collects guarded first-party aggregate activity via
`frontend/monitoring.js`; the private reporting interface reports production
events and saved-season data. GoatCounter traffic reuses the existing site and
token, with exact environment path filters for exports and fallback statistics.
Active engagement time is configured in both environments by Terraform's `active_engagement_enabled` boolean (default true). It controls the public `activeEngagementEnabled` boolean and Lambda `ACTIVE_ENGAGEMENT_ENABLED` flag; unknown environments, private pages and GPC/DNT remain excluded. Each environment stores only aggregate counters in its own cache. The per-session metric is explicitly an estimate using GoatCounter range-wide distinct sessions for the same dates.

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
   Before the first production admin-analytics promotion, apply the narrowly
   scoped production deployment-role changes through the separate bootstrap
   administrator process. Review a refreshed production plan against remote
   state: stop on destructive/replacement or unrelated changes. Mocked Terraform
   test plans do not establish live-state safety. Follow
   [production admin analytics setup](admin-analytics.md#production-setup-and-promotion)
   for exact parameters, separate Google credentials, and manual Cognito
   membership. The app deployment never assigns admin membership automatically.
6. After deployment, check production's public prediction-window response and
   picks page: NFL picks must be locked, with no randomize action. NBA must use
   its own deadline. Do not use real user predictions as a release probe.
