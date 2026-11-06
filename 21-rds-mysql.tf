# 1. S3 Bucket for storing RDS exports
#AWS Secrets Manager auto-generation), which eliminates the need to declare or manage any var.db_password variables in your repository.

resource "aws_s3_bucket" "rds_export" {
  bucket        = "astra-rds-mysql-export-bucket-${var.environment}"
  force_destroy = true
}

# 2. DB Subnet Group (Using private subnets defined in 3-subnets.tf)
resource "aws_db_subnet_group" "rds" {
  # Account/region-scoped, so each environment needs a distinct name to
  # avoid "DBSubnetGroupAlreadyExists" when a second environment is created.
  # development already owns the unsuffixed name below and keeps it - AWS's
  # ModifyDBInstance refuses to move an existing instance to a same-subnets
  # subnet group under a new name, so renaming it isn't possible anyway;
  # production (new VPC, new subnets) gets the suffixed name with no
  # conflict since it's being created fresh, not renamed.
  name       = var.environment == "development" ? "astra-rds-subnet-group" : "astra-rds-subnet-group-${var.environment}"
  subnet_ids = [aws_subnet.private_zone1.id, aws_subnet.private_zone2.id]

  tags = {
    Name = var.environment == "development" ? "astra-rds-subnet-group" : "astra-rds-subnet-group-${var.environment}"
  }
}

# 2a. Security Group for RDS - ingress rules declared separately below
# (aws_security_group_rule resources) so multiple files can add rules
# without each apply fighting over the inline ingress block.
resource "aws_security_group" "rds" {
  # Unlike the subnet group below, SG names are scoped per-VPC (each
  # environment has its own VPC), so no cross-environment collision risk -
  # no need to suffix this one, which avoids an AWS RDS limitation: moving
  # the instance to a same-subnets subnet group under a new name is allowed,
  # but AWS's ModifyDBInstance also requires actually detaching from this SG,
  # which needs its own apply step anyway. Keeping the original name sidesteps
  # that whole problem for the already-existing instance.
  name        = "astra-rds-sg"
  description = "Allow MySQL access from the EKS cluster"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "astra-rds-sg"
  }
}

resource "aws_security_group_rule" "rds_from_eks_cluster" {
  type                     = "ingress"
  from_port                = 3306
  to_port                  = 3306
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = aws_eks_cluster.eks.vpc_config[0].cluster_security_group_id
  description              = "MySQL from EKS cluster"
}

# Production only: the AWS-managed alias/aws/secretsmanager key fails with
# KMSKeyNotAccessibleFault on CreateDBInstance in this account, despite both
# the IAM role policy and the key policy allowing it - likely an org-level
# SCP restriction we can't inspect from inside this member account. A
# customer-managed key sidesteps whatever's blocking the AWS-managed one.
# development keeps using the AWS-managed key since it already works there.
# IAM is eventually consistent - the github-oidc-role's KMS permissions
# (module.github_oidc_bootstrap) can take a few seconds to actually be
# enforced after being granted, so CreateKey succeeds but the immediate
# DescribeKey read-back that finishes creating this resource fails with
# AccessDeniedException. This forces a wait before the key is created.
resource "time_sleep" "wait_for_kms_iam_propagation" {
  count           = var.environment == "production" ? 1 : 0
  depends_on      = [module.github_oidc_bootstrap]
  create_duration = "20s"
}

resource "aws_kms_key" "rds_secret" {
  count       = var.environment == "production" ? 1 : 0
  description = "Encrypts the RDS-managed master user secret for ${var.environment}"
  depends_on  = [time_sleep.wait_for_kms_iam_propagation]

  # Unlike the AWS-managed key, a customer-managed key has no default grant
  # for RDS/Secrets Manager to use it - this must be explicit, or
  # CreateDBInstance fails the same way as the AWS-managed key did.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowAccountFullAccess"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid    = "AllowRDSAndSecretsManagerUse"
        Effect = "Allow"
        Principal = {
          Service = ["rds.amazonaws.com", "secretsmanager.amazonaws.com"]
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:CreateGrant",
          "kms:DescribeKey",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:CallerAccount" = data.aws_caller_identity.current.account_id
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "rds_secret" {
  count         = var.environment == "production" ? 1 : 0
  name          = "alias/astra-rds-secret-${var.environment}"
  target_key_id = aws_kms_key.rds_secret[0].key_id
}

# 3. RDS MySQL Instance with Auto-Generated Password via AWS Secrets Manager
resource "aws_db_instance" "mysql" {
  # Not renamed for development - RDS identifier changes get bundled into
  # the same ModifyDBInstance call as the subnet-group change above, so
  # keeping this unsuffixed for the already-existing instance avoids
  # triggering that call at all.
  identifier                  = var.environment == "development" ? "astra-mysql-db" : "astra-mysql-db-${var.environment}"
  allocated_storage           = 20
  engine                      = "mysql"
  engine_version              = "8.0"
  instance_class              = "db.t3.micro"
  db_name                     = "astradb"
  username                    = "dbadmin"
  manage_master_user_password = true # Auto-generates & manages credentials in Secrets Manager
  # development: explicit because this account's default alias/aws/secretsmanager
  # key resolution to RDS comes back null without it (KMSKeyNotAccessibleFault).
  # production: the AWS-managed key itself is blocked (see aws_kms_key.rds_secret
  # above), so this uses the customer-managed key instead.
  master_user_secret_kms_key_id = var.environment == "production" ? aws_kms_alias.rds_secret[0].name : "alias/aws/secretsmanager"
  db_subnet_group_name          = aws_db_subnet_group.rds.name
  vpc_security_group_ids        = [aws_security_group.rds.id]
  skip_final_snapshot           = true
  # Without this, network/identifier changes queue for the next maintenance
  # window instead of applying now - Terraform's plan then can't actually
  # detach the old security group's RDS-owned ENI, and the dependent
  # subnet-group/security-group replacement fails.
  apply_immediately = true
}

# 4. IAM Role for RDS Export Tasks to S3
resource "aws_iam_role" "rds_export" {
  name = "astra-rds-s3-export-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
    }]
  })
}

# 5. IAM Policy granting S3 permissions to the export role
resource "aws_iam_role_policy" "rds_export" {
  name = "astra-rds-s3-export-policy-${var.environment}"
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