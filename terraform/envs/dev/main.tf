terraform {
  required_version = ">= 1.6"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = "dev"
      ManagedBy   = "Terraform"
    }
  }
}

module "nfl_app" {
  source = "../../modules/app"

  environment                = "dev"
  project_name               = var.project_name
  cache_ttl_seconds          = var.cache_ttl_seconds
  api_throttling_rate_limit  = var.api_throttling_rate_limit
  api_throttling_burst_limit = var.api_throttling_burst_limit
  cloudfront_price_class     = var.cloudfront_price_class
  frontend_dir               = abspath("${path.root}/../../../frontend")
  lambda_source_dir          = abspath("${path.root}/../../../backend/lambda")
  lambda_zip_path            = abspath("${path.root}/lambda.zip")
}

output "app_url" {
  value = module.nfl_app.app_url
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
