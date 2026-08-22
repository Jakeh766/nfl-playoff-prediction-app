terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # This bucket was created by the bootstrap stack's initial local-state apply.
  backend "s3" {
    bucket       = "nfl-playoff-predictor-tfstate-410533922944"
    key          = "nfl-playoff-predictor/bootstrap/terraform.tfstate"
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
      Environment = "bootstrap"
      ManagedBy   = "Terraform"
    }
  }
}
