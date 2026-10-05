# These resources, routes, and permissions exist only in dev.
resource "aws_cognito_user_group" "admin" {
  count        = var.environment == "dev" ? 1 : 0
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.users.id
  description  = "Private Predict Playoffs analytics dashboard administrators"
}

resource "aws_dynamodb_table" "admin_analytics_cache" {
  count        = var.environment == "dev" ? 1 : 0
  name         = "${local.resource_prefix}-admin-analytics-cache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cacheKey"
  attribute {
    name = "cacheKey"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_iam_role_policy" "admin_analytics" {
  count = var.environment == "dev" ? 1 : 0
  name  = "${local.resource_prefix}-admin-analytics"
  role  = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.admin_analytics_cache[0].arn
      },
      {
        Effect = "Allow"
        Action = ["ssm:GetParameter"]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.resource_prefix}/admin-analytics/config",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.resource_prefix}/admin-analytics/google-service-account",
        ]
      },
      {
        Effect = "Allow"
        Action = ["logs:StartQuery"]
        Resource = [
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${local.analytics_log_group}",
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${local.analytics_log_group}:*",
        ]
      },
      {
        # AWS does not support resource-level permissions for query result IDs.
        Effect   = "Allow"
        Action   = ["logs:GetQueryResults", "logs:StopQuery"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_apigatewayv2_route" "admin_analytics" {
  for_each = var.environment == "dev" ? toset([
    "GET /api/admin/analytics",
    "GET /api/admin/analytics/{provider}",
  ]) : toset([])
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

output "admin_analytics_config_parameter" {
  value = var.environment == "dev" ? "/${local.resource_prefix}/admin-analytics/config" : null
}

output "admin_google_credentials_parameter" {
  value = var.environment == "dev" ? "/${local.resource_prefix}/admin-analytics/google-service-account" : null
}
