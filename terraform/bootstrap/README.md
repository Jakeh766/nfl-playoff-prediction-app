# Terraform bootstrap

This root creates the resources required before automated dev deployments can
use Terraform:

- a private, encrypted, versioned S3 state bucket with native lock-file support;
- the GitHub Actions OIDC provider for this AWS account;
- a deployment role trusted only by this repository's `dev` environment;
- an inline policy scoped to the existing dev stack and dev state object.

The deployment policy also permits Terraform to create a dev-tagged Cognito
user pool and manage the app client, domain, and managed-login branding inside
dev-tagged user pools. Cognito inventory access is read-only and creation is
restricted by the `Project` and `Environment` request tags.

The initial apply used local state because the S3 backend did not exist yet.
The bootstrap state now lives at
`nfl-playoff-predictor/bootstrap/terraform.tfstate` in the state bucket. The
application environments must never manage these bootstrap resources.

## Apply deployment-role changes

The GitHub Actions role cannot expand its own permissions. Changes to this
bootstrap root must be applied once with a separately authenticated AWS
administrator before rerunning the dev deployment:

```powershell
terraform -chdir=terraform/bootstrap init
terraform -chdir=terraform/bootstrap plan
terraform -chdir=terraform/bootstrap apply
```
