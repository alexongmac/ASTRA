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
    # State locking: while a run is in progress Terraform keeps an
    # astra/<env>.tfstate.tflock object, so a second run waits instead of
    # overwriting the state. The pipeline role may delete *.tflock objects
    # (github-oidc-bootstrap, state_lock policy), so it releases its locks.
    #
    # The shared bucket's policy denies every delete to IAM users under
    # students/, so a laptop can take a lock but never release it. Therefore:
    #   - apply only through the pipeline (push, or "Run workflow" in
    #     .github/workflows/terraform-apply.yml);
    #   - plan locally with `terraform plan -lock=false` (read-only, safe);
    #   - if a lock is ever left behind, run the "Terraform Force Unlock"
    #     workflow with the lock ID from the error message.
    #
    # One exception: the sandbox's daily 6am sweep also strips the pipeline
    # role's own policies and policy attachments, so on those mornings the
    # pipeline cannot run until they are restored. Recover from a laptop with
    #   terraform apply -lock=false -var-file=envs/development.tfvars
    # only after checking that no pipeline run is in progress. That is the
    # only time a laptop apply is expected.
    use_lockfile = true
  }

  required_version = ">= 1.9"
}



