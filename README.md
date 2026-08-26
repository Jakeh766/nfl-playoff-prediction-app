# Road to the Bowl

A self-contained NFL preseason playoff predictor. Users can:

- Create an email/password account through Amazon Cognito.
- Seed seven AFC and seven NFC teams.
- Predict every playoff game, including conference championships and the Super Bowl.
- Privately save, reopen, update, and delete one prediction per account.

In the AWS deployment, predictions are stored in DynamoDB and are available
across devices. The included local server stores development predictions in an
ignored `backend/.data` directory. It also refreshes projected season win totals
whenever the app loads, reading available sportsbook lines from VegasInsider
and using the median as a consensus projection for each team.

## Authentication

The deployed app uses Cognito managed login with the OAuth 2.0 authorization
code flow and PKCE. Email verification is required and MFA is off. API Gateway
validates Cognito access tokens before invoking the prediction routes, and the
Lambda function uses the verified Cognito `sub` claim as the DynamoDB key.

Win-total projections remain public. Prediction reads and writes require a
signed-in account.

## Run locally

Local sign-in uses the dev environment's deployed Cognito user pool. After
applying the dev Terraform stack, configure the local server in PowerShell:

```powershell
$env:COGNITO_DOMAIN = terraform -chdir=terraform/envs/dev output -raw cognito_domain
$env:COGNITO_CLIENT_ID = terraform -chdir=terraform/envs/dev output -raw cognito_client_id
python backend/server.py
```

Then visit `http://localhost:8000`, which is registered as a dev-only Cognito
callback and logout URL.

The local server is bound to loopback and decodes Cognito access-token claims
without independently checking their signature. Production signature and claim
validation is performed by API Gateway's JWT authorizer. Do not expose the
local development server to a network.

After updating `backend/server.py`, stop any copy already running with `Ctrl+C`, start it
again, and refresh the browser. A running Python process does not reload changed
server code automatically.

If the live table cannot be reached, the server uses the most recent successful
cache, then a bundled 2026 market snapshot as a final fallback. The app labels
which source is active.

## Repository layout

```text
frontend/          Browser application
backend/           Local development server and Lambda handler
terraform/         AWS infrastructure, state, and deployment guide
README.md          Project overview and local setup
```

See `terraform/README.md` for AWS deployment instructions.
