# Notes

# one-time setup, after provider.tf changes
terraform init -reconfigure

# create/select workspaces
terraform workspace new dev
terraform workspace new prod

# day to day
terraform workspace select dev
terraform apply -var-file=envs/development.tfvars

terraform workspace select prod
terraform apply -var-file=envs/production.tfvars


State files will land at:

astra-env/dev/astra/terraform.tfstate
astra-env/prod/astra/terraform.tfstate


