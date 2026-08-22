# Terraform bootstrap

This root creates the resources required before automated dev deployments can
use Terraform:

- a private, encrypted, versioned S3 state bucket with native lock-file support;
- the GitHub Actions OIDC provider for this AWS account;
- a deployment role trusted only by this repository's `dev` environment;
- an inline policy scoped to the existing dev stack and dev state object.

The initial apply used local state because the S3 backend did not exist yet.
The bootstrap state now lives at
`nfl-playoff-predictor/bootstrap/terraform.tfstate` in the state bucket. The
application environments must never manage these bootstrap resources.
