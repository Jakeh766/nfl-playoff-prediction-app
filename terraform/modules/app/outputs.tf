output "app_url" {
  description = "Environment URL for the frontend and proxied API."
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "api_url" {
  description = "Direct API Gateway endpoint, mainly useful for troubleshooting."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "frontend_bucket" {
  description = "Private S3 bucket containing the frontend assets."
  value       = aws_s3_bucket.frontend.bucket
}

output "cache_table" {
  description = "DynamoDB table containing the latest successful scrape."
  value       = aws_dynamodb_table.win_totals_cache.name
}

output "predictions_table" {
  description = "DynamoDB table containing saved brackets."
  value       = aws_dynamodb_table.predictions.name
}
