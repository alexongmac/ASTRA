# Credentials for the application's own MySQL user (astra_app).
#
# The web app and worker used to connect as the RDS master user, which can drop
# tables and create users. astra_app can only SELECT, INSERT, UPDATE and DELETE
# rows in the astradb database, and only from inside the VPC. The master user
# remains for migrations and seeding, run by a person through the rds-proxy pod.
#
# This file creates only the empty secret that will hold the user's login. The
# MySQL user itself is created, and this secret filled in, by
# scripts/create-db-app-user.sh, so the generated password never appears in
# Terraform state or Git. External Secrets (26-external-secrets.tf) reads this
# secret and builds the app's DATABASE_URL from it.

resource "aws_secretsmanager_secret" "db_app_credentials" {
  name        = "${local.eks_name}-db-app-credentials"
  description = "Login for the astra_app MySQL user. JSON with username and password. Set by scripts/create-db-app-user.sh."
  # A pointer to a login that can be regenerated, so no recovery window: a
  # 30-day pending deletion would block recreating it after a destroy.
  recovery_window_in_days = 0
}

output "db_app_credentials_secret_name" {
  description = "Secrets Manager secret holding the astra_app MySQL login"
  value       = aws_secretsmanager_secret.db_app_credentials.name
}
