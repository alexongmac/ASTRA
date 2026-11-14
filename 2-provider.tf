provider "aws" {
  region = local.region

  default_tags {
    tags = {
      Project     = "capstone-project-group-01"
      Environment = var.environment
      Team        = local.team_name
    }
  }
}

provider "kubernetes" {
  host                   = aws_eks_cluster.eks.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.eks.certificate_authority[0].data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.eks.name, "--region", local.region]
  }
}

provider "helm" {
  kubernetes {
    host                   = aws_eks_cluster.eks.endpoint
    cluster_ca_certificate = base64decode(aws_eks_cluster.eks.certificate_authority[0].data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.eks.name, "--region", local.region]
    }
  }
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.13"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }

  # Partial backend config: bucket/region/use_lockfile are fixed, but `key`
  # must differ per environment so dev and prod never share state. Terraform
  # backend blocks can't reference variables, so `key` is supplied at
  # `terraform init -backend-config="key=astra/${environment}.tfstate"` time
  # (see .github/workflows/terraform-apply.yml).
  backend "s3" {
    bucket = "sctp-tfstate-ce13"
    region = "us-east-1"
    # S3 lockfiles disabled: bucket policy denies s3:DeleteObject for students,
    # so Terraform can create the .tflock but never release it.
    use_lockfile = false
  }

  required_version = ">= 1.9"
}



