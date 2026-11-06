# 1. S3 Bucket for storing RDS exports
#AWS Secrets Manager auto-generation), which eliminates the need to declare or manage any var.db_password variables in your repository.

resource "aws_s3_bucket" "rds_export" {
  bucket        = "astra-rds-mysql-export-bucket"
  force_destroy = true
}

# 2. DB Subnet Group (Using private subnets defined in 3-subnets.tf)
resource "aws_db_subnet_group" "rds" {
  name       = "astra-rds-subnet-group"
  subnet_ids = [aws_subnet.private_zone1.id, aws_subnet.private_zone2.id]

  tags = {
    Name = "astra-rds-subnet-group"
  }
}

# 2a. Security Group for RDS - ingress rules declared separately below
# (aws_security_group_rule resources) so multiple files can add rules
# without each apply fighting over the inline ingress block.
resource "aws_security_group" "rds" {
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

# 3. RDS MySQL Instance with Auto-Generated Password via AWS Secrets Manager
resource "aws_db_instance" "mysql" {
  identifier                  = "astra-mysql-db"
  allocated_storage           = 20
  engine                      = "mysql"
  engine_version              = "8.0"
  instance_class              = "db.t3.micro"
  db_name                     = "astradb"
  username                    = "dbadmin"
  manage_master_user_password = true # Auto-generates & manages credentials in Secrets Manager
  # Explicit because this account's default alias/aws/secretsmanager key
  # resolution to RDS comes back null without it (KMSKeyNotAccessibleFault).
  master_user_secret_kms_key_id = "alias/aws/secretsmanager"
  db_subnet_group_name          = aws_db_subnet_group.rds.name
  vpc_security_group_ids        = [aws_security_group.rds.id]
  skip_final_snapshot           = true
}

# 4. IAM Role for RDS Export Tasks to S3
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

# 5. IAM Policy granting S3 permissions to the export role
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