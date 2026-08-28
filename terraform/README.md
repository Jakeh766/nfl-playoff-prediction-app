# AWS Terraform environments

The AWS deployment is defined once in `modules/app` and instantiated by two
independent Terraform roots:

```text
terraform/
  bootstrap/      State bucket and GitHub OIDC deployment role
  modules/app/    Reusable S3, CloudFront, API Gateway, Lambda, and DynamoDB stack
  envs/dev/       Development resources and state
  envs/prod/      Production resources and existing production state
```

Both environments deploy the same architecture:

```text
Browser
  -> CloudFront
       -> private S3 bucket (index.html, app.js, styles.css, generated auth-config.js)
       -> Cognito user pool APIs (in-app email/password forms)
       -> API Gateway
            -> public /api/win-totals -> Lambda -> VegasInsider
                                                  -> DynamoDB scrape cache
            -> JWT-protected /api/prediction -> Lambda
                                                -> DynamoDB saved predictions
            -> JWT-protected /api/profile    -> Lambda
                                                -> DynamoDB unique leaderboard profiles
            -> public /api/leaderboard       -> Lambda
                                                -> Sanitized scores and leaderboard names
```

## Environment isolation

Development resource names include `-dev-`, and supported AWS resources receive
these provider-level tags:

```text
Project     = nfl-playoff-predictor
Environment = dev
ManagedBy   = Terraform
```

Production receives the equivalent `Environment = prod` tag. Its existing
resource names are intentionally preserved to prevent replacement of the live
stack during this refactor. The `moved` blocks in `envs/prod/main.tf` migrate
the existing state addresses into the shared module without recreating them.

The states are separate:

- Bootstrap: S3 object `nfl-playoff-predictor/bootstrap/terraform.tfstate`
- Dev: S3 object `nfl-playoff-predictor/dev/terraform.tfstate`
- Prod: `terraform/envs/prod/terraform.tfstate`

Never copy one environment's state into the other.

## Automatic dev deployment

Every push to the `dev` branch runs `.github/workflows/deploy-dev.yml`. The
workflow checks the JavaScript and Python syntax, checks and validates the
Terraform configuration, and then plans and applies the dev environment. It
uses GitHub OIDC to obtain temporary AWS credentials.

The one-time AWS prerequisites are managed by `terraform/bootstrap`. It created:

- state bucket `nfl-playoff-predictor-tfstate-410533922944`;
- GitHub OIDC provider `token.actions.githubusercontent.com`;
- role `nfl-playoff-predictor-dev-github-actions`, trusted only by the
  `Jakeh766/nfl-playoff-prediction-app` repository's `dev` environment.

The existing dev state has been migrated into the state bucket. The workflow
also verifies that remote state is nonempty before it plans or applies.

The GitHub environment named `dev` must define these environment variables:

- `AWS_ROLE_ARN` =
  `arn:aws:iam::410533922944:role/nfl-playoff-predictor-dev-github-actions`
- `TF_STATE_BUCKET` = `nfl-playoff-predictor-tfstate-410533922944`

## Review and deploy dev

From the repository root:

```powershell
terraform -chdir=terraform/envs/dev init
terraform -chdir=terraform/envs/dev plan
terraform -chdir=terraform/envs/dev apply
```

After the state migration, pass the state bucket when initializing from a new
checkout:

```powershell
terraform -chdir=terraform/envs/dev init -backend-config="bucket=nfl-playoff-predictor-tfstate-410533922944"
```

Use the `app_url` output after the apply completes. Dev is a complete cloud
environment, so it creates its own CloudFront distribution and may take several
minutes to become available.

## Review and deploy prod

Only deploy prod after testing dev:

```powershell
terraform -chdir=terraform/envs/prod init
terraform -chdir=terraform/envs/prod plan
terraform -chdir=terraform/envs/prod apply
```

The authentication deployment creates a Cognito user pool, browser app client,
and an API Gateway JWT authorizer. Account creation, confirmation, sign-in, and
password recovery use the Cognito identity-provider API through forms hosted by
the application; no managed-login domain or OAuth redirect is used. It replaces
the public prediction routes with one protected `/api/prediction` resource
while leaving the existing predictions table in place. Carefully review the
production plan and do not apply if it proposes replacing the existing bucket,
DynamoDB tables, API, Lambda, or CloudFront distribution.

## Configuration

Each environment has its own committed `terraform.tfvars`. Adjust dev settings
without affecting prod. The default API limits are 10 sustained requests per
second with a burst of 20, and successful scrape results are cached for six
hours.

New saved predictions use the authenticated Cognito `sub` claim as their
DynamoDB key. Each account can access one private prediction. Existing
anonymous name-keyed rows remain in the table but are not returned or modified
by the authenticated API.

The module also publishes `cognito_user_pool_id` and `cognito_client_id`
outputs. Email verification is required and MFA is explicitly `OFF`.

Review AWS pricing and the target site's automated-access policy before
deploying. These resources are not guaranteed to remain free.
