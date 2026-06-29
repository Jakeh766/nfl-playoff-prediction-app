variable "aws_region" {
  description = "AWS region for the prod environment."
  type        = string
}

variable "project_name" {
  description = "Lowercase project name used in resource names and tags."
  type        = string
}

variable "cache_ttl_seconds" {
  description = "Seconds a successful sportsbook scrape is cached."
  type        = number
}

variable "api_throttling_rate_limit" {
  description = "Maximum sustained API Gateway requests per second."
  type        = number
}

variable "api_throttling_burst_limit" {
  description = "Maximum API Gateway burst capacity."
  type        = number
}

variable "cloudfront_price_class" {
  description = "CloudFront edge-location price class."
  type        = string
}
