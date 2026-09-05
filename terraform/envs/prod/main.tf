terraform {
  required_version = ">= 1.6"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    key          = "nfl-playoff-predictor/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = "prod"
      ManagedBy   = "Terraform"
    }
  }
}

resource "aws_acm_certificate" "site" {
  domain_name               = var.site_domain_name
  subject_alternative_names = ["www.${var.site_domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

import {
  to = aws_acm_certificate.site
  id = "arn:aws:acm:us-east-1:410533922944:certificate/88d94836-8995-4c91-b901-a59668b8da96"
}

module "nfl_app" {
  source = "../../modules/app"

  aws_region   = var.aws_region
  environment  = "prod"
  project_name = var.project_name

  # Preserve the names of already-deployed production resources.
  resource_prefix            = var.project_name
  prediction_lock_at         = var.prediction_lock_at
  cache_ttl_seconds          = var.cache_ttl_seconds
  api_throttling_rate_limit  = var.api_throttling_rate_limit
  api_throttling_burst_limit = var.api_throttling_burst_limit
  cloudfront_price_class     = var.cloudfront_price_class
  cloudfront_aliases         = [var.site_domain_name, "www.${var.site_domain_name}"]
  acm_certificate_arn        = aws_acm_certificate.site.arn
  cognito_email_domain       = var.site_domain_name
  frontend_dir               = abspath("${path.root}/../../../frontend")
  lambda_source_dir          = abspath("${path.root}/../../../backend/lambda")
  lambda_zip_path            = abspath("${path.root}/lambda.zip")
}

output "app_url" {
  value = module.nfl_app.app_url
}

output "cloudfront_domain_name" {
  value = module.nfl_app.cloudfront_domain_name
}

output "certificate_validation_records" {
  description = "DNS CNAME records that must remain in Cloudflare for ACM validation and renewal."
  value = {
    for option in aws_acm_certificate.site.domain_validation_options : option.domain_name => {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  }
}

output "api_url" {
  value = module.nfl_app.api_url
}

output "frontend_bucket" {
  value = module.nfl_app.frontend_bucket
}

output "cache_table" {
  value = module.nfl_app.cache_table
}

output "predictions_table" {
  value = module.nfl_app.predictions_table
}

output "profiles_table" {
  value = module.nfl_app.profiles_table
}

output "groups_table" {
  value = module.nfl_app.groups_table
}

output "cognito_user_pool_id" {
  value = module.nfl_app.cognito_user_pool_id
}

output "cognito_client_id" {
  value = module.nfl_app.cognito_client_id
}

# These moves preserve the existing production resources as they enter the module.
moved {
  from = data.archive_file.lambda_zip
  to   = module.nfl_app.data.archive_file.lambda_zip
}

moved {
  from = data.aws_caller_identity.current
  to   = module.nfl_app.data.aws_caller_identity.current
}

moved {
  from = aws_apigatewayv2_api.api
  to   = module.nfl_app.aws_apigatewayv2_api.api
}

moved {
  from = aws_apigatewayv2_integration.lambda
  to   = module.nfl_app.aws_apigatewayv2_integration.lambda
}

moved {
  from = aws_apigatewayv2_route.prediction_delete
  to   = module.nfl_app.aws_apigatewayv2_route.prediction_delete
}

moved {
  from = aws_apigatewayv2_route.prediction_get
  to   = module.nfl_app.aws_apigatewayv2_route.prediction_get
}

moved {
  from = aws_apigatewayv2_route.prediction_put
  to   = module.nfl_app.aws_apigatewayv2_route.prediction_put
}

moved {
  from = aws_apigatewayv2_route.win_totals
  to   = module.nfl_app.aws_apigatewayv2_route.win_totals
}

moved {
  from = aws_apigatewayv2_stage.default
  to   = module.nfl_app.aws_apigatewayv2_stage.default
}

moved {
  from = aws_cloudfront_cache_policy.disabled
  to   = module.nfl_app.aws_cloudfront_cache_policy.disabled
}

moved {
  from = aws_cloudfront_distribution.app
  to   = module.nfl_app.aws_cloudfront_distribution.app
}

moved {
  from = aws_cloudfront_origin_access_control.frontend
  to   = module.nfl_app.aws_cloudfront_origin_access_control.frontend
}

moved {
  from = aws_dynamodb_table.predictions
  to   = module.nfl_app.aws_dynamodb_table.predictions
}

moved {
  from = aws_dynamodb_table.win_totals_cache
  to   = module.nfl_app.aws_dynamodb_table.win_totals_cache
}

moved {
  from = aws_iam_role.lambda
  to   = module.nfl_app.aws_iam_role.lambda
}

moved {
  from = aws_iam_role_policy.lambda_cache
  to   = module.nfl_app.aws_iam_role_policy.lambda_cache
}

moved {
  from = aws_iam_role_policy_attachment.lambda_logs
  to   = module.nfl_app.aws_iam_role_policy_attachment.lambda_logs
}

moved {
  from = aws_lambda_function.backend
  to   = module.nfl_app.aws_lambda_function.backend
}

moved {
  from = aws_lambda_permission.api_gateway
  to   = module.nfl_app.aws_lambda_permission.api_gateway
}

moved {
  from = aws_s3_bucket.frontend
  to   = module.nfl_app.aws_s3_bucket.frontend
}

moved {
  from = aws_s3_bucket_policy.frontend
  to   = module.nfl_app.aws_s3_bucket_policy.frontend
}

moved {
  from = aws_s3_bucket_public_access_block.frontend
  to   = module.nfl_app.aws_s3_bucket_public_access_block.frontend
}

moved {
  from = aws_s3_object.frontend
  to   = module.nfl_app.aws_s3_object.frontend
}
