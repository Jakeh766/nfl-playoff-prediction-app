# Predict Playoffs

Predict the NFL playoff field and bracket, save one prediction, and compare
your results on public or private leaderboards.

## Features

- Build all seven AFC and NFC seeds, division winners, and every playoff round
  through the Super Bowl.
- Create an account, save one prediction, and reopen or edit it until the
  server-enforced regular-season kickoff deadline. Predictions can be deleted
  from the signed-in account view.
- Claim a unique public leaderboard name and share a read-only bracket view.
- Create or join password-protected groups with invite links and member-only
  leaderboards. Groups choose their scoring mode when they are created.
- Compare predictions using Classic or Upset Edge scoring.
- View projected season win totals refreshed from VegasInsider and cached by the
  backend.

## Architecture

- `frontend/` — static multi-page HTML, CSS, and JavaScript served through
  CloudFront from a private S3 bucket.
- `backend/lambda/app.py` — Python Lambda API behind API Gateway. DynamoDB
  stores predictions, leaderboard profiles, groups, and the win-total cache.
- `backend/custom-email-sender/` — Node.js Lambda that delivers Cognito
  account messages through Resend.
- `terraform/` — shared AWS infrastructure for independent `dev` and `prod`
  environments.
- `.github/workflows/` — automated test and deployment workflows. Each
  environment also gets a privacy-conscious CloudWatch analytics dashboard.

Authentication uses Amazon Cognito directly from the application. Email
verification and password recovery are handled in-app; no Cognito managed-login
domain is required.

## Scoring and season data

Classic scoring is capped at 300 points:

- 5 points for each correct playoff team
- 5 points for each correct division winner
- 5 points for an exact #1 seed, 3 points for an exact #2–#4 seed, and 2 points
  for an exact #5–#7 seed
- 5 / 10 / 20 / 40 points for correct advancing teams in the Wild Card,
  Divisional, Conference Championship, and Super Bowl rounds

Playoff points are based on advancement, not exact matchups, so an earlier miss
does not prevent credit for a correct later-round pick.

Upset Edge applies a team-specific multiplier to each Classic scoring item:

```text
Classic points × [1 + 0.10 × (8.5 − preseason win total)]
```

Values are rounded half up to hundredths. The public leaderboard can switch
between both modes; a group keeps the mode selected at creation. See the
in-app `/scoring` page for the full explanation.

The checked-in season is 2026 and is currently preseason. When results become
known, update `backend/lambda/season_results.json` with only published results
and deploy. `backend/lambda/scoring_odds.json` is the frozen 2026 market
snapshot for Upset Edge; do not change it during the season. Create a matching
snapshot when rolling over to a new season.

Update `prediction_lock_at` in both environment `terraform.tfvars` files for
each season. The backend's `/api/prediction-window` endpoint is the source of
truth used by the countdown and prediction UI.

## Local development

The CI toolchain is Node.js 24, Python 3.13, and Terraform 1.15.7. Run checks
from the repository root:

```powershell
node --check frontend/app.js
node --check frontend/bootstrap.js
node --check frontend/leaderboard.js
node --check frontend/monitoring.js
node --check frontend/picks.js
node --check frontend/scoring.js
node --check frontend/shell.js
node --check frontend/auth-config.js
python -m py_compile backend/lambda/app.py
npm ci --prefix backend/custom-email-sender
npm test --prefix backend/custom-email-sender
python -m unittest discover -s backend -p "test_*.py"
node --test backend/test_leaderboard.cjs
terraform fmt -check -recursive terraform
terraform -chdir=terraform/envs/dev init -backend=false
terraform -chdir=terraform/envs/dev validate
```

For a frontend-only preview:

```powershell
python -m http.server 8000 --directory frontend
```

Open `http://localhost:8000`. The preview supports the bracket UI and bundled
win totals, but not Cognito, saved predictions, private groups, or live odds.
For the other pages, use `/picks.html`, `/leaderboard.html`, or
`/scoring.html` when using the basic static server. To inspect the leaderboard
name dialog, open `http://localhost:8000/?preview=leaderboard-name`.

## Deployment

- Pushing to `dev` runs the checks, applies the dev Terraform environment, and
  seeds seven demo participants and two demo groups.
- After validating dev, promote by merging `dev` into `prod`. A push to `prod`
  runs the same checks, applies production, and creates a GitHub release.
- GitHub environments must provide the AWS role, Terraform state bucket, and
  encrypted `RESEND_API_KEY` required by their workflow.

The one-time AWS bootstrap, state migration, Resend setup, and local Terraform
commands are documented in [`terraform/README.md`](terraform/README.md).

Dev demo groups:

- **Demo Sunday Huddle** — `HuddleDemo26!`
- **Demo Gridiron Rivals** — `RivalsDemo26!`

These are DynamoDB-only demo data; they are not Cognito accounts. Production is
never seeded.

## Repository layout

```text
frontend/              Browser application
backend/               Lambda code, seed data, and tests
terraform/              AWS infrastructure and deployment guide
.github/workflows/      Dev and prod CI/CD workflows
```
