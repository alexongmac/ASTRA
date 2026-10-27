# Notes

### one-time setup, after provider.tf changes
 - terraform init -reconfigure

### day to day
- terraform init -backend-config="key=astra/development.tfstate"
- terraform apply -var-file=envs/development.tfvars

- terraform workspace select prod
- terraform apply -var-file=envs/production.tfvars

### State files will land at:
- astra-env/dev/astra/terraform.tfstate
- astra-env/prod/astra/terraform.tfstate


### Terraform Destroy

please take note of the git branch must be in "develop"
- terraform destroy -auto-approve -var-file="envs/development.tfvars

