data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  state_bucket_name = "${var.project_name}-tfstate-${local.account_id}"
  state_key         = "${var.project_name}/dev/terraform.tfstate"
  state_lock_key    = "${local.state_key}.tflock"
  prod_state_key    = "${var.project_name}/prod/terraform.tfstate"
  prod_lock_key     = "${local.prod_state_key}.tflock"

  dev_prefix          = "${var.project_name}-dev"
  dev_frontend_bucket = "${local.dev_prefix}-frontend-${local.account_id}"
  dev_lambda_role     = "${local.dev_prefix}-lambda-role"
  dev_dashboard_name  = "${local.dev_prefix}-analytics"

  prod_frontend_bucket = "${var.project_name}-frontend-${local.account_id}"
  prod_lambda_role     = "${var.project_name}-lambda-role"
  prod_dashboard_name  = "${var.project_name}-analytics"

  github_oidc_subject      = "repo:${var.github_repository}:environment:${var.github_environment}"
  github_prod_oidc_subject = "repo:${var.github_repository}:environment:${var.github_prod_environment}"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = local.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "terraform_state_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  policy = data.aws_iam_policy_document.terraform_state_bucket.json
}

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_assume_role" {
  statement {
    sid     = "GitHubActionsDevEnvironment"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_oidc_subject]
    }
  }
}

resource "aws_iam_role" "github_dev_deploy" {
  name                 = "${local.dev_prefix}-github-actions"
  assume_role_policy   = data.aws_iam_policy_document.github_assume_role.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_dev_deploy" {
  statement {
    sid = "TerraformStateBucketMetadata"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.terraform_state.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        local.state_key,
        local.state_lock_key,
      ]
    }
  }

  statement {
    sid = "TerraformStateObjects"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.terraform_state.arn}/${local.state_key}"]
  }

  statement {
    sid = "TerraformStateLock"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.terraform_state.arn}/${local.state_lock_key}"]
  }

  statement {
    sid     = "DevFrontendBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${local.dev_frontend_bucket}",
      "arn:aws:s3:::${local.dev_frontend_bucket}/*",
    ]
  }

  statement {
    sid       = "DevDynamoDbTables"
    actions   = ["dynamodb:*"]
    resources = ["arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${local.dev_prefix}-*"]
  }

  statement {
    sid       = "DevLambdaFunction"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.dev_prefix}-backend"]
  }

  statement {
    sid       = "CreateDevCognitoUserPool"
    actions   = ["cognito-idp:CreateUserPool"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.project_name]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Environment"
      values   = ["dev"]
    }
  }

  statement {
    sid = "ManageDevCognitoUserPool"
    actions = [
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DeleteManagedLoginBranding",
      "cognito-idp:DeleteUserPool",
      "cognito-idp:DeleteUserPoolClient",
      "cognito-idp:DeleteUserPoolDomain",
      "cognito-idp:DescribeManagedLoginBranding",
      "cognito-idp:DescribeManagedLoginBrandingByClient",
      "cognito-idp:DescribeUserPool",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:GetUserPoolMfaConfig",
      "cognito-idp:ListTagsForResource",
      "cognito-idp:ListUserPoolClients",
      "cognito-idp:TagResource",
      "cognito-idp:UntagResource",
      "cognito-idp:UpdateUserPool",
      "cognito-idp:UpdateUserPoolClient",
    ]
    resources = ["arn:aws:cognito-idp:${var.aws_region}:${local.account_id}:userpool/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.project_name]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Environment"
      values   = ["dev"]
    }
  }

  statement {
    sid = "ReadCognitoInventory"
    actions = [
      "cognito-idp:DescribeUserPoolDomain",
      "cognito-idp:ListUserPools",
    ]
    resources = ["*"]
  }

  statement {
    sid = "DevLambdaRole"
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.dev_lambda_role}"]
  }

  statement {
    sid       = "PassDevLambdaRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.dev_lambda_role}"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid = "ReadLambdaManagedPolicy"
    actions = [
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
    ]
    resources = ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]
  }

  statement {
    sid     = "DevApiGateway"
    actions = ["apigateway:*"]
    resources = [
      "arn:aws:apigateway:${var.aws_region}::/apis/${var.dev_api_id}",
      "arn:aws:apigateway:${var.aws_region}::/apis/${var.dev_api_id}/*",
    ]
  }

  statement {
    sid     = "DevCloudFrontResources"
    actions = ["cloudfront:*"]
    resources = [
      "arn:aws:cloudfront::${local.account_id}:distribution/${var.dev_cloudfront_distribution_id}",
      "arn:aws:cloudfront::${local.account_id}:origin-access-control/${var.dev_cloudfront_oac_id}",
      "arn:aws:cloudfront::${local.account_id}:cache-policy/${var.dev_cloudfront_cache_policy_id}",
    ]
  }

  statement {
    sid = "ManageDevAnalyticsDashboard"
    actions = [
      "cloudwatch:DeleteDashboards",
      "cloudwatch:GetDashboard",
      "cloudwatch:PutDashboard",
    ]
    resources = ["arn:aws:cloudwatch::${local.account_id}:dashboard/${local.dev_dashboard_name}"]
  }

  statement {
    sid       = "ListCloudWatchDashboards"
    actions   = ["cloudwatch:ListDashboards"]
    resources = ["*"]
  }

  statement {
    sid = "ReadCloudFrontInventory"
    actions = [
      "cloudfront:ListCachePolicies",
      "cloudfront:ListDistributions",
      "cloudfront:ListOriginAccessControls",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_dev_deploy" {
  name   = "${local.dev_prefix}-terraform-deploy"
  role   = aws_iam_role.github_dev_deploy.id
  policy = data.aws_iam_policy_document.github_dev_deploy.json
}

data "aws_iam_policy_document" "github_prod_assume_role" {
  statement {
    sid     = "GitHubActionsProdEnvironment"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_prod_oidc_subject]
    }
  }
}

resource "aws_iam_role" "github_prod_deploy" {
  name                 = "${var.project_name}-prod-github-actions"
  assume_role_policy   = data.aws_iam_policy_document.github_prod_assume_role.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_prod_deploy" {
  statement {
    sid = "TerraformStateBucketMetadata"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.terraform_state.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        local.prod_state_key,
        local.prod_lock_key,
      ]
    }
  }

  statement {
    sid = "TerraformStateObjects"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.terraform_state.arn}/${local.prod_state_key}"]
  }

  statement {
    sid = "TerraformStateLock"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.terraform_state.arn}/${local.prod_lock_key}"]
  }

  statement {
    sid     = "ProdFrontendBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${local.prod_frontend_bucket}",
      "arn:aws:s3:::${local.prod_frontend_bucket}/*",
    ]
  }

  statement {
    sid     = "ProdDynamoDbTables"
    actions = ["dynamodb:*"]
    resources = [
      for suffix in ["groups", "predictions", "profiles", "win-totals-cache"] :
      "arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${var.project_name}-${suffix}"
    ]
  }

  statement {
    sid       = "ProdLambdaFunction"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${var.project_name}-backend"]
  }

  statement {
    sid       = "CreateProdCognitoUserPool"
    actions   = ["cognito-idp:CreateUserPool"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Project"
      values   = [var.project_name]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Environment"
      values   = ["prod"]
    }
  }

  statement {
    sid = "ManageProdCognitoUserPool"
    actions = [
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DeleteManagedLoginBranding",
      "cognito-idp:DeleteUserPool",
      "cognito-idp:DeleteUserPoolClient",
      "cognito-idp:DeleteUserPoolDomain",
      "cognito-idp:DescribeManagedLoginBranding",
      "cognito-idp:DescribeManagedLoginBrandingByClient",
      "cognito-idp:DescribeUserPool",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:GetUserPoolMfaConfig",
      "cognito-idp:ListTagsForResource",
      "cognito-idp:ListUserPoolClients",
      "cognito-idp:TagResource",
      "cognito-idp:UntagResource",
      "cognito-idp:UpdateUserPool",
      "cognito-idp:UpdateUserPoolClient",
    ]
    resources = ["arn:aws:cognito-idp:${var.aws_region}:${local.account_id}:userpool/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Project"
      values   = [var.project_name]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Environment"
      values   = ["prod"]
    }
  }

  statement {
    sid = "ReadCognitoInventory"
    actions = [
      "cognito-idp:DescribeUserPoolDomain",
      "cognito-idp:ListUserPools",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ProdLambdaRole"
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.prod_lambda_role}"]
  }

  statement {
    sid       = "PassProdLambdaRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${local.prod_lambda_role}"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid = "ReadLambdaManagedPolicy"
    actions = [
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
    ]
    resources = ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]
  }

  statement {
    sid     = "ProdApiGateway"
    actions = ["apigateway:*"]
    resources = [
      "arn:aws:apigateway:${var.aws_region}::/apis/${var.prod_api_id}",
      "arn:aws:apigateway:${var.aws_region}::/apis/${var.prod_api_id}/*",
    ]
  }

  statement {
    sid     = "ProdCloudFrontResources"
    actions = ["cloudfront:*"]
    resources = [
      "arn:aws:cloudfront::${local.account_id}:distribution/${var.prod_cloudfront_distribution_id}",
      "arn:aws:cloudfront::${local.account_id}:origin-access-control/${var.prod_cloudfront_oac_id}",
      "arn:aws:cloudfront::${local.account_id}:cache-policy/${var.prod_cloudfront_cache_policy_id}",
    ]
  }

  statement {
    sid = "ManageProdAnalyticsDashboard"
    actions = [
      "cloudwatch:DeleteDashboards",
      "cloudwatch:GetDashboard",
      "cloudwatch:PutDashboard",
    ]
    resources = ["arn:aws:cloudwatch::${local.account_id}:dashboard/${local.prod_dashboard_name}"]
  }

  statement {
    sid       = "ListCloudWatchDashboards"
    actions   = ["cloudwatch:ListDashboards"]
    resources = ["*"]
  }

  statement {
    sid = "ReadCloudFrontInventory"
    actions = [
      "cloudfront:ListCachePolicies",
      "cloudfront:ListDistributions",
      "cloudfront:ListOriginAccessControls",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ProdCertificate"
    actions   = ["acm:*"]
    resources = [var.prod_acm_certificate_arn]
  }

  statement {
    sid       = "ReadCertificateInventory"
    actions   = ["acm:ListCertificates"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_prod_deploy" {
  name   = "${var.project_name}-prod-terraform-deploy"
  role   = aws_iam_role.github_prod_deploy.id
  policy = data.aws_iam_policy_document.github_prod_deploy.json
}
