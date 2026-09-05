output "app_url" {
  description = "Environment URL for the frontend and proxied API."
  value       = "https://${length(var.cloudfront_aliases) > 0 ? var.cloudfront_aliases[0] : aws_cloudfront_distribution.app.domain_name}"
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution hostname used as the DNS target for custom domains."
  value       = aws_cloudfront_distribution.app.domain_name
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

output "profiles_table" {
  description = "DynamoDB table containing leaderboard profiles and unique name reservations."
  value       = aws_dynamodb_table.profiles.name
}

output "groups_table" {
  description = "DynamoDB table containing private groups and memberships."
  value       = aws_dynamodb_table.groups.name
}

output "cognito_user_pool_id" {
  description = "Cognito user pool that owns application accounts."
  value       = aws_cognito_user_pool.users.id
}

output "cognito_client_id" {
  description = "Public browser app client ID used by the in-app authentication forms."
  value       = aws_cognito_user_pool_client.browser.id
}

output "analytics_dashboard_name" {
  description = "CloudWatch analytics dashboard name for environments where analytics are enabled."
  value       = try(aws_cloudwatch_dashboard.analytics[0].dashboard_name, null)
}

output "analytics_dashboard_url" {
  description = "AWS console URL for the CloudWatch analytics dashboard."
  value       = var.environment == "dev" ? "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.analytics[0].dashboard_name}" : null
}
