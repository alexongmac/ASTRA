provider "aws" {
  region = local.region

  default_tags {
    tags = {
      Project     = "capstone-project-group-01"
      Environment = var.environment
      Team        = local.team_name
      # Other teams' resources in this shared sandbox carry this tag and
      # survive the daily 6am AWSNukeAdminRole sweep - ours doesn't, and
      # gets wiped. Adding it is an attempt to opt out the same way.
      NukeProtection = "Enabled"
    }
  }
}

# No kubernetes or helm provider here, deliberately.
#
# Terraform manages AWS only. Everything inside the cluster - ArgoCD itself,
# the astra AppProject, the root Applications, and every workload - is applied
# with kubectl from the ASTRA_argocd repo. See that repo's
# bootstrap/argocd-install/ for ArgoCD, and this repo's README for the order.
#
# Both providers authenticate by running `aws eks get-token` against the
# cluster endpoint, and Terraform evaluates provider config at PLAN time. That
# made `terraform plan` require a reachable, healthy cluster - precisely what
# you do not have when something is broken. A cert-manager CA rotation once
# failed the apply with an x509 webhook error, and the production node-group
# outage blocked it too. ArgoCD was the only consumer, so removing it removed
# the dependency: plan is now pure AWS API.
#
# The same plan-time evaluation is why the bootstrap manifests were never
# managed here either: the kubectl provider validates at plan time and rejects
# a manifest whose CRDs do not exist yet - a ClusterPolicy before Kyverno has
# synced, for example - which blocked `terraform plan` entirely. A manual
# `kubectl apply` does not pre-validate that way.
#
# If you add a resource that needs cluster access, prefer a kubectl step in
# the README or a new ArgoCD Application over reinstating these providers.

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
    # Zips the queue-alert Lambda source (27-queue-alarms.tf).
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
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



