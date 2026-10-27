resource "aws_eks_cluster" "eks" {
  name     = "${local.eks_name}-cluster"
  version  = local.eks_version
  role_arn = aws_iam_role.cluster.arn

  access_config {
    authentication_mode = "API"
    # true only matters at cluster *creation* time (AWS grants the creator an
    # implicit admin access entry then); changing this on an existing cluster
    # forces a full destroy+recreate for zero effect, so it's left as-is here.
    # Explicit admin access for everyone (including whoever bootstraps a new
    # env) still comes from aws_eks_access_entry.teammates in terraform.tfvars.
    bootstrap_cluster_creator_admin_permissions = true
  }

  vpc_config {
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = ["0.0.0.0/0"]

    subnet_ids = [
      aws_subnet.private_zone1.id,
      aws_subnet.private_zone2.id,
    ]
  }

  depends_on = [aws_iam_role_policy_attachment.cluster_policy]
}
