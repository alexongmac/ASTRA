provider "aws" {
  region = var.aws_region
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.34"
    }
  }

  ## backend
  backend "s3" {
    bucket                = "sctp-tfstate-ce13"
    key                   = "astra/terraform.tfstate"
    region                = "us-east-1"
    workspace_key_prefix  = "astra-env"
    # S3 lockfiles disabled: bucket policy denies s3:DeleteObject for students,
    # so Terraform can create the .tflock but never release it.
    use_lockfile = false
  }

  required_version = ">= 1.10.0"
}w