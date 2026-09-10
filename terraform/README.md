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

Both environments share the application architecture, with environment-specific
Cognito email delivery:

```text
Browser
  -> CloudFront
       -> private S3 bucket (index.html, app.js, styles.css, generated auth-config.js)
       -> Cognito user pool APIs (in-app email/password forms)
            -> dev: Cognito built-in email
            -> prod: KMS -> custom email sender Lambda -> Resend
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

The states are separate objects in the shared state bucket:

- Bootstrap: S3 object `nfl-playoff-predictor/bootstrap/terraform.tfstate`
- Dev: S3 object `nfl-playoff-predictor/dev/terraform.tfstate`
- Prod: S3 object `nfl-playoff-predictor/prod/terraform.tfstate`

Never copy one environment's state into the other.

## Automatic deployments

Every push to the `dev` branch runs `.github/workflows/deploy-dev.yml`. The
workflow checks the JavaScript and Python syntax, checks and validates the
Terraform configuration, and then plans and applies the dev environment. It
uses GitHub OIDC to obtain temporary AWS credentials.

Every push to the `prod` branch runs `.github/workflows/deploy-prod.yml`. The
workflow runs the same checks, verifies that the remote production state
contains the existing live resources, and then plans and applies production.
After a successful apply it creates a `prod-<run>-<commit>` GitHub release with
GitHub-generated release notes. The release is not created when tests or the
deployment fail.

The one-time AWS prerequisites are managed by `terraform/bootstrap`:

- state bucket `nfl-playoff-predictor-tfstate-410533922944`;
- GitHub OIDC provider `token.actions.githubusercontent.com`;
- role `nfl-playoff-predictor-dev-github-actions`, trusted only by the
  `Jakeh766/nfl-playoff-prediction-app` repository's `dev` environment;
- role `nfl-playoff-predictor-prod-github-actions`, trusted only by the
  repository's `prod` environment.
- role `nfl-playoff-predictor-codex-audit`, limited to read-only access for the
  four production DynamoDB tables and their backups.
- login-only IAM user `nfl-playoff-predictor-codex-audit-login`, permitted only
  to authenticate with `aws login` and assume the audit role. It has no direct
  application access or access keys.

The existing dev state has been migrated into the state bucket. The workflow
also verifies that remote state is nonempty before it plans or applies.

## Local read-only AWS inspection

Routine deployments use the GitHub OIDC roles above and do not need persistent
local AWS credentials. The `codex-audit-login` profile provides a short-lived,
interactive IAM-user session; `codex-audit` assumes the Terraform-managed
`nfl-playoff-predictor-codex-audit` role from that source. The login-only user
can assume that role but has no direct application permissions or access keys.

Authenticate the source session, then verify the constrained audit role:

```powershell
aws login --profile codex-audit-login
aws sts get-caller-identity --profile codex-audit --output json
```

The expected account is `410533922944`. Complete browser authentication and MFA
interactively; never create, paste, or store root access keys. Keep audit commands
read-only and select only the fields needed for the report rather than returning
raw table items or secret values. Do not use `nfl-prod-setup` for application
inspection; it exists only to refresh the source session and perform explicitly
requested bootstrap administration.

The GitHub environment named `dev` must define these environment variables:

- `AWS_ROLE_ARN` =
  `arn:aws:iam::410533922944:role/nfl-playoff-predictor-dev-github-actions`
- `TF_STATE_BUCKET` = `nfl-playoff-predictor-tfstate-410533922944`

The GitHub environment named `prod` must define:

- `AWS_ROLE_ARN` =
  `arn:aws:iam::410533922944:role/nfl-playoff-predictor-prod-github-actions`
- `TF_STATE_BUCKET` = `nfl-playoff-predictor-tfstate-410533922944`

The `prod` environment must also define its encrypted `RESEND_API_KEY` secret
with a Resend sending key that begins with `re_`.

## One-time production automation setup

Apply the bootstrap root with separately authenticated AWS administrator
credentials so the GitHub Actions roles exist and can manage the custom sender
Lambda, KMS key, and Resend secret:

```powershell
terraform -chdir=terraform/bootstrap init
terraform -chdir=terraform/bootstrap plan
terraform -chdir=terraform/bootstrap apply
```

Reapply this root once after adding the Resend integration, before running the
first updated `dev` deployment. The environment deployment role intentionally
cannot expand its own IAM permissions.

Then migrate the existing local production state into the shared state bucket.
Do this from the checkout that contains the existing
`terraform/envs/prod/terraform.tfstate` file:

```powershell
terraform -chdir=terraform/envs/prod init -migrate-state -backend-config="bucket=nfl-playoff-predictor-tfstate-410533922944"
terraform -chdir=terraform/envs/prod state list
```

Confirm that the state list includes the existing API Gateway, CloudFront,
DynamoDB, and S3 resources. Finally, create the GitHub `prod` environment with
the variables above and create the `prod` branch from the current production
branch. Protect `prod` so changes arrive through reviewed pull requests, then
merge `dev` into `prod` to deploy.

## Review and deploy dev

From the repository root:

```powershell
terraform -chdir=terraform/envs/dev init
npm ci --omit=dev --prefix backend/custom-email-sender
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

## Review prod locally

Only review prod after testing dev. The automated workflow applies the saved
plan after changes reach the `prod` branch:

```powershell
terraform -chdir=terraform/envs/prod init -backend-config="bucket=nfl-playoff-predictor-tfstate-410533922944"
terraform -chdir=terraform/envs/prod plan
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

## Cognito email delivery

Dev uses Cognito's built-in email service, so it does not create a KMS key,
Resend secret, or custom email sender Lambda. Prod routes account email to the
dedicated Node.js Lambda instead. Cognito encrypts production codes with a
customer-managed KMS key; the Lambda uses the AWS Encryption SDK to decrypt
them and sends both HTML and plain-text messages through Resend. The Lambda
never logs codes, API keys, or full recipient addresses.

Before the first deployment:

1. Add `predictplayoffs.com` in Resend and publish the exact SPF and DKIM records
   Resend supplies in Cloudflare. Wait until Resend reports the domain as
   verified. Existing SES DNS records can remain while SES approval is pending,
   provided Cloudflare contains only one SPF TXT record per hostname.
2. Create a Resend API key with sending access. Store it as the encrypted GitHub
   environment secret `RESEND_API_KEY` in `prod`.
3. Apply `terraform/bootstrap` once with AWS administrator credentials to grant
   the existing GitHub deployment roles permission to manage the new Lambda,
   KMS, Secrets Manager, and IAM resources.
4. Run the prod workflow when you are ready to deploy the custom sender. Its
   configuration check fails before Terraform changes anything if
   `RESEND_API_KEY` is missing.
5. Create a production test account, resend its confirmation code, and exercise
   password recovery after deployment.

Terraform writes the API key to Secrets Manager with the provider's write-only
field. The root and module variables are ephemeral, so the value is absent from
saved plans and state. To rotate the key later, replace the GitHub secret and
increment `resend_api_key_version` in the relevant module call.

Review AWS pricing and the target site's automated-access policy before
deploying. These resources are not guaranteed to remain free.
