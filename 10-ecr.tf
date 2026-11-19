resource "aws_ecr_repository" "app" {
  name                 = "${local.eks_name}-app"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true # lets terraform destroy remove it even if it still holds images

  # Scans each image against AWS's CVE feed as it arrives. The CI pipeline
  # already runs Snyk before pushing and Trivy scans what is running in the
  # cluster, so this mainly covers images pushed outside the pipeline, which
  # would otherwise reach the registry unscanned.
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last 10 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["sha", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}
