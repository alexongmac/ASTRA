# External Secrets Operator (installed by Argo CD from the ASTRA_argocd repo)
# copies the RDS-managed master credentials from Secrets Manager into a
# Kubernetes Secret, so a password rotation no longer needs a manual edit.
#
# Only the IAM side lives here. The operator's controller pod gets this role
# through EKS Pod Identity, bound to the "external-secrets" service account in
# the "external-secrets" namespace (the chart is told to create exactly that
# service account; Pod Identity needs no annotation on it).

resource "aws_iam_role" "external_secrets" {
  name               = "${local.eks_name}-external-secrets-role"
  assume_role_policy = data.aws_iam_policy_document.web_app_pod_identity_assume.json
}

# Read-only and scoped to the one secret it exists to sync.
data "aws_iam_policy_document" "external_secrets" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [aws_db_instance.mysql.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "external_secrets" {
  name   = "${local.eks_name}-external-secrets-policy"
  role   = aws_iam_role.external_secrets.id
  policy = data.aws_iam_policy_document.external_secrets.json
}

resource "aws_eks_pod_identity_association" "external_secrets" {
  cluster_name    = aws_eks_cluster.eks.name
  namespace       = "external-secrets"
  service_account = "external-secrets"
  role_arn        = aws_iam_role.external_secrets.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}
