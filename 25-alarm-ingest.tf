# MQTT ingest for the Alarm Acknowledgement web app.
#
# IoT topic rules put each r2d2/+/oee/event and r2d2/+/oee/summary message on an
# SQS queue; the web app's worker (running in EKS) reads the queue, stores the
# telemetry and raises or clears alarms in RDS.

resource "aws_sqs_queue" "oee_events_dlq" {
  name                      = "${local.eks_name}-oee-events-dlq"
  message_retention_seconds = 1209600 # 14 days, the maximum
}

resource "aws_sqs_queue" "oee_events" {
  name                       = "${local.eks_name}-oee-events"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.oee_events_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "iot_to_sqs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["iot.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "iot_to_sqs" {
  name               = "${local.eks_name}-iot-to-sqs-role"
  assume_role_policy = data.aws_iam_policy_document.iot_to_sqs_assume.json
}

data "aws_iam_policy_document" "iot_to_sqs" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.oee_events.arn]
  }
}

resource "aws_iam_role_policy" "iot_to_sqs" {
  name   = "${local.eks_name}-iot-to-sqs-policy"
  role   = aws_iam_role.iot_to_sqs.id
  policy = data.aws_iam_policy_document.iot_to_sqs.json
}

resource "aws_iot_topic_rule" "oee_events_to_sqs" {
  name        = "${replace(local.eks_name, "-", "_")}_oee_events_to_sqs"
  description = "Queue r2d2/+/oee/event messages for the alarm worker"
  enabled     = true
  sql         = "SELECT * FROM 'r2d2/+/oee/event'"
  sql_version = "2016-03-23"

  sqs {
    queue_url  = aws_sqs_queue.oee_events.url
    role_arn   = aws_iam_role.iot_to_sqs.arn
    use_base64 = false
  }
}

resource "aws_iot_topic_rule" "oee_summaries_to_sqs" {
  name        = "${replace(local.eks_name, "-", "_")}_oee_summaries_to_sqs"
  description = "Queue r2d2/+/oee/summary messages for the alarm worker"
  enabled     = true
  sql         = "SELECT * FROM 'r2d2/+/oee/summary'"
  sql_version = "2016-03-23"

  sqs {
    queue_url  = aws_sqs_queue.oee_events.url
    role_arn   = aws_iam_role.iot_to_sqs.arn
    use_base64 = false
  }
}

# The web app pod reads the queue and the RDS credentials through EKS Pod Identity.

data "aws_iam_policy_document" "web_app_pod_identity_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web_app" {
  name               = "${local.eks_name}-web-app-role"
  assume_role_policy = data.aws_iam_policy_document.web_app_pod_identity_assume.json
}

data "aws_iam_policy_document" "web_app" {
  statement {
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:DeleteMessageBatch",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.oee_events.arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.mysql.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "web_app" {
  name   = "${local.eks_name}-web-app-policy"
  role   = aws_iam_role.web_app.id
  policy = data.aws_iam_policy_document.web_app.json
}

resource "aws_eks_pod_identity_association" "web_app" {
  cluster_name    = aws_eks_cluster.eks.name
  namespace       = "web-app"
  service_account = "astra-web-app"
  role_arn        = aws_iam_role.web_app.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}

# The web app pods reach MySQL through the existing "MySQL from EKS cluster"
# ingress rule in 21-rds-mysql.tf, which already covers the cluster security
# group every pod gets.

output "oee_events_queue_url" {
  value = aws_sqs_queue.oee_events.url
}

output "web_app_role_arn" {
  value = aws_iam_role.web_app.arn
}
