# Terraform bootstrap

This root creates the resources required before automated dev and production
deployments can use Terraform:

- a private, encrypted, versioned S3 state bucket with native lock-file support;
- the GitHub Actions OIDC provider for this AWS account;
- deployment roles separately trusted by this repository's `dev` and `prod`
  environments;
- a login-only IAM user and read-only production DynamoDB audit role for the
  local `codex-audit` profile; the user has AWS's local-development sign-in
  policy plus permission to assume only the audit role;
- inline policies scoped to each environment's stack and state object.

The deployment policies also permit Terraform to create environment-tagged
Cognito user pools and manage their app clients. They retain delete and
describe access for the retired managed-login resources until existing
environments have removed them. Cognito inventory access is read-only and
creation is restricted by the `Project` and `Environment` request tags.

The initial apply used local state because the S3 backend did not exist yet.
The bootstrap state now lives at
`nfl-playoff-predictor/bootstrap/terraform.tfstate` in the state bucket. The
application environments must never manage these bootstrap resources.

## Apply deployment-role changes

The GitHub Actions role cannot expand its own permissions. Changes to this
bootstrap root must be applied once with a separately authenticated AWS
administrator before rerunning the affected dev or prod deployment:

```powershell
terraform -chdir=terraform/bootstrap init
terraform -chdir=terraform/bootstrap plan
terraform -chdir=terraform/bootstrap apply
```

## Production admin analytics permissions

Before promoting production admin analytics, the bootstrap administrator must
review and apply this root using the process above. `ManageProdCognitoGroups`
adds only `CreateGroup`, `GetGroup`, `UpdateGroup`, and `DeleteGroup`, scoped to
user pools with both the application Project tag and `Environment=prod`.
Cognito group IAM operations use the owning pool ARN; there is no separate group
ARN/name condition. It grants no user-membership operations.

`ProdAdminAnalyticsCache` grants only table lifecycle and read-metadata operations
on the exact production analytics-cache ARN. Existing production API, frontend,
Lambda and inline-role-policy grants already cover those related changes.
Neither the deployment role nor Terraform reads provider parameter values;
only the runtime Lambda receives two exact `ssm:GetParameter` grants.
The read-only `codex-audit` role remains unchanged: it cannot read remote
Terraform state, inspect deployment IAM, or perform bootstrap administration.
See [admin analytics setup](../../docs/admin-analytics.md) for promotion and secrets.

## Production response-header policy permission

The browser-security deployment creates a custom CloudFront response-header
policy. Both deployment roles need its five lifecycle operations: create,
get, get configuration, update, and delete. AWS does not support resource-level
permissions for `CreateResponseHeadersPolicy`, so its separate creation statement
requires `Resource: "*"`. The other four operations remain scoped to response-header
policies in this AWS account using `response-headers-policy/*`. See the
[CloudFront authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

Production run 13 failed with `AccessDenied` for
`cloudfront:CreateResponseHeadersPolicy`. Its Groups database indexes and other
completed resources remain recorded in Terraform state. Do not roll back or
recreate the database. Once an administrator has applied the production-role
permission correction, rerun the failed jobs in that production run. Terraform
will refresh state and plan the remaining work; the release job runs only after
the deployment succeeds.

The reviewed grant is available in
[`prod-response-headers-permission.json`](prod-response-headers-permission.json).
It contains only the two additive statements for the existing
`nfl-playoff-predictor-prod-github-actions` role. If applying it in the IAM
console, append both statements to the existing
`nfl-playoff-predictor-prod-terraform-deploy` inline policy; do not replace the
existing policy with this small document. The matching statements in `main.tf`
keeps future bootstrap applies consistent.

Changing live IAM permissions requires explicit authorization under
[`AGENTS.md`](../../AGENTS.md). Use a separately authenticated administrator;
the deployment and audit roles cannot grant this access themselves.
