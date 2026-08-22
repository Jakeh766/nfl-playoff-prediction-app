variable "aws_region" {
  description = "AWS region used by the application and Terraform state bucket."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Base name for project resources."
  type        = string
  default     = "nfl-playoff-predictor"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the dev deployment role."
  type        = string
  default     = "Jakeh766/nfl-playoff-prediction-app"
}

variable "github_environment" {
  description = "GitHub environment allowed to assume the dev deployment role."
  type        = string
  default     = "dev"
}

variable "dev_api_id" {
  description = "Existing development API Gateway API identifier."
  type        = string
  default     = "5t6a237dsh"
}

variable "dev_cloudfront_distribution_id" {
  description = "Existing development CloudFront distribution identifier."
  type        = string
  default     = "E1CD3UDECRME7H"
}

variable "dev_cloudfront_oac_id" {
  description = "Existing development CloudFront origin access control identifier."
  type        = string
  default     = "E2OO7GM9DG3RG"
}

variable "dev_cloudfront_cache_policy_id" {
  description = "Existing development CloudFront cache policy identifier."
  type        = string
  default     = "b50d8bb7-5f46-4836-8ecb-cf0c496fa943"
}
