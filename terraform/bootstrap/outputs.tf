output "state_bucket_name" {
  description = "S3 bucket that stores Terraform state."
  value       = aws_s3_bucket.terraform_state.id
}

output "github_actions_role_arn" {
  description = "Role assumed by the GitHub dev environment through OIDC."
  value       = aws_iam_role.github_dev_deploy.arn
}

output "github_prod_actions_role_arn" {
  description = "Role assumed by the GitHub prod environment through OIDC."
  value       = aws_iam_role.github_prod_deploy.arn
}

output "github_oidc_provider_arn" {
  description = "GitHub Actions OIDC provider ARN."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "github_oidc_subject" {
  description = "Exact GitHub OIDC subject allowed by the role trust policy."
  value       = local.github_oidc_subject
}

output "github_prod_oidc_subject" {
  description = "Exact GitHub OIDC subject allowed by the prod role trust policy."
  value       = local.github_prod_oidc_subject
}
