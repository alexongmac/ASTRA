variable "environment" {
  description = "Deployment environment (development or production)"
  type        = string
}

locals {
  region      = "us-east-1"
  zone1       = "us-east-1a"
  zone2       = "us-east-1b"
  eks_name    = "astra-eks-${var.environment}"
  eks_version = "1.37"
}
