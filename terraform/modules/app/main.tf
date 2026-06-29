data "aws_caller_identity" "current" {}

locals {
  resource_prefix = coalesce(var.resource_prefix, "${var.project_name}-${var.environment}")

  frontend_files = {
    "index.html" = {
      source       = "${var.frontend_dir}/index.html"
      content_type = "text/html; charset=utf-8"
    }
    "app.js" = {
      source       = "${var.frontend_dir}/app.js"
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
      CACHE_TABLE       = aws_dynamodb_table.win_totals_cache.name
      CACHE_TTL_SECONDS = tostring(var.cache_ttl_seconds)
      ENVIRONMENT       = var.environment
      PREDICTIONS_TABLE = aws_dynamodb_table.predictions.name
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

resource "aws_apigatewayv2_route" "predictions_list" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/predictions"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "prediction_get" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/predictions/{profileKey}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "prediction_put" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "PUT /api/predictions/{profileKey}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "prediction_delete" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "DELETE /api/predictions/{profileKey}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
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

  bucket       = aws_s3_bucket.frontend.id
  key          = each.key
  source       = each.value.source
  etag         = filemd5(each.value.source)
  content_type = each.value.content_type
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
    path_pattern           = "/api/*"
    target_origin_id       = "backend-api"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.disabled.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
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
