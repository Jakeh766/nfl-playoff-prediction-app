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

output "cognito_user_pool_id" {
  description = "Cognito user pool that owns application accounts."
  value       = aws_cognito_user_pool.users.id
}

output "cognito_client_id" {
  description = "Public browser app client ID used by the OAuth PKCE flow."
  value       = aws_cognito_user_pool_client.browser.id
}

output "cognito_domain" {
  description = "Base URL for the Cognito managed login and OAuth endpoints."
  value       = "https://${aws_cognito_user_pool_domain.login.domain}.auth.${var.aws_region}.amazoncognito.com"
}
