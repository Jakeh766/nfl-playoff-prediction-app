data "aws_caller_identity" "current" {}

locals {
  resource_prefix = coalesce(var.resource_prefix, "${var.project_name}-${var.environment}")

  cognito_email_source_arn = var.cognito_email_domain == null ? null : "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/${var.cognito_email_domain}"
  analytics_log_group      = "/aws/lambda/${local.resource_prefix}-backend"

  frontend_files = {
    "index.html" = {
      source       = "${var.frontend_dir}/index.html"
      content_type = "text/html; charset=utf-8"
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
  }
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
  name         = "${local.resource_prefix}-predictions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "profileKey"

  attribute {
    name = "profileKey"
    type = "S"
  }
}

resource "aws_dynamodb_table" "profiles" {
  name         = "${local.resource_prefix}-profiles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "profileKey"

  attribute {
    name = "profileKey"
    type = "S"
  }
}

resource "aws_dynamodb_table" "groups" {
  name         = "${local.resource_prefix}-groups"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "groupKey"

  attribute {
    name = "groupKey"
    type = "S"
  }
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

  dynamic "email_configuration" {
    for_each = var.cognito_email_domain == null ? [] : [var.cognito_email_domain]

    content {
      email_sending_account = "DEVELOPER"
      from_email_address    = "Road to the Bowl <no-reply@${email_configuration.value}>"
      source_arn            = local.cognito_email_source_arn
    }
  }
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
    variables = {
      CACHE_TABLE        = aws_dynamodb_table.win_totals_cache.name
      CACHE_TTL_SECONDS  = tostring(var.cache_ttl_seconds)
      ENVIRONMENT        = var.environment
      GROUPS_TABLE       = aws_dynamodb_table.groups.name
      PREDICTION_LOCK_AT = var.prediction_lock_at
      PREDICTIONS_TABLE  = aws_dynamodb_table.predictions.name
      PROFILES_TABLE     = aws_dynamodb_table.profiles.name
    }
  }

  depends_on = [
    aws_iam_role_policy.lambda_cache,
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
  refresh_token_validity               = 30

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
  count = var.environment == "dev" ? 1 : 0

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

resource "aws_apigatewayv2_route" "group_invite_get" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "GET /api/groups/{groupId}/invite"
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
  count = var.environment == "dev" ? 1 : 0

  dashboard_name = "${local.resource_prefix}-analytics"
  dashboard_body = jsonencode({
    start          = "-P7D"
    periodOverride = "inherit"
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "# Road to the Bowl — Dev Analytics\nAnonymous product analytics for the development site. Adjust the dashboard time range to explore a different window. Managed by Terraform."
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 2
        width  = 6
        height = 4
        properties = {
          region = var.aws_region
          title  = "Unique visitors"
          view   = "table"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event = \"page_view\"\n| stats count_distinct(visitorId) as uniqueVisitors"
        }
      },
      {
        type   = "log"
        x      = 6
        y      = 2
        width  = 6
        height = 4
        properties = {
          region = var.aws_region
          title  = "Sessions"
          view   = "table"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event = \"page_view\"\n| stats count_distinct(sessionId) as sessions"
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 2
        width  = 6
        height = 4
        properties = {
          region = var.aws_region
          title  = "Page views"
          view   = "table"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event = \"page_view\"\n| stats count(*) as pageViews"
        }
      },
      {
        type   = "log"
        x      = 18
        y      = 2
        width  = 6
        height = 4
        properties = {
          region = var.aws_region
          title  = "Predictions saved"
          view   = "table"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event = \"prediction_saved\"\n| stats count(*) as predictionsSaved"
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 6
        width  = 16
        height = 7
        properties = {
          region = var.aws_region
          title  = "Traffic over time"
          view   = "timeSeries"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event = \"page_view\"\n| stats count(*) as pageViews, count_distinct(sessionId) as sessions by bin(1h)"
        }
      },
      {
        type   = "log"
        x      = 16
        y      = 6
        width  = 8
        height = 7
        properties = {
          region = var.aws_region
          title  = "Popular pages"
          view   = "pie"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event = \"page_view\"\n| stats count(*) as views by page\n| sort views desc"
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 13
        width  = 12
        height = 7
        properties = {
          region = var.aws_region
          title  = "Visitor conversion"
          view   = "bar"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event in [\"page_view\", \"account_created\", \"prediction_saved\"]\n| stats count_distinct(visitorId) as visitors by event\n| sort visitors desc"
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 13
        width  = 12
        height = 7
        properties = {
          region = var.aws_region
          title  = "Engagement events"
          view   = "bar"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event != \"page_view\"\n| stats count(*) as events by event\n| sort events desc"
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 20
        width  = 12
        height = 7
        properties = {
          region = var.aws_region
          title  = "Recent sessions"
          view   = "table"
          query  = "SOURCE '${local.analytics_log_group}' | filter type = \"site_analytics\" and event = \"page_view\"\n| stats count(*) as pageViews, count_distinct(page) as pages, min(@timestamp) as started, max(@timestamp) as lastSeen by sessionId\n| sort lastSeen desc\n| limit 20"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 20
        width  = 12
        height = 7
        properties = {
          region  = var.aws_region
          title   = "Backend health"
          view    = "timeSeries"
          period  = 300
          stat    = "Sum"
          stacked = false
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.backend.function_name],
            [".", "Errors", ".", "."],
          ]
          yAxis = {
            left = {
              min       = 0
              showUnits = false
            }
          }
        }
      },
    ]
  })
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

resource "aws_s3_object" "frontend" {
  for_each = local.frontend_files

  bucket        = aws_s3_bucket.frontend.id
  key           = each.key
  source        = each.value.source
  etag          = filemd5(each.value.source)
  content_type  = each.value.content_type
  cache_control = "no-store, no-cache, must-revalidate, max-age=0"
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

resource "aws_cloudfront_cache_policy" "disabled" {
  name        = "${local.resource_prefix}-caching-disabled"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
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
    target_origin_id       = "frontend-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.disabled.id
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "backend-api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
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
