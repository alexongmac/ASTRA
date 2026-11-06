# Lambda function that ingests r2d2/+/oee/event MQTT messages into machine_events (RDS)

resource "aws_security_group" "oee_ingest_lambda" {
  name        = "${local.eks_name}-oee-ingest-lambda-sg"
  description = "Security group for the OEE ingest Lambda (RDS access only)"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.eks_name}-oee-ingest-lambda-sg"
  }
}

resource "aws_security_group_rule" "rds_from_oee_ingest_lambda" {
  type                     = "ingress"
  from_port                = 3306
  to_port                  = 3306
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = aws_security_group.oee_ingest_lambda.id
  description              = "MySQL from OEE ingest Lambda"
}

data "aws_iam_policy_document" "oee_ingest_lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "oee_ingest_lambda" {
  name               = "${local.eks_name}-oee-ingest-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.oee_ingest_lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "oee_ingest_lambda_vpc" {
  role       = aws_iam_role.oee_ingest_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "oee_ingest_lambda_secret" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.mysql.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "oee_ingest_lambda_secret" {
  name   = "${local.eks_name}-oee-ingest-lambda-secret-policy"
  role   = aws_iam_role.oee_ingest_lambda.id
  policy = data.aws_iam_policy_document.oee_ingest_lambda_secret.json
}

resource "aws_lambda_layer_version" "pymysql" {
  layer_name          = "${local.eks_name}-pymysql"
  filename            = "${path.module}/lambda/pymysql-layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/lambda/pymysql-layer.zip")
  compatible_runtimes = ["python3.12"]
}

resource "aws_lambda_function" "oee_ingest" {
  function_name = "${local.eks_name}-oee-ingest"
  role          = aws_iam_role.oee_ingest_lambda.arn
  handler       = "handler.handler"
  runtime       = "python3.12"
  timeout       = 10

  filename         = "${path.module}/lambda/oee-ingest.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda/oee-ingest.zip")

  layers = [aws_lambda_layer_version.pymysql.arn]

  vpc_config {
    subnet_ids         = [aws_subnet.private_zone1.id, aws_subnet.private_zone2.id]
    security_group_ids = [aws_security_group.oee_ingest_lambda.id]
  }

  environment {
    variables = {
      RDS_HOST       = aws_db_instance.mysql.address
      RDS_PORT       = tostring(aws_db_instance.mysql.port)
      RDS_DB         = aws_db_instance.mysql.db_name
      RDS_SECRET_ARN = aws_db_instance.mysql.master_user_secret[0].secret_arn
    }
  }
}

resource "aws_lambda_permission" "allow_iot" {
  statement_id  = "AllowIoTInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.oee_ingest.function_name
  principal     = "iot.amazonaws.com"
  source_arn    = aws_iot_topic_rule.oee_events_to_rds.arn
}

resource "aws_iot_topic_rule" "oee_events_to_rds" {
  name        = "${replace(local.eks_name, "-", "_")}_oee_events_to_rds"
  description = "Ingest r2d2/+/oee/event MQTT messages into machine_events (RDS)"
  enabled     = true
  sql         = "SELECT * FROM 'r2d2/+/oee/event'"
  sql_version = "2016-03-23"

  lambda {
    function_arn = aws_lambda_function.oee_ingest.arn
  }
}
