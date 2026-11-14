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

  enabled_cluster_log_types = ["api", "audit"]

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

# EKS auto-creates and owns this cluster security group (no security_group_ids
# set above), so Terraform never created it - but its rules are still real
# infrastructure that something outside Terraform has repeatedly wiped,
# leaving nodes NotReady (no control-plane<->node traffic, no node->internet
# egress). Managing its rules here means `terraform apply` can always restore
# them, instead of a one-off `aws ec2 authorize-security-group-*` that has
# nothing to re-assert it after the next wipe.
data "aws_security_group" "cluster" {
  id = aws_eks_cluster.eks.vpc_config[0].cluster_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "cluster_self" {
  security_group_id            = data.aws_security_group.cluster.id
  referenced_security_group_id = data.aws_security_group.cluster.id
  ip_protocol                  = "-1"
  description                  = "Control-plane-node and node-node traffic"
}
