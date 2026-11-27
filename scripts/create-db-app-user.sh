#!/usr/bin/env bash
# Create the application's least-privilege MySQL user (astra_app) and store its
# login in Secrets Manager. Development only.
#
# The app used to connect as the RDS master user. astra_app can only SELECT,
# INSERT, UPDATE and DELETE rows in astradb, and only from inside the VPC.
# The master user stays for migrations and seeding.
#
# Prerequisites
#   1. terraform apply has created the secret (28-db-app-user.tf).
#   2. kubectl points at the development cluster.
#   3. In another terminal, the database is reachable on localhost:3306:
#        kubectl port-forward -n mysql pod/rds-proxy 3306:3306
#   4. `npm ci` has been run in app/.
#
# Safe to run again: it generates a new password, resets the MySQL user and
# overwrites the secret. Nothing secret is printed or written outside a
# temporary file that is deleted on exit.
#
# Usage: scripts/create-db-app-user.sh
set -euo pipefail

CLUSTER="astra-eks-development-cluster"
DB_IDENTIFIER="astra-mysql-db"
APP_SECRET="astra-eks-development-db-app-credentials"
APP_USER="astra_app"
PORT=3306

cd "$(dirname "$0")/.."

context="$(kubectl config current-context)"
case "$context" in
  *"cluster/$CLUSTER") ;;
  *) echo "Refusing to run: kubectl context is '$context', expected the development cluster ($CLUSTER)." >&2; exit 1 ;;
esac

if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "Nothing is listening on localhost:$PORT." >&2
  echo "In another terminal run: kubectl port-forward -n mysql pod/rds-proxy $PORT:$PORT" >&2
  exit 1
fi

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Reading the master login from the RDS-managed secret"
master_arn="$(aws rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)"
aws secretsmanager get-secret-value --secret-id "$master_arn" --query SecretString --output text > "$TMP/master.json"

# Build the connection URL for the master user (password percent-encoded) and
# keep it in this process's environment only.
ADMIN_DATABASE_URL="$(python3 - "$TMP/master.json" <<'PY'
import json, sys, urllib.parse
s = json.load(open(sys.argv[1]))
print("mysql://%s:%s@127.0.0.1:3306/astradb" % (
    urllib.parse.quote(s["username"], safe=""), urllib.parse.quote(s["password"], safe="")))
PY
)"
export ADMIN_DATABASE_URL
rm -f "$TMP/master.json"

# 36 random bytes -> more than 32 letters and digits. No punctuation, so the
# password needs no escaping in a URL.
APP_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
export APP_PASSWORD

echo "==> Creating $APP_USER with row-level rights on astradb"
(cd app && npx --no-install tsx scripts/create-app-user.mts)

echo "==> Storing the login in Secrets Manager ($APP_SECRET)"
python3 - "$APP_USER" > "$TMP/app-secret.json" <<'PY'
import json, os, sys
print(json.dumps({"username": sys.argv[1], "password": os.environ["APP_PASSWORD"]}))
PY
aws secretsmanager put-secret-value --secret-id "$APP_SECRET" \
  --secret-string "file://$TMP/app-secret.json" --query VersionId --output text > /dev/null

echo "==> Done. $APP_USER exists and its login is in $APP_SECRET."
echo "    Next: scripts/check-db-app-user.sh to prove it works and is limited."
