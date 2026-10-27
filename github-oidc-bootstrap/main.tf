# Assumes the GitHub OIDC provider already exists in this AWS account
# (one provider is shared account-wide; creating it here would conflict
# if another stack/team in this account already created it).
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    # This repo has GitHub's immutable OIDC subject claims setting enabled
    # (Settings > Actions > General > Workflow permissions), so the `sub`
    # claim GitHub issues is "repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:..."
    # instead of the plain "repo:<owner>/<repo>:ref:...". Confirm via:
    #   gh api repos/<owner>/<repo>/actions/oidc/customization/sub
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = flatten([
        for name in var.github_repository_names : [
          for branch in var.github_allowed_branches :
          "repo:${var.github_repository_username}@${var.github_owner_id}/${name}@${var.github_repo_ids[name]}:ref:refs/heads/${branch}"
        ]
      ])
    }
  }
}

resource "aws_iam_role" "github_oidc" {
  name               = var.github_oidc_role_name
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

# No managed policies attached directly: every permission this role needs
# is scoped to this stack's own resources via the aws_iam_role_policy
# resources below (eks, networking, iam_scoped, s3_scoped, ecr_scoped).
# Image push/pull into the ECR repo this stack creates is a separate
# app/platform repo's concern with its own OIDC role.

# EKS cluster/node-group lifecycle + access-entry management for the stack
# this role provisions, and the eks:DescribeCluster/ListClusters that
# `aws eks update-kubeconfig` needs (used by this repo's own workflows and
# by whatever separate app/platform repo deploys workloads to the cluster).
resource "aws_iam_role_policy" "eks" {
  name = "eks-cluster-management"
  role = aws_iam_role.github_oidc.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "eks:CreateCluster",
        "eks:DeleteCluster",
        "eks:DescribeCluster",
        "eks:ListClusters",
        "eks:UpdateClusterConfig",
        "eks:UpdateClusterVersion",
        "eks:TagResource",
        "eks:UntagResource",
        "eks:CreateNodegroup",
        "eks:DeleteNodegroup",
        "eks:DescribeNodegroup",
        "eks:ListNodegroups",
        "eks:UpdateNodegroupConfig",
        "eks:UpdateNodegroupVersion",
        "eks:CreateAddon",
        "eks:DeleteAddon",
        "eks:DescribeAddon",
        "eks:DescribeAddonVersions",
        "eks:ListAddons",
        "eks:UpdateAddon",
        "eks:DescribeUpdate",
        "eks:CreateAccessEntry",
        "eks:DeleteAccessEntry",
        "eks:DescribeAccessEntry",
        "eks:ListAccessEntries",
        "eks:AssociateAccessPolicy",
        "eks:DisassociateAccessPolicy",
        "eks:ListAssociatedAccessPolicies",
        "eks:CreatePodIdentityAssociation",
        "eks:DeletePodIdentityAssociation",
        "eks:DescribePodIdentityAssociation",
        "eks:ListPodIdentityAssociations",
        "eks:UpdatePodIdentityAssociation",
      ]
      Resource = "*"
    }]
  })
}

# VPC/networking resources this stack provisions (VPC, subnets, IGW, NAT,
# route tables, EIP, launch templates, autoscaling-group tags for the
# cluster-autoscaler integration). Scoped to the specific actions used
# instead of AmazonEC2FullAccess.
resource "aws_iam_role_policy" "networking" {
  name = "vpc-networking-management"
  role = aws_iam_role.github_oidc.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Ec2Describe"
        Effect   = "Allow"
        Action   = ["ec2:Describe*"]
        Resource = "*"
      },
      {
        Sid    = "Ec2Manage"
        Effect = "Allow"
        Action = [
          "ec2:CreateVpc",
          "ec2:DeleteVpc",
          "ec2:ModifyVpcAttribute",
          "ec2:CreateSubnet",
          "ec2:DeleteSubnet",
          "ec2:ModifySubnetAttribute",
          "ec2:CreateInternetGateway",
          "ec2:DeleteInternetGateway",
          "ec2:AttachInternetGateway",
          "ec2:DetachInternetGateway",
          "ec2:CreateNatGateway",
          "ec2:DeleteNatGateway",
          "ec2:AllocateAddress",
          "ec2:ReleaseAddress",
          "ec2:AssociateAddress",
          "ec2:DisassociateAddress",
          "ec2:CreateRouteTable",
          "ec2:DeleteRouteTable",
          "ec2:CreateRoute",
          "ec2:DeleteRoute",
          "ec2:ReplaceRoute",
          "ec2:AssociateRouteTable",
          "ec2:DisassociateRouteTable",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:CreateLaunchTemplate",
          "ec2:DeleteLaunchTemplate",
          "ec2:CreateLaunchTemplateVersion",
          "ec2:ModifyLaunchTemplate",
          "ec2:CreateTags",
          "ec2:DeleteTags",
        ]
        Resource = "*"
      },
      {
        Sid    = "AutoScalingManage"
        Effect = "Allow"
        Action = [
          "autoscaling:CreateAutoScalingGroup",
          "autoscaling:DeleteAutoScalingGroup",
          "autoscaling:UpdateAutoScalingGroup",
          "autoscaling:CreateOrUpdateTags",
          "autoscaling:DeleteTags",
          "autoscaling:Describe*",
        ]
        Resource = "*"
      },
    ]
  })
}

# IAM roles/policies this Terraform stack manages (cluster, node, OIDC,
# pod-identity, autoscaler roles). Scoped to astra-eks-* / github-oidc
# role and policy names instead of IAMFullAccess, so this role cannot
# modify unrelated IAM principals or escalate privileges account-wide.
resource "aws_iam_role_policy" "iam_scoped" {
  name = "iam-stack-management"
  role = aws_iam_role.github_oidc.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "IamReadAndOidcProvider"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListOpenIDConnectProviders",
          "iam:GetOpenIDConnectProvider",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions",
        ]
        Resource = "*"
      },
      {
        Sid    = "ManageStackRolesAndPolicies"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:CreatePolicy",
          "iam:DeletePolicy",
          "iam:CreatePolicyVersion",
          "iam:DeletePolicyVersion",
          "iam:TagPolicy",
          "iam:UntagPolicy",
          "iam:CreateServiceLinkedRole",
          "iam:PassRole",
        ]
        Resource = [
          "arn:aws:iam::*:role/astra-eks-*",
          "arn:aws:iam::*:role/${var.github_oidc_role_name}",
          "arn:aws:iam::*:policy/astra-eks-*",
        ]
      },
    ]
  })
}

# S3 access limited to the Loki logs bucket this stack creates and the
# shared Terraform state bucket, instead of AmazonS3FullAccess.
resource "aws_iam_role_policy" "s3_scoped" {
  name = "s3-stack-management"
  role = aws_iam_role.github_oidc.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "LokiBucketManage"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:PutBucketTagging",
          "s3:GetBucketTagging",
          "s3:PutLifecycleConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:GetBucketPolicy",
          "s3:GetBucketAcl",
          "s3:GetBucketVersioning",
          "s3:GetBucketLogging",
          "s3:GetBucketWebsite",
          "s3:GetBucketCORS",
          "s3:GetBucketRequestPayment",
          "s3:GetReplicationConfiguration",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetEncryptionConfiguration",
          "s3:GetAccelerateConfiguration",
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::astra-*",
          "arn:aws:s3:::astra-*/*",
        ]
      },
      {
        Sid    = "TerraformStateBucket"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::sctp-tfstate-ce13",
          "arn:aws:s3:::sctp-tfstate-ce13/*",
        ]
      },
    ]
  })
}

# ECR repo management for the image this stack's app CI pushes/pulls.
resource "aws_iam_role_policy" "ecr_scoped" {
  name = "ecr-stack-management"
  role = aws_iam_role.github_oidc.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "EcrRepoManage"
      Effect = "Allow"
      Action = [
        "ecr:CreateRepository",
        "ecr:DeleteRepository",
        "ecr:DescribeRepositories",
        "ecr:PutLifecyclePolicy",
        "ecr:GetLifecyclePolicy",
        "ecr:TagResource",
        "ecr:UntagResource",
        "ecr:ListTagsForResource",
      ]
      Resource = "arn:aws:ecr:*:*:repository/astra-*"
    }]
  })
}

variable "github_repository_username" {
  description = "GitHub repository username"
  type        = string
}

variable "github_repository_names" {
  description = "GitHub repository names allowed to assume the role"
  type        = list(string)
}

# Required because this repo has GitHub's immutable OIDC subject claims
# setting enabled - find both IDs with:
#   gh api repos/<owner>/<repo> --jq '{owner_id: .owner.id, repo_id: .id}'
variable "github_owner_id" {
  description = "Numeric GitHub user/org ID of github_repository_username"
  type        = number
}

variable "github_repo_ids" {
  description = "Map of repository name (from github_repository_names) to its numeric GitHub repo ID"
  type        = map(number)
}

variable "github_oidc_role_name" {
  description = "Name of the GitHub OIDC role"
  type        = string
}

variable "github_allowed_branches" {
  description = "Branches allowed to assume the role (e.g. [\"main\", \"develop\"])"
  type        = list(string)
  default     = ["main", "develop"]
}

output "github_oidc_role_arn" {
  value = aws_iam_role.github_oidc.arn
}

output "github_oidc_role_name" {
  value = aws_iam_role.github_oidc.name
}
