# Alarms on the IoT -> SQS -> worker pipeline (25-alarm-ingest.tf), delivered to
# Discord.
#
#   CloudWatch alarm -> SNS topic -> Lambda -> Discord webhook
#
# Without these, a stuck worker or an unprocessable message goes unnoticed: the
# queue just fills, or a message sits in the dead-letter queue, with nobody told.
#
# The Discord webhook URL is NOT in Terraform. This file creates an empty secret
# for it; put the value in once, by hand (see the README note below), so it never
# lands in state or Git:
#
#   aws secretsmanager put-secret-value \
#     --secret-id astra-eks-<environment>-discord-webhook \
#     --secret-string 'https://discord.com/api/webhooks/...'

locals {
  queue_alerts_name = "${local.eks_name}-queue-alerts"
}

# ---------------------------------------------------------------------------
# Notification path
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "queue_alerts" {
  name = local.queue_alerts_name
}

# Empty on purpose: the value is set outside Terraform (see top of file).
resource "aws_secretsmanager_secret" "discord_webhook" {
  name        = "${local.eks_name}-discord-webhook"
  description = "Discord webhook URL used by the queue alert Lambda. Value is set by hand."
  # No recovery window: this is a pointer to a webhook, and a 30-day pending
  # deletion would block recreating it after a destroy.
  recovery_window_in_days = 0
}

data "archive_file" "discord_alerts" {
  type        = "zip"
  source_file = "${path.module}/lambda/discord_alerts/index.py"
  output_path = "${path.module}/.terraform/discord-alerts.zip"
}

resource "aws_cloudwatch_log_group" "discord_alerts" {
  name              = "/aws/lambda/${local.queue_alerts_name}-discord"
  retention_in_days = 14
}

data "aws_iam_policy_document" "discord_alerts_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "discord_alerts" {
  name               = "${local.queue_alerts_name}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.discord_alerts_assume.json
}

data "aws_iam_policy_document" "discord_alerts" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.discord_webhook.arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.discord_alerts.arn}:*"]
  }
}

# A customer-managed policy rather than an inline one: it can carry the project
# tags, and the shared sandbox's daily sweep strips untaggable inline policies.
resource "aws_iam_policy" "discord_alerts" {
  name   = "${local.queue_alerts_name}-lambda"
  policy = data.aws_iam_policy_document.discord_alerts.json
}

resource "aws_iam_role_policy_attachment" "discord_alerts" {
  role       = aws_iam_role.discord_alerts.name
  policy_arn = aws_iam_policy.discord_alerts.arn
}

resource "aws_lambda_function" "discord_alerts" {
  function_name = "${local.queue_alerts_name}-discord"
  role          = aws_iam_role.discord_alerts.arn
  runtime       = "python3.12"
  handler       = "index.handler"
  timeout       = 15
  memory_size   = 128

  filename         = data.archive_file.discord_alerts.output_path
  source_code_hash = data.archive_file.discord_alerts.output_base64sha256

  environment {
    variables = {
      WEBHOOK_SECRET_ARN = aws_secretsmanager_secret.discord_webhook.arn
      ENVIRONMENT        = var.environment
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.discord_alerts,
    aws_iam_role_policy_attachment.discord_alerts,
  ]
}

resource "aws_lambda_permission" "sns_invoke_discord_alerts" {
  statement_id  = "AllowSnsInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.discord_alerts.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.queue_alerts.arn
}

resource "aws_sns_topic_subscription" "discord_alerts" {
  topic_arn = aws_sns_topic.queue_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.discord_alerts.arn
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------

# Any message here is an event that failed three times and was NOT saved to the
# database. It stays 14 days, so there is time to look, but only if someone is told.
resource "aws_cloudwatch_metric_alarm" "oee_dlq_not_empty" {
  alarm_name          = "${local.eks_name}-oee-dlq-not-empty"
  alarm_description   = "A message reached the dead-letter queue: an OEE event failed processing 3 times and was not saved. Inspect the queue ${aws_sqs_queue.oee_events_dlq.name}."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  # SQS stops publishing for an idle, empty queue; that means healthy.
  treat_missing_data = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.oee_events_dlq.name
  }

  alarm_actions = [aws_sns_topic.queue_alerts.arn]
  ok_actions    = [aws_sns_topic.queue_alerts.arn]
}

# The worker normally drains the queue within seconds, so a backlog that stays
# for 10 minutes means the worker is down, crash-looping or too slow, and
# operators are seeing stale data. The queue holds messages for 4 days.
resource "aws_cloudwatch_metric_alarm" "oee_queue_backlog" {
  alarm_name          = "${local.eks_name}-oee-queue-backlog"
  alarm_description   = "More than 100 OEE events have been waiting in ${aws_sqs_queue.oee_events.name} for 10 minutes. Check that the astra-web-app-worker pod is running."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 10
  datapoints_to_alarm = 10
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.oee_events.name
  }

  alarm_actions = [aws_sns_topic.queue_alerts.arn]
  ok_actions    = [aws_sns_topic.queue_alerts.arn]
}
