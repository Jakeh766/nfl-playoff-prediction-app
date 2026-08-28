# Road to the Bowl

A self-contained NFL preseason playoff predictor. Users can:

- Create an email/password account through Amazon Cognito.
- Claim a unique public leaderboard name when saving a prediction.
- Seed seven AFC and seven NFC teams.
- Predict every playoff game, including conference championships and the Super Bowl.
- Track a private 302-point score as official results become available.
- Create or join password-protected groups with their own member-only leaderboards.
- Privately save, reopen, update, and delete one prediction per account.
- Permanently delete their saved prediction and account from the signed-in view.

Predictions are stored in DynamoDB and are available across devices. The Lambda
backend refreshes projected season win totals when the app loads, reading
available sportsbook lines from VegasInsider and using the median as a
consensus projection for each team.

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

Leaderboard profiles are stored separately from private predictions. Names are
trimmed and reserved case-insensitively, so capitalization cannot be used to
duplicate another account's name. New and existing accounts are prompted for a
leaderboard name the first time they select **Save prediction**. Deleting an
account releases its name for someone else to use.

The public leaderboard returns only leaderboard name, playoff-field and seeding
points, playoff-round points, total points, and rank. It does not expose email
addresses, Cognito identifiers, or private bracket picks.

Signed-in users can create or join multiple private groups using a unique group
name and shared password. Group passwords are salted and hashed with PBKDF2
before storage. A group leaderboard can only be loaded by a current member and
uses the same live scoring as the global leaderboard, filtered to members with
saved predictions. Deleting an account removes all of its group memberships.

Win-total projections remain public. Prediction reads and writes require a
signed-in account.

## Scoring

Saved predictions earn five points for each correct playoff team, five bonus
points for each correct division winner, and three bonus points for each exact
seed. Correct advancing teams earn five points in the Wild Card round, ten in
the Divisional round, twenty for a conference championship, and forty for the
Super Bowl championship. The maximum is 302 points.

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
integration testing in the deployed dev environment. This keeps Cognito, API
Gateway, Lambda, and DynamoDB behavior identical to the architecture being
tested.

Run all local checks from the repository root:

```powershell
node --check frontend/app.js
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

Use `http://localhost:8000/?preview=leaderboard-name` to visually inspect the
leaderboard-name dialog that opens from **Save prediction** without an
authenticated backend. The static preview also shows sample leaderboard rows.

## Repository layout

```text
frontend/          Browser application
backend/           Lambda handler and backend tests
terraform/         AWS infrastructure, state, and deployment guide
README.md          Project overview and development workflow
```

See `terraform/README.md` for AWS deployment instructions.
