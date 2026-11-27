# External Secrets Operator (installed by Argo CD from the ASTRA_argocd repo)
# copies the astra_app database login from Secrets Manager into a Kubernetes
# Secret, so a password rotation (29-db-app-rotation.tf) needs no manual edit.
#
# Only the IAM side lives here. The operator's controller pod gets this role
# through EKS Pod Identity, bound to the "external-secrets" service account in
# the "external-secrets" namespace (the chart is told to create exactly that
# service account; Pod Identity needs no annotation on it).

resource "aws_iam_role" "external_secrets" {
  name               = "${local.eks_name}-external-secrets-role"
  assume_role_policy = data.aws_iam_policy_document.web_app_pod_identity_assume.json
}

# Read-only, and only the secrets it can be asked to sync: the astra_app login
# the app uses, and the RDS master secret (kept for rolling the app back to it).
data "aws_iam_policy_document" "external_secrets" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_db_instance.mysql.master_user_secret[0].secret_arn,
      # The astra_app login the application actually uses (28-db-app-user.tf).
      aws_secretsmanager_secret.db_app_credentials.arn,
    ]
  }
}

# A customer-managed policy rather than an inline one: it can carry the project
# tags, and the shared sandbox's daily sweep strips untaggable inline policies,
# which would leave External Secrets unable to read the login.
resource "aws_iam_policy" "external_secrets" {
  name   = "${local.eks_name}-external-secrets"
  policy = data.aws_iam_policy_document.external_secrets.json
}

resource "aws_iam_role_policy_attachment" "external_secrets" {
  role       = aws_iam_role.external_secrets.name
  policy_arn = aws_iam_policy.external_secrets.arn
}

resource "aws_eks_pod_identity_association" "external_secrets" {
  cluster_name    = aws_eks_cluster.eks.name
  namespace       = "external-secrets"
  service_account = "external-secrets"
  role_arn        = aws_iam_role.external_secrets.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}
