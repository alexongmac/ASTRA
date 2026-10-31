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
#     '<cluster-name>#<principal-arn>#arn:aws:eks::aws:cluster-access-policy/<policy-name-from-tfvars>'
variable "teammates" {
  description = "Map of teammate name to IAM principal ARN, optional AWS managed EKS policy, and optional Kubernetes RBAC groups"
  type = map(object({
    principal_arn = string
    # One of the AWS managed cluster-access-policy names (AmazonEKSClusterAdminPolicy,
    # AmazonEKSAdminPolicy, AmazonEKSEditPolicy, AmazonEKSViewPolicy), or null to rely
    # solely on kubernetes_groups below for custom RBAC (see rbac.yaml).
    policy = optional(string)
    # Kubernetes groups this principal authenticates as - bind these to
    # ClusterRole(Binding)s/RoleBindings in rbac.yaml for custom RBAC.
    kubernetes_groups = optional(list(string), [])
  }))
  default = {}
}

resource "aws_eks_access_entry" "teammates" {
  for_each          = var.teammates
  cluster_name      = aws_eks_cluster.eks.name
  principal_arn     = each.value.principal_arn
  kubernetes_groups = each.value.kubernetes_groups
}

resource "aws_eks_access_policy_association" "teammates_admin" {
  for_each      = { for name, t in var.teammates : name => t if t.policy != null }
  cluster_name  = aws_eks_cluster.eks.name
  principal_arn = each.value.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/${each.value.policy}"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.teammates]
}
