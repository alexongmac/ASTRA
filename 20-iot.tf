resource "aws_iot_thing" "raspberry_pi" {
  name = local.thing_name
}

resource "aws_iot_policy" "raspberry_pi" {
  name = "${local.eks_name}-${local.thing_name}-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Connect"
        Effect   = "Allow"
        Action   = "iot:Connect"
        Resource = "arn:aws:iot:${local.region}:${data.aws_caller_identity.current.account_id}:client/${local.mqtt_client_id}"
      },
      {
        Sid    = "PublishSubscribe"
        Effect = "Allow"
        Action = ["iot:Publish", "iot:Subscribe", "iot:Receive"]
        Resource = [
          "arn:aws:iot:${local.region}:${data.aws_caller_identity.current.account_id}:topic/${local.mqtt_topic_prefix}/*/oee/*",
          "arn:aws:iot:${local.region}:${data.aws_caller_identity.current.account_id}:topicfilter/${local.mqtt_topic_prefix}/*/oee/*",
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

# Enables Fleet Indexing's connectivity tracking so live connect/disconnect
# status is queryable (iot:SearchIndex) and shows up in the console's
# "Manage MQTT client connectivity" view - off by default on a fresh account.
resource "aws_iot_indexing_configuration" "this" {
  thing_indexing_configuration {
    thing_indexing_mode              = "REGISTRY"
    thing_connectivity_indexing_mode = "STATUS"
  }
}
