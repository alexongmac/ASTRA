# Grants cert-manager's pod the Route 53 permissions needed for the ACME
# DNS-01 challenge (writing/deleting the temporary _acme-challenge TXT
# record) when issuing real Let's Encrypt certs for *.sctp-sandbox.com.
# Scoped to only this one hosted zone - cert-manager has no reason to touch
# any other zone in the account.
data "aws_iam_policy_document" "cert_manager_pod_identity_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cert_manager" {
  name               = "${local.eks_name}-cert-manager-role"
  assume_role_policy = data.aws_iam_policy_document.cert_manager_pod_identity_assume.json
}

data "aws_iam_policy_document" "cert_manager_route53" {
  statement {
    effect    = "Allow"
    actions   = ["route53:GetChange"]
    resources = ["arn:aws:route53:::change/*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "route53:ChangeResourceRecordSets",
      "route53:ListResourceRecordSets",
    ]
    resources = ["arn:aws:route53:::hostedzone/Z00541411T1NGPV97B5C0"]
  }

  statement {
    effect    = "Allow"
    actions   = ["route53:ListHostedZonesByName"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "cert_manager_route53" {
  name   = "Route53Dns01Challenge"
  role   = aws_iam_role.cert_manager.name
  policy = data.aws_iam_policy_document.cert_manager_route53.json
}

resource "aws_eks_pod_identity_association" "cert_manager" {
  cluster_name    = aws_eks_cluster.eks.name
  namespace       = "cert-manager"
  service_account = "cert-manager"
  role_arn        = aws_iam_role.cert_manager.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}

# external-dns watches Ingress/Service hosts and keeps Route 53 records for
# them in sync automatically. Same single-zone scope as cert-manager above -
# no reason for it to see any other hosted zone in this shared account.
data "aws_iam_policy_document" "external_dns_pod_identity_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "external_dns" {
  name               = "${local.eks_name}-external-dns-role"
  assume_role_policy = data.aws_iam_policy_document.external_dns_pod_identity_assume.json
}

data "aws_iam_policy_document" "external_dns_route53" {
  statement {
    effect = "Allow"
    actions = [
      "route53:ChangeResourceRecordSets",
      "route53:ListResourceRecordSets",
    ]
    resources = ["arn:aws:route53:::hostedzone/Z00541411T1NGPV97B5C0"]
  }

  statement {
    effect = "Allow"
    actions = [
      "route53:ListHostedZones",
      "route53:ListHostedZonesByName",
      "route53:ListTagsForResource",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "external_dns_route53" {
  name   = "Route53RecordSync"
  role   = aws_iam_role.external_dns.name
  policy = data.aws_iam_policy_document.external_dns_route53.json
}

resource "aws_eks_pod_identity_association" "external_dns" {
  cluster_name    = aws_eks_cluster.eks.name
  namespace       = "external-dns"
  service_account = "external-dns"
  role_arn        = aws_iam_role.external_dns.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}
