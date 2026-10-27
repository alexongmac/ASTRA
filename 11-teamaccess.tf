# Gotcha: bootstrap_cluster_creator_admin_permissions = true (9-eks.tf) means
# AWS implicitly grants whoever runs the cluster's FIRST `terraform apply` an
# admin access entry outside Terraform's knowledge. If that person is also
# listed below, this resource's for_each will try to create a duplicate entry
# and fail with "ResourceInUseException: ... already in use on this cluster".
# Fix once per new environment: after the first apply succeeds, import the
# entry and its policy association into state, then re-apply:
#   terraform import 'aws_eks_access_entry.teammates["<name>"]' \
#     '<cluster-name>:<principal-arn>'
#   terraform import 'aws_eks_access_policy_association.teammates_admin["<name>"]' \
#     '<cluster-name>#<principal-arn>#arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy'
variable "teammate_principal_arns" {
  description = "Map of teammate name to IAM principal ARN to grant EKS cluster admin access"
  type        = map(string)
  default     = {}
}

resource "aws_eks_access_entry" "teammates" {
  for_each      = var.teammate_principal_arns
  cluster_name  = aws_eks_cluster.eks.name
  principal_arn = each.value
}

resource "aws_eks_access_policy_association" "teammates_admin" {
  for_each      = var.teammate_principal_arns
  cluster_name  = aws_eks_cluster.eks.name
  principal_arn = each.value
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.teammates]
}
