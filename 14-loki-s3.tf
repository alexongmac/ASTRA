resource "aws_s3_bucket" "loki" {
  bucket        = "${local.eks_name}-loki-logs"
  force_destroy = true
}

resource "aws_s3_bucket_lifecycle_configuration" "loki" {
  bucket = aws_s3_bucket.loki.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = 14
    }
  }
}

data "aws_iam_policy_document" "loki_pod_identity_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "loki" {
  name               = "${local.eks_name}-loki-role"
  assume_role_policy = data.aws_iam_policy_document.loki_pod_identity_assume.json
}

data "aws_iam_policy_document" "loki_s3" {
  statement {
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.loki.arn,
      "${aws_s3_bucket.loki.arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "loki_s3" {
  name   = "${local.eks_name}-loki-s3-policy"
  role   = aws_iam_role.loki.id
  policy = data.aws_iam_policy_document.loki_s3.json
}

resource "aws_eks_pod_identity_association" "loki" {
  cluster_name    = aws_eks_cluster.eks.name
  namespace       = "monitoring"
  service_account = "loki"
  role_arn        = aws_iam_role.loki.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}
