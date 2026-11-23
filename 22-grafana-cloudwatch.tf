# Lets Grafana read CloudWatch, so ALB request counts, 4XX/5XX and latency for
# the web app (and its WAF block counts) can be graphed next to the Prometheus
# and Loki panels. The web app is exposed through an AWS ALB, not Traefik, so
# Traefik's own metrics never see its traffic - CloudWatch is where it lives.
#
# Same arrangement as the Loki role in 14-loki-s3.tf: EKS Pod Identity, bound
# to the service account the chart creates. Pod Identity credentials are
# injected when a pod starts, so Grafana must be restarted once after the
# association exists before the CloudWatch datasource can authenticate.

resource "aws_iam_role" "grafana" {
  name               = "${local.eks_name}-grafana-role"
  assume_role_policy = data.aws_iam_policy_document.loki_pod_identity_assume.json
}

# Read-only, and limited to the calls Grafana's CloudWatch datasource makes
# for metrics, alarms and Logs Insights queries. No write actions of any kind.
# CloudWatch reads do not support resource-level scoping, hence
# Resource = "*".
data "aws_iam_policy_document" "grafana_cloudwatch" {
  statement {
    effect = "Allow"
    actions = [
      "cloudwatch:DescribeAlarmsForMetric",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:DescribeAlarmHistory",
      "cloudwatch:ListMetrics",
      "cloudwatch:GetMetricData",
      "cloudwatch:GetMetricStatistics",
    ]
    resources = ["*"]
  }

  # Read-only CloudWatch Logs access, so the datasource's "Save & test" passes
  # its logs check and CloudWatch Logs (e.g. EKS control-plane or WAF logs) can
  # be queried from Grafana later. Query actions only start and read Logs
  # Insights queries; nothing here can write, delete or change log data. The
  # web-app dashboard itself reads its logs from Loki, not from here.
  statement {
    effect = "Allow"
    actions = [
      "logs:DescribeLogGroups",
      "logs:GetLogGroupFields",
      "logs:StartQuery",
      "logs:StopQuery",
      "logs:GetQueryResults",
      "logs:GetLogEvents",
    ]
    resources = ["*"]
  }

  # Region list and dimension-value lookups in the query editor.
  statement {
    effect = "Allow"
    actions = [
      "ec2:DescribeRegions",
      "tag:GetResources",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "grafana_cloudwatch" {
  name   = "${local.eks_name}-grafana-cloudwatch-policy"
  role   = aws_iam_role.grafana.id
  policy = data.aws_iam_policy_document.grafana_cloudwatch.json
}

resource "aws_eks_pod_identity_association" "grafana" {
  cluster_name    = aws_eks_cluster.eks.name
  namespace       = "monitoring"
  service_account = "kube-prometheus-stack-grafana"
  role_arn        = aws_iam_role.grafana.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}
