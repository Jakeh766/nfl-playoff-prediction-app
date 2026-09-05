# Terraform bootstrap

This root creates the resources required before automated dev and production
deployments can use Terraform:

- a private, encrypted, versioned S3 state bucket with native lock-file support;
- the GitHub Actions OIDC provider for this AWS account;
- deployment roles separately trusted by this repository's `dev` and `prod`
  environments;
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
administrator before rerunning the dev deployment:

```powershell
terraform -chdir=terraform/bootstrap init
terraform -chdir=terraform/bootstrap plan
terraform -chdir=terraform/bootstrap apply
```
