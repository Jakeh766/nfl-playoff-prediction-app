# Run with terraform -chdir=terraform/modules/app test.
# These plans use mocked AWS; they never contact or change deployed resources.
mock_provider "aws" {
  override_during = plan
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_resource "aws_cognito_user_pool" {
    defaults = { id = "us-east-1_TestPool", arn = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_TestPool" }
  }
  mock_resource "aws_cognito_user_pool_client" {
    defaults = { id = "test-client" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/test-role" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-1:123456789012:function:test-function"
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:test-function/invocations"
    }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = { id = "test-api", execution_arn = "arn:aws:execute-api:us-east-1:123456789012:test-api" }
  }
  mock_resource "aws_apigatewayv2_authorizer" {
    defaults = { id = "test-authorizer" }
  }
}

mock_provider "archive" {
  override_during = plan
}

variables {
  aws_region         = "us-east-1"
  project_name       = "nfl-playoff-predictor"
  frontend_dir       = "../../../frontend"
  lambda_source_dir  = "../../../backend/lambda"
  lambda_zip_path    = "lambda.zip"
  prediction_lock_at = "2026-09-10T00:20:00Z"
}

run "dev_admin_resources" {
  command = plan
  override_resource {
    target          = aws_dynamodb_table.admin_analytics_cache[0]
    override_during = plan
    values          = { arn = "arn:aws:dynamodb:us-east-1:123456789012:table/nfl-playoff-predictor-dev-admin-analytics-cache" }
  }
  variables {
    environment = "dev"
  }
  assert {
    condition = (
      aws_cognito_user_group.admin[0].name == "admin" &&
      aws_cognito_user_group.admin[0].user_pool_id == aws_cognito_user_pool.users.id &&
      aws_dynamodb_table.admin_analytics_cache[0].name == "nfl-playoff-predictor-dev-admin-analytics-cache" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_ANALYTICS_CONFIG_PARAMETER == "/nfl-playoff-predictor-dev/admin-analytics/config" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_GOOGLE_CREDENTIALS_PARAMETER == "/nfl-playoff-predictor-dev/admin-analytics/google-service-account" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_ANALYTICS_LOG_GROUP == "/aws/lambda/nfl-playoff-predictor-dev-backend"
    )
    error_message = "Dev reports must use only their own group, cache, parameters, and logs."
  }
  assert {
    condition = alltrue([
      for route in aws_apigatewayv2_route.admin_analytics :
      route.authorization_type == "JWT" && route.authorizer_id == aws_apigatewayv2_authorizer.cognito.id
    ]) && length(aws_apigatewayv2_route.admin_analytics) == 2
    error_message = "Every dev admin analytics route must also require JWT authentication."
  }
  assert {
    condition = (
      aws_lambda_function.backend.environment[0].variables.PREDICTIONS_TABLE == "nfl-playoff-predictor-dev-predictions" &&
      aws_lambda_function.backend.environment[0].variables.GROUPS_TABLE == "nfl-playoff-predictor-dev-groups" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_ANALYTICS_CACHE_TABLE == aws_dynamodb_table.admin_analytics_cache[0].name &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_COGNITO_CLIENT_ID == aws_cognito_user_pool_client.browser.id &&
      contains(keys(aws_s3_object.frontend_pages), "admin/analytics") &&
      toset(keys(jsondecode(replace(trimspace(aws_s3_object.auth_config.content), "/^window.AUTH_CONFIG = |;$/", "")))) == toset(["environment", "clientId", "region"])
    )
    error_message = "Dev data and client must remain separate; only public auth fields may reach the browser."
  }
}

run "prod_admin_resources" {
  command = plan
  override_resource {
    target          = aws_dynamodb_table.groups
    override_during = plan
    values          = { arn = "arn:aws:dynamodb:us-east-1:123456789012:table/nfl-playoff-predictor-groups" }
  }
  override_resource {
    target          = aws_dynamodb_table.admin_analytics_cache[0]
    override_during = plan
    values          = { arn = "arn:aws:dynamodb:us-east-1:123456789012:table/nfl-playoff-predictor-admin-analytics-cache" }
  }
  variables {
    environment     = "prod"
    resource_prefix = "nfl-playoff-predictor"
  }
  assert {
    condition = (
      aws_cognito_user_group.admin[0].name == "admin" &&
      aws_cognito_user_group.admin[0].user_pool_id == aws_cognito_user_pool.users.id &&
      aws_dynamodb_table.admin_analytics_cache[0].name == "nfl-playoff-predictor-admin-analytics-cache" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_ANALYTICS_CONFIG_PARAMETER == "/nfl-playoff-predictor/admin-analytics/config" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_GOOGLE_CREDENTIALS_PARAMETER == "/nfl-playoff-predictor/admin-analytics/google-service-account" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_ANALYTICS_LOG_GROUP == "/aws/lambda/nfl-playoff-predictor-backend"
    )
    error_message = "Production reports must use the preserved production prefix and their own pool."
  }
  assert {
    condition = alltrue([
      for route in aws_apigatewayv2_route.admin_analytics :
      route.authorization_type == "JWT" && route.authorizer_id == aws_apigatewayv2_authorizer.cognito.id
    ]) && length(aws_apigatewayv2_route.admin_analytics) == 2
    error_message = "Every production admin analytics route must require the existing Cognito JWT authorizer."
  }
  assert {
    condition = (
      contains(keys(aws_s3_object.frontend_pages), "admin/analytics") &&
      contains(keys(aws_s3_object.frontend), "admin-analytics.js") &&
      contains(keys(aws_s3_object.frontend), "admin-analytics.css") &&
      strcontains(local.content_security_policy, "https://predictplayoffs.goatcounter.com") &&
      strcontains(local.content_security_policy, "https://gc.zgo.at") &&
      toset(keys(jsondecode(replace(trimspace(aws_s3_object.auth_config.content), "/^window.AUTH_CONFIG = |;$/", "")))) == toset(["environment", "clientId", "region"])
    )
    error_message = "Production must permit the guarded GoatCounter collector without exposing provider config."
  }
  assert {
    condition = (
      aws_lambda_function.backend.environment[0].variables.ADMIN_ANALYTICS_CACHE_TABLE == aws_dynamodb_table.admin_analytics_cache[0].name &&
      aws_lambda_function.backend.environment[0].variables.PREDICTIONS_TABLE == "nfl-playoff-predictor-predictions" &&
      aws_lambda_function.backend.environment[0].variables.GROUPS_TABLE == "nfl-playoff-predictor-groups" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_COGNITO_ISSUER == "https://cognito-idp.us-east-1.amazonaws.com/${aws_cognito_user_pool.users.id}" &&
      aws_lambda_function.backend.environment[0].variables.ADMIN_COGNITO_CLIENT_ID == aws_cognito_user_pool_client.browser.id
    )
    error_message = "Runtime reports and IAM must point only to production data, cache, pool, and client."
  }
  assert {
    condition = (
      jsondecode(aws_iam_role_policy.admin_analytics[0].policy).Statement[1].Action == ["dynamodb:Scan"] &&
      jsondecode(aws_iam_role_policy.admin_analytics[0].policy).Statement[1].Resource == aws_dynamodb_table.groups.arn &&
      jsondecode(aws_iam_role_policy.admin_analytics[0].policy).Statement[5].Action == ["dynamodb:GetItem", "dynamodb:UpdateItem"] &&
      jsondecode(aws_iam_role_policy.admin_analytics[0].policy).Statement[5].Resource == "arn:aws:dynamodb:us-east-1:123456789012:table/nfl-playoff-predictor-dev-admin-analytics-cache" &&
      jsondecode(aws_iam_role_policy.admin_analytics[0].policy).Statement[5].Condition["ForAllValues:StringEquals"]["dynamodb:LeadingKeys"] == ["goatcounter-export:v1:predictplayoffs"] &&
      aws_lambda_function.backend.environment[0].variables.GOATCOUNTER_EXPORT_CACHE_TABLE == "nfl-playoff-predictor-dev-admin-analytics-cache"
    )
    error_message = "Seasons may scan only its own groups table; shared exports may access only one dev metadata key."
  }
}
