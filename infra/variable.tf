variable "environment" {
    description = "The environment for the deployment (e.g., dev, staging, prod)"
    type        = string
}

variable "project" {
    description = "The name of the project"
    type        = string
    default     = "astra"

}

variable "aws_region" {
    description = "The AWS region to deploy resources"
    type        = string
    default     = "us-east-1"
}



