data "aws_caller_identity" "current" {}

module "github_oidc_bootstrap" {
  source                     = "./github-oidc-bootstrap"
  github_repository_username = "alexongmac"
  github_repository_names    = ["ASTRA"]
  github_oidc_role_name      = "${local.eks_name}-github-oidc-role"
  github_allowed_branches    = ["main", "develop"]
  # gh api repos/alexongmac/ASTRA --jq '{owner_id: .owner.id, repo_id: .id}'
  github_owner_id = 54748360
  github_repo_ids = {
    ASTRA = 1364155602
  }
}

resource "aws_iam_role_policy" "github_oidc_policy" {
  name = "terraform-self-read-policy"
  role = module.github_oidc_bootstrap.github_oidc_role_name

  # See the prevent_destroy note on the OIDC role in github-oidc-bootstrap -
  # this role's own inline policies must survive a destroy or CI loses its
  # only AWS credential mid-run.
  # lifecycle {
  #   prevent_destroy = true
  # }

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "OidcProviderList"
        Effect   = "Allow"
        Action   = "iam:ListOpenIDConnectProviders"
        Resource = "*"
      },
      {
        Sid      = "OidcProviderRead"
        Effect   = "Allow"
        Action   = "iam:GetOpenIDConnectProvider"
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
      },
      {
        Sid    = "GithubOidcRoleRead"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies"
        ]
        Resource = module.github_oidc_bootstrap.github_oidc_role_arn
      }
    ]
  })
}
