# Road to the Bowl

A self-contained NFL preseason playoff predictor. Users can:

- Create an email/password account through Amazon Cognito.
- Seed seven AFC and seven NFC teams.
- Predict every playoff game, including conference championships and the Super Bowl.
- Privately save, reopen, update, and delete one prediction per account.

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
key.

Win-total projections remain public. Prediction reads and writes require a
signed-in account.

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

## Repository layout

```text
frontend/          Browser application
backend/           Lambda handler and backend tests
terraform/         AWS infrastructure, state, and deployment guide
README.md          Project overview and development workflow
```

See `terraform/README.md` for AWS deployment instructions.
