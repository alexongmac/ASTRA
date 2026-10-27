output "cluster_name" {
  value = aws_eks_cluster.eks.name
}

output "cluster_endpoint" {
  value = replace(aws_eks_cluster.eks.endpoint, "https://", "")
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "github_oidc_role_arn" {
  value = module.github_oidc_bootstrap.github_oidc_role_arn
}
