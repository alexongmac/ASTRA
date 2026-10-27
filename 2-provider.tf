provider "aws" {
  region = local.region
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
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
