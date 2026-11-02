# S3 Bucket for storing RDS snapshots/exports
resource "aws_s3_bucket" "rds_export" {
  bucket        = "astra-rds-mysql-export-bucket"
  force_destroy = true
}

# Subnet Group for RDS
resource "aws_db_subnet_group" "rds" {
  name       = "astra-rds-subnet-group"
  subnet_ids = [aws_subnet.private_zone1.id, aws_subnet.private_zone2.id]
}

# RDS MySQL Instance
resource "aws_db_instance" "mysql" {
  identifier             = "astra-mysql-db"
  allocated_storage      = 20
  engine                 = "mysql"
  engine_version         = "8.0"
  instance_class         = "db.t3.micro"
  db_name                = "astradb"
  username               = "dbadmin"
  password               = var.db_password # Define in variables
  db_subnet_group_name   = aws_db_subnet_group.rds.name
  skip_final_snapshot    = true
}