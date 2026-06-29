variable "environment" {
  description = "Deployment environment name used in resource names and Lambda configuration."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "project_name" {
  description = "Lowercase name used as the prefix for AWS resources."
  type        = string
  default     = "nfl-playoff-predictor"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-42 lowercase letters, numbers, or hyphens."
  }
}

variable "resource_prefix" {
  description = "Optional complete resource-name prefix. Prod uses this to preserve legacy resource names."
  type        = string
  default     = null
}

variable "frontend_dir" {
  description = "Absolute path to the frontend files uploaded to S3."
  type        = string
}

variable "lambda_source_dir" {
  description = "Absolute path to the Lambda source directory."
  type        = string
}

variable "lambda_zip_path" {
  description = "Environment-specific output path for the generated Lambda archive."
  type        = string
}

variable "cache_ttl_seconds" {
  description = "How long a successful sportsbook scrape is reused before refreshing."
  type        = number
  default     = 21600

  validation {
    condition     = var.cache_ttl_seconds >= 300
    error_message = "cache_ttl_seconds must be at least 300 seconds."
  }
}

variable "api_throttling_rate_limit" {
  description = "Maximum sustained requests per second across API Gateway routes."
  type        = number
  default     = 10

  validation {
    condition     = var.api_throttling_rate_limit > 0
    error_message = "api_throttling_rate_limit must be greater than 0."
  }
}

variable "api_throttling_burst_limit" {
  description = "Maximum burst capacity across API Gateway routes."
  type        = number
  default     = 20

  validation {
    condition     = var.api_throttling_burst_limit >= 1 && floor(var.api_throttling_burst_limit) == var.api_throttling_burst_limit
    error_message = "api_throttling_burst_limit must be a positive whole number."
  }
}

variable "cloudfront_price_class" {
  description = "CloudFront edge locations to use. PriceClass_100 is the smallest footprint."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition = contains(
      ["PriceClass_100", "PriceClass_200", "PriceClass_All"],
      var.cloudfront_price_class
    )
    error_message = "cloudfront_price_class must be PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}
