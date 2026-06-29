# AWS Terraform environments

The AWS deployment is defined once in `modules/app` and instantiated by two
independent Terraform roots:

```text
terraform/
  modules/app/    Reusable S3, CloudFront, API Gateway, Lambda, and DynamoDB stack
  envs/dev/       Development resources and state
  envs/prod/      Production resources and existing production state
```

Both environments deploy the same architecture:

```text
Browser
  -> CloudFront
       -> private S3 bucket (index.html, app.js, styles.css)
       -> API Gateway /api/* -> Lambda -> VegasInsider
                                      -> DynamoDB scrape cache
                                      -> DynamoDB saved predictions
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

- Dev: `terraform/envs/dev/terraform.tfstate`
- Prod: `terraform/terraform.tfstate` (the existing state location)

Never copy one environment's state into the other.

## Review and deploy dev

From the repository root:

```powershell
terraform -chdir=terraform/envs/dev init
terraform -chdir=terraform/envs/dev plan
terraform -chdir=terraform/envs/dev apply
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

The first prod plan after this refactor should show state-address moves into
`module.nfl_app`. Carefully review it and do not apply if it proposes replacing
the existing bucket, DynamoDB tables, API, Lambda, or CloudFront distribution.

## Configuration

Each environment has its own committed `terraform.tfvars`. Adjust dev settings
without affecting prod. The default API limits are 10 sustained requests per
second with a burst of 20, and successful scrape results are cached for six
hours.

Saved predictions use the normalized display name as their DynamoDB key. There
is no authentication yet, so anyone who knows or guesses a profile name can
view, replace, or delete that prediction.

Review AWS pricing and the target site's automated-access policy before
deploying. These resources are not guaranteed to remain free.
