# Automatic rotation of the astra_app MySQL password (the login created by
# scripts/create-db-app-user.sh and stored by 28-db-app-user.tf).
#
# Secrets Manager runs a Lambda on a schedule. It is the "alternating users"
# strategy, so a rotation causes no downtime. There are two MySQL accounts with
# identical rights, astra_app and astra_app_clone, and only one is in the secret
# at a time. Each rotation sets a NEW password on the account that is not in use
# (creating it and copying the rights the first time), then switches the secret
# to it. The account that was in use keeps its old password, so pods that have
# not yet picked up the new secret can still connect. External Secrets then
# copies the new login into the cluster and Reloader restarts the pods
# (see ADR-0010).
#
# The cost of that: to create the second account and set its password, the
# function logs in with the RDS master login (read from the master secret, whose
# ARN is passed in the environment and not taken from the secret it rotates).
# That is more access than a function that only changed its own password would
# need. It can read only these two secrets and reach only the database.
#
# Not part of the rotation: the RDS master password, which RDS rotates itself.
#
# The schedule is a quiet hour (night in Singapore) once a month, and the first
# rotation is NOT started by applying this file (rotate_immediately = false).
# Start one yourself, at a time you choose:
#
#   aws secretsmanager rotate-secret \
#     --secret-id astra-eks-<environment>-db-app-credentials

locals {
  db_rotation_name = "${local.eks_name}-db-rotation"
}

# ---------------------------------------------------------------------------
# Network: the function must reach MySQL in the private subnets, and the
# Secrets Manager API through the NAT gateway.
# ---------------------------------------------------------------------------

resource "aws_security_group" "db_rotation" {
  name        = "astra-db-rotation-sg"
  description = "Password rotation Lambda: outbound to MySQL and the Secrets Manager API only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "astra-db-rotation-sg"
  }
}

resource "aws_security_group_rule" "db_rotation_to_mysql" {
  type                     = "egress"
  from_port                = 3306
  to_port                  = 3306
  protocol                 = "tcp"
  security_group_id        = aws_security_group.db_rotation.id
  source_security_group_id = aws_security_group.rds.id
  description              = "MySQL"
}

resource "aws_security_group_rule" "db_rotation_to_https" {
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.db_rotation.id
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "Secrets Manager API (through the NAT gateway)"
}

resource "aws_security_group_rule" "rds_from_db_rotation" {
  type                     = "ingress"
  from_port                = 3306
  to_port                  = 3306
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = aws_security_group.db_rotation.id
  description              = "MySQL from the password rotation Lambda"
}

# ---------------------------------------------------------------------------
# Function
# ---------------------------------------------------------------------------

# The zip holds index.py and the vendored PyMySQL (pure Python, MIT licence), so
# nothing is installed at plan or apply time.
data "archive_file" "db_rotation" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/rotate_db_user"
  output_path = "${path.module}/.terraform/db-rotation.zip"
  excludes    = ["**/__pycache__/**", "**/*.pyc"]
}

resource "aws_cloudwatch_log_group" "db_rotation" {
  name              = "/aws/lambda/${local.db_rotation_name}"
  retention_in_days = 14
}

data "aws_iam_policy_document" "db_rotation_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "db_rotation" {
  name               = "${local.db_rotation_name}-role"
  assume_role_policy = data.aws_iam_policy_document.db_rotation_assume.json
}

# Network interfaces in the VPC, and log writing.
resource "aws_iam_role_policy_attachment" "db_rotation_vpc" {
  role       = aws_iam_role.db_rotation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Only the one secret it rotates. GetRandomPassword takes no resource.
data "aws_iam_policy_document" "db_rotation" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecretVersionStage",
    ]
    resources = [aws_secretsmanager_secret.db_app_credentials.arn]
  }

  # The master login, used only to create the second account and set its
  # password. Read only.
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.mysql.master_user_secret[0].secret_arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetRandomPassword"]
    resources = ["*"]
  }
}

# A customer-managed policy rather than an inline one: it can carry the project
# tags, and the shared sandbox's daily sweep strips untaggable inline policies.
resource "aws_iam_policy" "db_rotation" {
  name   = "${local.db_rotation_name}-secret"
  policy = data.aws_iam_policy_document.db_rotation.json
}

resource "aws_iam_role_policy_attachment" "db_rotation" {
  role       = aws_iam_role.db_rotation.name
  policy_arn = aws_iam_policy.db_rotation.arn
}

resource "aws_lambda_function" "db_rotation" {
  function_name = local.db_rotation_name
  role          = aws_iam_role.db_rotation.arn
  runtime       = "python3.12"
  handler       = "index.handler"
  timeout       = 60
  memory_size   = 128

  filename         = data.archive_file.db_rotation.output_path
  source_code_hash = data.archive_file.db_rotation.output_base64sha256

  vpc_config {
    subnet_ids         = [aws_subnet.private_zone1.id, aws_subnet.private_zone2.id]
    security_group_ids = [aws_security_group.db_rotation.id]
  }

  environment {
    variables = {
      # From the database resource, not the secret, so a secret cannot point
      # this function at another host or another login.
      DB_HOST           = aws_db_instance.mysql.address
      DB_PORT           = "3306"
      MASTER_SECRET_ARN = aws_db_instance.mysql.master_user_secret[0].secret_arn
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.db_rotation,
    aws_iam_role_policy_attachment.db_rotation_vpc,
    aws_iam_role_policy_attachment.db_rotation,
  ]
}

resource "aws_lambda_permission" "secrets_manager_invoke_db_rotation" {
  statement_id   = "AllowSecretsManagerInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.db_rotation.function_name
  principal      = "secretsmanager.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret_rotation" "db_app_credentials" {
  secret_id           = aws_secretsmanager_secret.db_app_credentials.id
  rotation_lambda_arn = aws_lambda_function.db_rotation.arn

  # Applying this must not change the password the live app is using.
  rotate_immediately = false

  rotation_rules {
    # 19:00 UTC on the 1st of each month, which is 03:00 on the 2nd in
    # Singapore, with up to two hours for the rotation to start. First one:
    # 1 December 19:00 UTC.
    schedule_expression = "cron(0 19 1 * ? *)"
    duration            = "2h"
  }

  depends_on = [aws_lambda_permission.secrets_manager_invoke_db_rotation]
}
