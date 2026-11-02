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

output "github_oidc_role_name" {
  value = module.github_oidc_bootstrap.github_oidc_role_name
}

output "iot_endpoint" {
  value = data.aws_iot_endpoint.this.endpoint_address
}

output "iot_thing_name" {
  value = aws_iot_thing.raspberry_pi.name
}

output "iot_certificate_pem" {
  value     = aws_iot_certificate.raspberry_pi.certificate_pem
  sensitive = true
}

output "iot_private_key" {
  value     = aws_iot_certificate.raspberry_pi.private_key
  sensitive = true
}



