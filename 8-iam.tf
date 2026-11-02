data "aws_iam_policy_document" "eks_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}


resource "aws_iam_role" "cluster" {
  name               = "${local.eks_name}-cluster-role"
  assume_role_policy = data.aws_iam_policy_document.eks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

#add iam role for s3 exporting

# IAM Role for RDS Export Task
resource "aws_iam_role" "rds_export" {
  name = "astra-rds-s3-export-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
    }]
  })
}

# Policy allowing RDS to put objects into the S3 bucket
resource "aws_iam_role_policy" "rds_export" {
  name = "astra-rds-s3-export-policy"
  role = aws_iam_role.rds_export.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject*",
        "s3:GetObject*",
        "s3:AbortMultipartUpload",
        "s3:ListBucket"
      ]
      Resource = [
        aws_s3_bucket.rds_export.arn,
        "${aws_s3_bucket.rds_export.arn}/*"
      ]
    }]
  })
}