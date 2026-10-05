# Predict Playoffs

Predict NFL and NBA playoff fields and brackets, save one prediction per sport,
and compare your results on public or private leaderboards. Use the Sport
selector to switch; NBA links retain `?sport=nba` across pages and invites.

NBA predictions rank eight teams in each conference after the Play-In and pick
all 15 best-of-seven series winners through the Finals. There are no Play-In
picks, division-winner picks, byes, or reseeding. Your account, public name, and
group memberships are shared; predictions, deadlines, results, and leaderboard
scores are separate for each sport.

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

The development-only private dashboard at `/admin/analytics` combines custom,
GoatCounter, GA4, Search Console and Clarity reports. See
[admin analytics setup](docs/admin-analytics.md) for the deployment permission
prerequisite, Cognito admin membership, and server-only provider credentials.

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

The scoring rules below describe NFL. NBA Classic awards 5 per playoff team,
plus an exact-seed bonus of 6 for #1, 4 for #2–#4, and 3 for #5–#8. Series winners earn
5 / 10 / 20 / 40 through the four rounds, for a maximum of **300**. NBA Upset
Edge uses `Classic points × [1 + 0.02 × (41 − preseason win total)]`.

NBA season configuration, the verified tip-off deadline, and frozen BetMGM
scoring snapshot are in `backend/lambda/nba_season.json`; `frontend/sports.js`
contains the matching static-preview copy, checked by a regression test. The
2026–27 prediction deadline is October 20, 2026 at 19:00 UTC. Live BetMGM
projections have their own cache and cannot change the frozen scoring weights.
See [NBA results ingestion](docs/nba-results-ingestion.md) for automation details.

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

The CI toolchain is Node.js 24, Python 3.13, and Terraform 1.15.7. On Windows,
initialize the repository-local Python environment and other dependencies once:

```powershell
.\scripts\setup.ps1
```

Run all local checks, or select one or more scopes:

```powershell
.\scripts\check.ps1
.\scripts\check.ps1 -Scope Backend
.\scripts\check.ps1 -Scope Frontend,Terraform
```

The scripts deliberately use `.venv\Scripts\python.exe` instead of the Windows
Store `python.exe` launcher. GitHub Actions continues to use the matching
Python 3.13, Node.js 24, and Terraform 1.15.7 toolchain.

For a frontend-only preview:

```powershell
.\.venv\Scripts\python.exe -m http.server 8000 --directory frontend
```

Open `http://localhost:8000`. The preview supports the bracket UI and bundled
win totals, but not Cognito, saved predictions, private groups, or live odds.
For the other pages, use `/picks.html`, `/leaderboard.html`, or
`/scoring.html` when using the basic static server. To inspect the leaderboard
name dialog, open `http://localhost:8000/?preview=leaderboard-name`.

## Product analytics

The dev Terraform configuration supplies the public GA4 measurement ID and
Microsoft Clarity project ID through `AUTH_CONFIG.analytics`. The shared module
defaults both IDs to empty, so production and local static previews do not load
either provider until explicitly configured. These IDs are public, not secrets.

Every public page loads `analytics.js` from its head. Visitors must choose
**Allow analytics** before GA4/Clarity scripts or custom visitor/session IDs are
enabled. Existing custom aggregate events run without consent or identifiers;
the dev GoatCounter integration also runs independently of that banner.
**Cookie preferences** in the footer allows withdrawal. GPC and Do Not Track
disable tracking. The privacy disclosure is available at `/privacy`.

GA4 receives fixed event names only: `sign_up`, `login`, `bracket_started`
(first valid bracket build), `bracket_completed` (all game winners picked),
`bracket_saved` (successful save), `group_created`, `group_joined`, and
`leaderboard_viewed`. Event labels are limited to page, sport, and environment.
No account IDs, email addresses, group/invite identifiers, or picks are sent.
Page locations omit query strings/fragments and referrers contain origins only.
The existing CloudWatch event names are preserved.

Keep GA4 automatic form interactions, site search, and outbound clicks disabled
to avoid collecting form/link metadata. Keep Clarity strict masking enabled.
The HTML also masks the body before Clarity loads, and recording is skipped
when the URL or referrer has any fragment or query other than a valid sport.
No CSP is defined by the checked-in frontend/CloudFront configuration; this
integration adds no inline executable scripts or relaxed security policies.

After deploying dev, allow analytics in a browser without a privacy signal and
check GA4 Realtime for the dev hostname and `environment=dev`. Check Clarity for
a masked recording. Set `bracket_completed` as a GA4 key event. Production
promotion and production ID configuration require a separate explicit request.

## Deployment

- Pushing to `dev` runs the checks, applies the dev Terraform environment, and
  seeds sixteen demo participants and two demo groups.
- After validating dev, promote by merging `dev` into `prod`. A push to `prod`
  runs the same checks, applies production, and creates a GitHub release.
- Both GitHub environments provide an AWS role and Terraform state bucket;
  only prod requires the encrypted `RESEND_API_KEY` secret.

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
