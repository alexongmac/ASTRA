resource "aws_iot_thing" "raspberry_pi" {
  name = local.thing_name
}

resource "aws_iot_policy" "raspberry_pi" {
  name = "${local.eks_name}-${local.thing_name}-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Connect"
        Effect = "Allow"
        Action = "iot:Connect"
        Resource = "arn:aws:iot:${local.region}:${data.aws_caller_identity.current.account_id}:client/${local.mqtt_client_id}"
      },
      {
        Sid    = "PublishSubscribe"
        Effect = "Allow"
        Action = ["iot:Publish", "iot:Subscribe", "iot:Receive"]
        Resource = [
          "arn:aws:iot:${local.region}:${data.aws_caller_identity.current.account_id}:topic/${local.mqtt_topic_prefix}/*",
          "arn:aws:iot:${local.region}:${data.aws_caller_identity.current.account_id}:topicfilter/${local.mqtt_topic_prefix}/*",
        ]
      },
    ]
  })
}

resource "aws_iot_certificate" "raspberry_pi" {
  active = true
}

resource "aws_iot_policy_attachment" "raspberry_pi" {
  policy = aws_iot_policy.raspberry_pi.name
  target = aws_iot_certificate.raspberry_pi.arn
}

resource "aws_iot_thing_principal_attachment" "raspberry_pi" {
  thing     = aws_iot_thing.raspberry_pi.name
  principal = aws_iot_certificate.raspberry_pi.arn
}

data "aws_iot_endpoint" "this" {
  endpoint_type = "iot:Data-ATS"
}
