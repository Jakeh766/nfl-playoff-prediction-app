# Predict Playoffs

A self-contained NFL preseason playoff predictor. Users can:

- Create an email/password account through Amazon Cognito.
- Claim a unique public leaderboard name when saving a prediction.
- Seed seven AFC and seven NFC teams.
- Predict every playoff game, including conference championships and the Super Bowl.
- Track a 300-point score as official results become available.
- Create or join private groups with their own member-only leaderboards.
- Invite other players to a group with a private share link.
- Save, reopen, update, and delete one prediction per account.
- Create or change predictions only until the first regular-season kickoff; the
  backend enforces the deadline and the home page shows a live countdown.
- Permanently delete their saved prediction and account from the signed-in view.

Predictions are stored in DynamoDB and are available across devices. The Lambda
backend refreshes projected season win totals when the app loads, reading
available sportsbook lines from VegasInsider and using the median as a
consensus projection for each team.

The annual prediction deadline is configured as the UTC ISO-8601 value
`prediction_lock_at` in each environment's `terraform.tfvars`. The public
`/api/prediction-window` endpoint supplies the same server-authoritative deadline
to the countdown and picks UI. Update the timestamp after the next NFL schedule
is published; do not rely on a browser-only lock.

## Authentication

The deployed app signs existing users in with a password-manager-friendly form
on the application origin. The form sends credentials directly to Cognito over
TLS with Cognito's `USER_PASSWORD_AUTH` flow. Account creation, email
confirmation, and password recovery also happen in the app through Cognito's
public identity-provider API. The deployment does not create or use a Cognito
managed-login domain. Email verification is required and MFA is off. API
Gateway validates Cognito access tokens before invoking the prediction routes,
and the Lambda function uses the verified Cognito `sub` claim as the DynamoDB
key. Signed-in users can permanently delete their prediction and Cognito user
through an in-app confirmation dialog.

Production verification and password-recovery messages are sent as
`Predict Playoffs <no-reply@predictplayoffs.com>`. The domain is verified in
Amazon SES and authenticated with DKIM, a custom MAIL FROM domain, SPF, and
DMARC records in Cloudflare. Cognito continues to use its built-in delivery
service so these transactional messages do not depend on SES production-access
approval.

Leaderboard profiles are stored separately from private predictions. Names are
trimmed and reserved case-insensitively, so capitalization cannot be used to
duplicate another account's name. New and existing accounts are prompted for a
leaderboard name the first time they select **Save prediction**. Deleting an
account releases its name for someone else to use.

The public leaderboard returns leaderboard name, playoff-field and seeding
points, playoff-round points, total points, and rank. Each leaderboard name
links to a read-only view of that player's saved bracket. Public bracket views
do not expose email addresses, Cognito identifiers, profile keys, or editing
controls.

Signed-in users can create or join multiple private groups using a unique group
name and shared password. Group passwords are salted and hashed with PBKDF2
before storage. Members can also copy a private invite link; an authenticated
recipient who accepts the link joins without entering the shared password. A
group leaderboard can only be loaded by a current member and uses the same live
scoring as the global leaderboard, filtered to members with saved predictions.
Deleting an account removes all of its group memberships.

Win-total projections, leaderboard scores, and read-only leaderboard brackets
are public. Reading or writing your own saved prediction requires a signed-in
account.

## Scoring

Saved predictions earn five points for each correct playoff team, five bonus
points for each correct division winner, and five, three, or two bonus points
for an exact seed depending on whether it is seed 1, seeds 2–4, or seeds 5–7.
Correct advancing teams earn five points in the Wild Card round, ten in the
Divisional round, twenty for a conference championship, and forty for the
Super Bowl championship. The maximum is 300 points.

Playoff rounds are scored by advancement rather than exact matchup. A team that
advances earns its round points even when its real opponent differs from the
predicted bracket, and an earlier miss does not invalidate a correct later-round
pick.

The current source of truth is
`backend/lambda/season_results.json`. Empty fields are treated as outcomes that
are not yet scoreable. As the season progresses, add only known or currently
published outcomes, update the status and timestamp, and deploy. Scores are
calculated when a saved prediction is read; score data is not persisted in
DynamoDB.

## Development workflow

The `dev` branch deploys automatically through GitHub Actions. Make changes
locally, run the relevant fast checks, push to `dev`, and perform functional or
integration testing in the deployed dev environment. After validation, merge
`dev` into `prod`. A successful push to `prod` runs the same checks, applies the
production Terraform stack, and creates a GitHub release with generated notes
for the deployed changes. This keeps Cognito, API Gateway, Lambda, and DynamoDB
behavior identical to the architecture being tested.

Run all local checks from the repository root:

```powershell
node --check frontend/app.js
node --check frontend/bootstrap.js
node --check frontend/leaderboard.js
node --check frontend/picks.js
node --check frontend/shell.js
python -m py_compile backend/lambda/app.py
python -m unittest discover -s backend -p "test_*.py"
terraform fmt -check -recursive terraform
terraform -chdir=terraform/envs/dev init -backend=false
terraform -chdir=terraform/envs/dev validate
```

For a quick visual-only frontend preview, run:

```powershell
python -m http.server 8000 --directory frontend
```

Then visit `http://localhost:8000`. The preview uses bundled win totals and
exposes the bracket randomizer, but authentication, saved predictions, and live
odds are intentionally unavailable. Test those behaviors in the deployed dev
environment.

The deployed frontend uses clean page URLs: `/` for the landing page, `/picks`
for the prediction builder, `/leaderboard` for public and private standings,
and `/scoring` for the scoring rules. In the basic local file server, open the
corresponding `.html` files for the three non-home pages.

Use `http://localhost:8000/?preview=leaderboard-name` to visually inspect the
leaderboard-name dialog that opens from **Save prediction** without an
authenticated backend. The static preview also shows sample leaderboard rows.

Every successful `dev` deployment idempotently seeds seven demo leaderboard
participants with completed brackets and two password-protected groups. Join
the groups from a normal dev account with these shared demo credentials:

- **Demo Sunday Huddle** — `HuddleDemo26!`
- **Demo Gridiron Rivals** — `RivalsDemo26!`

These are DynamoDB-only demo participants rather than Cognito login accounts.
They exist to populate global and group standings without requiring disposable
email inboxes or verification codes. Production is never seeded.

## Site analytics

The deployed dev and production sites record privacy-conscious, first-party
analytics in their existing backend Lambda log groups. They use random browser
and tab-session IDs, do not send email addresses, IP addresses, query strings,
or referrers, and honor the browser's Do Not Track and Global Privacy Control
settings. Monitoring remains disabled in local previews.

In CloudWatch Logs Insights, select the environment's backend log group
(`/aws/lambda/nfl-playoff-predictor-dev-backend` or
`/aws/lambda/nfl-playoff-predictor-backend`) and use this query for daily
traffic:

```text
fields @timestamp, event, visitorId, sessionId
| filter type = "site_analytics" and event = "page_view"
| stats count(*) as pageViews, count_distinct(sessionId) as sessions,
    count_distinct(visitorId) as approximateUniqueVisitors by bin(1d) as day
| sort day desc
```

Use this query for page popularity and conversion events:

```text
fields event, page, sessionId
| filter type = "site_analytics"
| stats count(*) as events, count_distinct(sessionId) as sessions by event, page
| sort events desc
```

The tracked conversion events are account creation, sign-in, prediction save,
group creation, password-based group join, and invite-based group join.

Terraform also creates a CloudWatch dashboard for each environment:
`nfl-playoff-predictor-dev-analytics` and
`nfl-playoff-predictor-analytics`. Each opens on a seven-day view with visitor,
session, page-view, and prediction-save summaries; traffic and page-popularity
charts; conversion and engagement breakdowns; recent sessions; and backend
Lambda health. Each deployment summary includes a direct link to its dashboard.

## Scoring options

Classic remains out of 300. Upset Edge is Classic plus a fixed, nonnegative
Upset Bonus for each correct pick: `Classic points × (18 - win total) / 8.5`.
Each pick's bonus is rounded half up to hundredths before summing. Every correct pick earns full Classic credit plus its bonus; lower-projected
teams earn bigger bonuses. Incorrect or missing picks earn zero. No allocations
or bracket normalization remain. The same team picked for the same outcome
always earns the same points, independently of every other pick.

`backend/lambda/scoring_odds.json` freezes the existing bundled 2026 market
snapshot for everyone. Scoring never reads the live odds cache. Do not change
this snapshot during a season. Prepare a matching snapshot when rolling over
`season_results.json` to a new season. These are win-total bonuses, not implied
game moneyline probabilities. Upset Edge totals can exceed 300; API `maximum` is
null for Upset Edge and `classicMaximum` remains 300. `upsetBonus` is reported
separately in the score and category breakdowns.

Leaderboards return both totals in each entry's `scores`; the public UI can sort
by either total or any visible scoring column. Groups store `scoringOption` (`classic` or `vegas`) at creation,
and use it for ranking. Legacy groups default to `classic`; joining does not
change a group's option. Run the ranking UI regression with
`node --test backend/test_leaderboard.cjs` alongside the Python suite.

## Repository layout

```text
frontend/          Multi-page browser application and shared page shell
backend/           Lambda handler and backend tests
terraform/         AWS infrastructure, state, and deployment guide
README.md          Project overview and development workflow
```

See `terraform/README.md` for AWS deployment instructions.
