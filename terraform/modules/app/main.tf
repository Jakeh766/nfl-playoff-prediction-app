data "aws_caller_identity" "current" {}

locals {
  resource_prefix = coalesce(var.resource_prefix, "${var.project_name}-${var.environment}")

  analytics_log_group = "/aws/lambda/${local.resource_prefix}-backend"

  frontend_files = merge({
    "goatcounter.js" = {
      source       = "${var.frontend_dir}/goatcounter.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "privacy" = {
      source       = "${var.frontend_dir}/privacy.html"
      content_type = "text/html; charset=utf-8"
    }
    "robots.txt" = {
      source       = "${var.frontend_dir}/robots.txt"
      content_type = "text/plain; charset=utf-8"
    }
    "sitemap.xml" = {
      source       = "${var.frontend_dir}/sitemap.xml"
      content_type = "application/xml; charset=utf-8"
    }
    "index.html" = {
      source       = "${var.frontend_dir}/index.html"
      content_type = "text/html; charset=utf-8"
    }
    "nba" = {
      source       = "${var.frontend_dir}/nba.html"
      content_type = "text/html; charset=utf-8"
    }
    "favicon.ico" = {
      source       = "${var.frontend_dir}/favicon.ico"
      content_type = "image/x-icon"
    }
    "apple-touch-icon.png" = {
      source       = "${var.frontend_dir}/apple-touch-icon.png"
      content_type = "image/png"
    }
    "picks" = {
      source       = "${var.frontend_dir}/picks.html"
      content_type = "text/html; charset=utf-8"
    }
    "leaderboard" = {
      source       = "${var.frontend_dir}/leaderboard.html"
      content_type = "text/html; charset=utf-8"
    }
    "scoring" = {
      source       = "${var.frontend_dir}/scoring.html"
      content_type = "text/html; charset=utf-8"
    }
    "scoring.js" = {
      source       = "${var.frontend_dir}/scoring.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "sports.js" = {
      source       = "${var.frontend_dir}/sports.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "shell.js" = {
      source       = "${var.frontend_dir}/shell.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "app.js" = {
      source       = "${var.frontend_dir}/app.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "leaderboard.js" = {
      source       = "${var.frontend_dir}/leaderboard.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "picks.js" = {
      source       = "${var.frontend_dir}/picks.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "bootstrap.js" = {
      source       = "${var.frontend_dir}/bootstrap.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "monitoring.js" = {
      source       = "${var.frontend_dir}/monitoring.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "styles.css" = {
      source       = "${var.frontend_dir}/styles.css"
      content_type = "text/css; charset=utf-8"
    }
    "assets/predict-playoffs-mark.png" = {
      source       = "${var.frontend_dir}/assets/predict-playoffs-mark.png"
      content_type = "image/png"
    }
    "assets/favicon-32x32.png" = {
      source       = "${var.frontend_dir}/assets/favicon-32x32.png"
      content_type = "image/png"
    }
    "assets/predict-playoffs-social.png" = {
      source       = "${var.frontend_dir}/assets/predict-playoffs-social.png"
      content_type = "image/png"
    }
    "assets/predict-playoffs-social-v2.png" = {
      source       = "${var.frontend_dir}/assets/predict-playoffs-social-v2.png"
      content_type = "image/png"
    }
    "assets/nba-western-conference.png" = {
      source       = "${var.frontend_dir}/assets/nba-western-conference.png"
      content_type = "image/png"
    }
    "assets/nba-eastern-conference.png" = {
      source       = "${var.frontend_dir}/assets/nba-eastern-conference.png"
      content_type = "image/png"
    }
    "assets/predict-playoffs-mark.svg" = {
      source       = "${var.frontend_dir}/assets/predict-playoffs-mark.svg"
      content_type = "image/svg+xml"
    }
    }, var.environment == "dev" ? {
    "admin/analytics" = {
      source       = "${var.frontend_dir}/admin-analytics.html"
      content_type = "text/html; charset=utf-8"
    }
    "admin-analytics.js" = {
      source       = "${var.frontend_dir}/admin-analytics.js"
      content_type = "application/javascript; charset=utf-8"
    }
    "admin-analytics.css" = {
      source       = "${var.frontend_dir}/admin-analytics.css"
      content_type = "text/css; charset=utf-8"
    }
  } : {})
}

resource "aws_dynamodb_table" "win_totals_cache" {
  name         = "${local.resource_prefix}-win-totals-cache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cacheKey"

  attribute {
    name = "cacheKey"
    type = "S"
  }
}

resource "aws_dynamodb_table" "predictions" {
  name                        = "${local.resource_prefix}-predictions"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "profileKey"
  deletion_protection_enabled = var.stateful_table_protection_enabled

  attribute {
    name = "profileKey"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.stateful_table_protection_enabled
  }
}

resource "aws_dynamodb_table" "profiles" {
  name                        = "${local.resource_prefix}-profiles"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "profileKey"
  deletion_protection_enabled = var.stateful_table_protection_enabled

  attribute {
    name = "profileKey"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.stateful_table_protection_enabled
  }
}

resource "aws_dynamodb_table" "groups" {
  name                        = "${local.resource_prefix}-groups"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "groupKey"
  deletion_protection_enabled = var.stateful_table_protection_enabled

  attribute {
    name = "groupKey"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.stateful_table_protection_enabled
  }
}

resource "aws_dynamodb_table" "season_results" {
  name                        = "${local.resource_prefix}-season-results"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "season"
  deletion_protection_enabled = var.stateful_table_protection_enabled

  attribute {
    name = "season"
    type = "N"
  }

  point_in_time_recovery {
    enabled = var.stateful_table_protection_enabled
  }
}

data "archive_file" "custom_email_sender_zip" {
  count = var.custom_email_sender_enabled ? 1 : 0

  type        = "zip"
  source_dir  = coalesce(var.custom_email_sender_source_dir, path.module)
  output_path = coalesce(var.custom_email_sender_zip_path, "${path.module}/custom-email-sender-disabled.zip")
}

resource "aws_kms_key" "cognito_email_codes" {
  count = var.custom_email_sender_enabled ? 1 : 0

  description             = "Encrypts Cognito email codes for the ${var.environment} custom sender"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_secretsmanager_secret" "resend_api_key" {
  count = var.custom_email_sender_enabled ? 1 : 0

  name                    = "${local.resource_prefix}/resend/api-key"
  description             = "Resend API key used by the Cognito custom email sender"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "resend_api_key" {
  count = var.custom_email_sender_enabled ? 1 : 0

  secret_id                = aws_secretsmanager_secret.resend_api_key[0].id
  secret_string_wo         = coalesce(var.resend_api_key, "re_disabled")
  secret_string_wo_version = var.resend_api_key_version
}

resource "aws_iam_role" "custom_email_sender" {
  count = var.custom_email_sender_enabled ? 1 : 0

  name = "${local.resource_prefix}-email-sender-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "custom_email_sender_logs" {
  count = var.custom_email_sender_enabled ? 1 : 0

  role       = aws_iam_role.custom_email_sender[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "custom_email_sender" {
  count = var.custom_email_sender_enabled ? 1 : 0

  name = "${local.resource_prefix}-email-sender-access"
  role = aws_iam_role.custom_email_sender[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.cognito_email_codes[0].arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.resend_api_key[0].arn
      }
    ]
  })
}

resource "aws_lambda_function" "custom_email_sender" {
  count = var.custom_email_sender_enabled ? 1 : 0

  function_name = "${local.resource_prefix}-email-sender"
  role          = aws_iam_role.custom_email_sender[0].arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"

  filename         = data.archive_file.custom_email_sender_zip[0].output_path
  source_code_hash = data.archive_file.custom_email_sender_zip[0].output_base64sha256

  timeout     = 15
  memory_size = 256

  environment {
    variables = {
      EMAIL_FROM                = "Predict Playoffs <no-reply@${coalesce(var.cognito_email_domain, "example.com")}>"
      KMS_KEY_ARN               = aws_kms_key.cognito_email_codes[0].arn
      KMS_KEY_ID                = aws_kms_key.cognito_email_codes[0].key_id
      RESEND_API_KEY_SECRET_ARN = aws_secretsmanager_secret.resend_api_key[0].arn
    }
  }

  depends_on = [
    aws_iam_role_policy.custom_email_sender[0],
    aws_iam_role_policy_attachment.custom_email_sender_logs[0],
    aws_secretsmanager_secret_version.resend_api_key[0],
  ]
}

resource "aws_cognito_user_pool" "users" {
  name                     = "${local.resource_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 6
    require_lowercase                = false
    require_numbers                  = false
    require_symbols                  = false
    require_uppercase                = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  dynamic "lambda_config" {
    for_each = var.custom_email_sender_enabled ? [true] : []

    content {
      kms_key_id = aws_kms_key.cognito_email_codes[0].arn

      custom_email_sender {
        lambda_arn     = aws_lambda_function.custom_email_sender[0].arn
        lambda_version = "V1_0"
      }
    }
  }

  lifecycle {
    precondition {
      condition = !var.custom_email_sender_enabled || (
        var.custom_email_sender_source_dir != null &&
        var.custom_email_sender_zip_path != null &&
        var.resend_api_key != null &&
        var.cognito_email_domain != null
      )
      error_message = "The custom email sender source, archive path, Resend API key, and email domain are required when custom_email_sender_enabled is true."
    }
  }
}

resource "aws_lambda_permission" "cognito_custom_email_sender" {
  count = var.custom_email_sender_enabled ? 1 : 0

  statement_id  = "AllowCognitoCustomEmailSender"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.custom_email_sender[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.users.arn
}

# Preserve the existing production resource identities after making the custom
# sender optional. In dev, the moved instances are then cleanly destroyed.
moved {
  from = aws_kms_key.cognito_email_codes
  to   = aws_kms_key.cognito_email_codes[0]
}

moved {
  from = aws_secretsmanager_secret.resend_api_key
  to   = aws_secretsmanager_secret.resend_api_key[0]
}

moved {
  from = aws_secretsmanager_secret_version.resend_api_key
  to   = aws_secretsmanager_secret_version.resend_api_key[0]
}

moved {
  from = aws_iam_role.custom_email_sender
  to   = aws_iam_role.custom_email_sender[0]
}

moved {
  from = aws_iam_role_policy_attachment.custom_email_sender_logs
  to   = aws_iam_role_policy_attachment.custom_email_sender_logs[0]
}

moved {
  from = aws_iam_role_policy.custom_email_sender
  to   = aws_iam_role_policy.custom_email_sender[0]
}

moved {
  from = aws_lambda_function.custom_email_sender
  to   = aws_lambda_function.custom_email_sender[0]
}

moved {
  from = aws_lambda_permission.cognito_custom_email_sender
  to   = aws_lambda_permission.cognito_custom_email_sender[0]
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = var.lambda_source_dir
  output_path = var.lambda_zip_path
}

resource "aws_iam_role" "lambda" {
  name = "${local.resource_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_cache" {
  name = "${local.resource_prefix}-dynamodb-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem"
        ]
        Resource = aws_dynamodb_table.win_totals_cache.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Scan"
        ]
        Resource = aws_dynamodb_table.predictions.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Scan"
        ]
        Resource = aws_dynamodb_table.profiles.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Scan",
          "dynamodb:UpdateItem"
        ]
        Resource = aws_dynamodb_table.groups.arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = aws_dynamodb_table.season_results.arn
      }
    ]
  })
}

resource "aws_lambda_function" "backend" {
  function_name = "${local.resource_prefix}-backend"
  role          = aws_iam_role.lambda.arn
  runtime       = "python3.12"
  handler       = "app.handler"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  timeout     = 20
  memory_size = 256

  environment {
    variables = merge({
      CACHE_TABLE        = aws_dynamodb_table.win_totals_cache.name
      CACHE_TTL_SECONDS  = tostring(var.cache_ttl_seconds)
      ENVIRONMENT        = var.environment
      GROUPS_TABLE       = aws_dynamodb_table.groups.name
      PREDICTION_LOCK_AT = var.prediction_lock_at
      PREDICTIONS_TABLE  = aws_dynamodb_table.predictions.name
      PROFILES_TABLE     = aws_dynamodb_table.profiles.name
      RESULTS_SEASON     = tostring(var.results_season)
      RESULTS_TABLE      = aws_dynamodb_table.season_results.name
      }, var.environment == "dev" ? {
      ADMIN_COGNITO_ISSUER               = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
      ADMIN_COGNITO_CLIENT_ID            = aws_cognito_user_pool_client.browser.id
      ADMIN_ANALYTICS_CACHE_TABLE        = aws_dynamodb_table.admin_analytics_cache[0].name
      ADMIN_ANALYTICS_CONFIG_PARAMETER   = "/${local.resource_prefix}/admin-analytics/config"
      ADMIN_GOOGLE_CREDENTIALS_PARAMETER = "/${local.resource_prefix}/admin-analytics/google-service-account"
      ADMIN_ANALYTICS_LOG_GROUP          = local.analytics_log_group
    } : {})
  }

  depends_on = [
    aws_iam_role_policy.lambda_cache,
    aws_iam_role_policy.admin_analytics,
    aws_iam_role_policy_attachment.lambda_logs,
  ]
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${local.resource_prefix}-api"
  protocol_type = "HTTP"
}

resource "aws_cognito_user_pool_client" "browser" {
  name         = "${local.resource_prefix}-browser"
  user_pool_id = aws_cognito_user_pool.users.id

  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"]
  allowed_oauth_flows_user_pool_client = false
  enable_token_revocation              = true
  prevent_user_existence_errors        = "ENABLED"
  access_token_validity                = 1
  id_token_validity                    = 1
  refresh_token_validity               = 7

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.resource_prefix}-cognito"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.browser.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "win_totals" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/win-totals"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "prediction_get" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /api/prediction"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "prediction_window" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/prediction-window"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "analytics" {
  count = contains(["dev", "prod"], var.environment) ? 1 : 0

  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /api/analytics"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "leaderboard_get" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/leaderboard"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "public_bracket_get" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/leaderboard/{leaderboardName}/bracket"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "prediction_put" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "PUT /api/prediction"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "prediction_delete" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "DELETE /api/prediction"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "profile_get" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /api/profile"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "profile_put" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "PUT /api/profile"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "profile_delete" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "DELETE /api/profile"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "groups_get" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /api/groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "groups_create" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /api/groups"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "groups_join" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /api/groups/join"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "groups_join_invite" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "POST /api/groups/join-invite"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "group_delete" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "DELETE /api/groups/{groupId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "group_sports_update" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "PATCH /api/groups/{groupId}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "group_invite_get" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /api/groups/{groupId}/invite"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "group_members_get" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /api/groups/{groupId}/members"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "group_membership_delete" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "DELETE /api/groups/{groupId}/membership"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "group_leaderboard_get" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /api/groups/{groupId}/leaderboard"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.api_throttling_burst_limit
    throttling_rate_limit  = var.api_throttling_rate_limit
  }
}

resource "aws_cloudwatch_dashboard" "analytics" {
  count = contains(["dev", "prod"], var.environment) ? 1 : 0

  dashboard_name = "${local.resource_prefix}-analytics"
  dashboard_body = jsonencode({ widgets = [
    { type = "text", x = 0, y = 0, width = 24, height = 2, properties = {
      markdown = "# Predict Playoffs — ${title(var.environment)} activity\nCookieless product event counts. GPC/DNT excluded. Traffic is reported by GoatCounter in the private dev admin dashboard."
    } },
    { type = "log", x = 0, y = 2, width = 24, height = 8, properties = {
      region = var.aws_region, title = "Product activity totals", view = "table",
      query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event != \"page_view\" and event != \"leaderboard_viewed\"\n| stats count(*) as events by event, bracketType | sort events desc"
    } },
    { type = "log", x = 0, y = 10, width = 24, height = 8, properties = {
      region = var.aws_region, title = "Daily product activity", view = "timeSeries",
      query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event != \"page_view\" and event != \"leaderboard_viewed\"\n| stats count(*) as events by bin(1d), event"
    } }
  ] })
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_s3_bucket" "frontend" {
  bucket = "${local.resource_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  # One content-derived release version keeps every page on the same JS/CSS set.
  frontend_version = substr(sha256(join("", [
    for key in sort(keys(local.frontend_files)) : filemd5(local.frontend_files[key].source)
    if endswith(key, ".js") || endswith(key, ".css")
  ])), 0, 16)
  frontend_pages = {
    for key, asset in local.frontend_files : key => replace(
      file(asset.source), "/\\?v=[0-9]+/", "?v=${local.frontend_version}"
    ) if startswith(asset.content_type, "text/html")
  }
}

resource "aws_s3_object" "frontend" {
  for_each = { for key, asset in local.frontend_files : key => asset if !startswith(asset.content_type, "text/html") }

  bucket        = aws_s3_bucket.frontend.id
  key           = each.key
  source        = each.value.source
  etag          = filemd5(each.value.source)
  content_type  = each.value.content_type
  cache_control = contains(["robots.txt", "sitemap.xml"], each.key) ? "public, max-age=300, must-revalidate" : "public, max-age=86400, must-revalidate"
}

# Publish HTML only after assets, so a new version cannot cache the previous release.
resource "aws_s3_object" "frontend_pages" {
  for_each      = local.frontend_pages
  bucket        = aws_s3_bucket.frontend.id
  key           = each.key
  content       = each.value
  etag          = md5(each.value)
  content_type  = "text/html; charset=utf-8"
  cache_control = "public, max-age=0, s-maxage=60, must-revalidate"
  depends_on    = [aws_s3_object.frontend]
}

moved {
  from = aws_s3_object.frontend["index.html"]
  to   = aws_s3_object.frontend_pages["index.html"]
}
moved {
  from = aws_s3_object.frontend["nba"]
  to   = aws_s3_object.frontend_pages["nba"]
}
moved {
  from = aws_s3_object.frontend["scoring"]
  to   = aws_s3_object.frontend_pages["scoring"]
}
moved {
  from = aws_s3_object.frontend["leaderboard"]
  to   = aws_s3_object.frontend_pages["leaderboard"]
}
moved {
  from = aws_s3_object.frontend["picks"]
  to   = aws_s3_object.frontend_pages["picks"]
}

locals {
  auth_config_javascript = "window.AUTH_CONFIG = ${jsonencode({
    environment = var.environment
    clientId    = aws_cognito_user_pool_client.browser.id
    region      = var.aws_region
  })};\n"
}

resource "aws_s3_object" "auth_config" {
  bucket        = aws_s3_bucket.frontend.id
  key           = "auth-config.js"
  content_type  = "application/javascript; charset=utf-8"
  content       = local.auth_config_javascript
  etag          = md5(local.auth_config_javascript)
  cache_control = "no-store, no-cache, must-revalidate, max-age=0"
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.resource_prefix}-frontend-oac"
  description                       = "Allow CloudFront to read the private frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Reuse the policy ID permitted by the deployment role. The API must first
# finish migrating to managed CachingDisabled before this policy enables caching.
moved {
  from = aws_cloudfront_cache_policy.disabled
  to   = aws_cloudfront_cache_policy.frontend
}

resource "aws_cloudfront_cache_policy" "frontend" {
  name        = "${local.resource_prefix}-frontend-cache"
  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["v"]
      }
    }
  }
}

# Preserve the existing dev policy identity while adding browser protections.
moved {
  from = aws_cloudfront_response_headers_policy.noindex[0]
  to   = aws_cloudfront_response_headers_policy.security
}

locals {
  analytics_connections = var.environment == "dev" ? ["https://predictplayoffs.goatcounter.com"] : []
  structured_data_hashes = distinct(flatten([
    for html in values(local.frontend_pages) : [
      for block in regexall("(?s)<script type=\"application/ld\\+json\">(.*?)</script>", html) :
      "'sha256-${base64sha256(block[0])}'"
    ]
  ]))
  content_security_policy = join("; ", [
    "default-src 'self'",
    "script-src 'self' ${join(" ", local.structured_data_hashes)}${var.environment == "dev" ? " https://gc.zgo.at" : ""}",
    "script-src-attr 'none'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://cognito-idp.${var.aws_region}.amazonaws.com ${join(" ", local.analytics_connections)}",
    "img-src 'self' https://a.espncdn.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ])
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${local.resource_prefix}-security"
  security_headers_config {
    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    dynamic "strict_transport_security" {
      for_each = var.environment == "prod" && length(var.cloudfront_aliases) > 0 ? [1] : []
      content {
        access_control_max_age_sec = 31536000
        include_subdomains         = false
        preload                    = false
        override                   = true
      }
    }
  }
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
      override = true
    }
    dynamic "items" {
      for_each = var.environment == "prod" ? [] : [1]
      content {
        header   = "X-Robots-Tag"
        value    = "noindex, nofollow"
        override = true
      }
    }
  }
  lifecycle {
    precondition {
      condition     = length(local.content_security_policy) <= 1783
      error_message = "CSP exceeds CloudFront's 1783-character limit."
    }
  }
}

resource "aws_iam_role" "results_updater" {
  name = "${local.resource_prefix}-results-updater-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "results_updater_logs" {
  role       = aws_iam_role.results_updater.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "results_updater" {
  name = "${local.resource_prefix}-season-results-access"
  role = aws_iam_role.results_updater.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
      ]
      Resource = aws_dynamodb_table.season_results.arn
    }]
  })
}

resource "aws_lambda_function" "results_updater" {
  function_name = "${local.resource_prefix}-results-updater"
  role          = aws_iam_role.results_updater.arn
  runtime       = "python3.12"
  handler       = "results_dispatcher.handler"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  timeout     = 120
  memory_size = 256

  environment {
    variables = {
      RESULTS_AUTOMATION_START_AT = var.results_automation_start_at
      RESULTS_SEASON              = tostring(var.results_season)
      RESULTS_TABLE               = aws_dynamodb_table.season_results.name
    }
  }

  depends_on = [
    aws_iam_role_policy.results_updater,
    aws_iam_role_policy_attachment.results_updater_logs,
  ]
}

resource "aws_cloudwatch_event_rule" "results_update" {
  name                = "${local.resource_prefix}-results-update"
  description         = "Refresh finalized NFL results for leaderboard scoring"
  schedule_expression = var.results_update_schedule
}

# Share the deployment role's permitted results schedule. The API uses its
# existing table permissions; conditional snapshots are safe to retry.
resource "aws_cloudwatch_event_target" "group_history" {
  rule      = aws_cloudwatch_event_rule.results_update.name
  target_id = "group-history"
  arn       = aws_lambda_function.backend.arn

  depends_on = [aws_lambda_permission.eventbridge_group_history]
}

resource "aws_lambda_permission" "eventbridge_group_history" {
  statement_id  = "AllowEventBridgeGroupHistory"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.results_update.arn
}

resource "aws_cloudwatch_event_target" "results_updater" {
  rule = aws_cloudwatch_event_rule.results_update.name
  arn  = aws_lambda_function.results_updater.arn
}

resource "aws_lambda_permission" "eventbridge_results_updater" {
  statement_id  = "AllowEventBridgeResultsUpdate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.results_updater.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.results_update.arn
}

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  aliases             = var.cloudfront_aliases

  origin {
    origin_id                = "frontend-s3"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    origin_id   = "backend-api"
    domain_name = trimprefix(aws_apigatewayv2_api.api.api_endpoint, "https://")

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    target_origin_id           = "frontend-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.frontend.id
    compress                   = true
  }

  ordered_cache_behavior {
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    path_pattern               = "/api/*"
    target_origin_id           = "backend-api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # AWS managed CachingDisabled
    origin_request_policy_id   = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.acm_certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = (length(var.cloudfront_aliases) == 0) == (var.acm_certificate_arn == null)
      error_message = "cloudfront_aliases and acm_certificate_arn must either both be configured or both be omitted."
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowCloudFrontReadOnly"
      Effect = "Allow"
      Principal = {
        Service = "cloudfront.amazonaws.com"
      }
      Action   = "s3:GetObject"
      Resource = "${aws_s3_bucket.frontend.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.app.arn
        }
      }
    }]
  })
}
