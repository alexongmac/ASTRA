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
  db_subnet_group_name        = aws_db_subnet_group.rds.name
  skip_final_snapshot         = true
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