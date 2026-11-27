#!/usr/bin/env bash
# Create the application's two least-privilege MySQL accounts (astra_app and
# astra_app_clone) and store their logins in Secrets Manager. Development only.
#
# The app used to connect as the RDS master user. These accounts can only
# SELECT, INSERT, UPDATE and DELETE rows in astradb, and only from inside the
# VPC. The master user stays for migrations, seeding and this script.
#
# Why two: the monthly rotation (29-db-app-rotation.tf) alternates between them
# with no downtime. It changes the password of the account NOT in use by logging
# in as that account with its previous password, so it never needs the master
# login. That previous password is what this script stores as AWSPREVIOUS.
#
# Prerequisites
#   1. terraform apply has created the secret (28-db-app-user.tf).
#   2. kubectl points at the development cluster.
#   3. In another terminal, the database is reachable on localhost:3306:
#        kubectl port-forward -n mysql pod/rds-proxy 3306:3306
#   4. `npm ci` has been run in app/.
#
# Safe to run again: it generates two new passwords, resets both accounts and
# writes the secret so that astra_app is current and astra_app_clone is
# previous. Nothing secret is printed or written outside a temporary file that
# is deleted on exit. Pods using the old login lose it at that moment, so run it
# at a quiet time; they pick up the new one within 5 minutes.
#
# This is for the first setup, or to recover by hand if a rotation ever reports
# that the stored previous password no longer works.
#
# Usage: scripts/create-db-app-user.sh
set -euo pipefail

CLUSTER="astra-eks-development-cluster"
DB_IDENTIFIER="astra-mysql-db"
APP_SECRET="astra-eks-development-db-app-credentials"
APP_USER="astra_app"
CLONE_USER="astra_app_clone"
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

# 48 random bytes -> more than 40 letters and digits. No punctuation, so the
# passwords need no escaping in a URL.
APP_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
CLONE_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
export APP_PASSWORD CLONE_PASSWORD

echo "==> Creating $APP_USER and $CLONE_USER with row-level rights on astradb"
(cd app && npx --no-install tsx scripts/create-app-user.mts)

# Two writes, clone first. Each put-secret-value becomes AWSCURRENT and moves
# the version it replaces to AWSPREVIOUS, so this leaves astra_app current and
# astra_app_clone previous - the password the next rotation logs in with.
store() {
  python3 - "$1" "$2" > "$TMP/app-secret.json" <<'PY'
import json, os, sys
print(json.dumps({"username": sys.argv[1], "password": os.environ[sys.argv[2]]}))
PY
  aws secretsmanager put-secret-value --secret-id "$APP_SECRET" \
    --secret-string "file://$TMP/app-secret.json" --query VersionId --output text > /dev/null
  rm -f "$TMP/app-secret.json"
}
echo "==> Storing both logins in Secrets Manager ($APP_SECRET)"
store "$CLONE_USER" CLONE_PASSWORD
store "$APP_USER" APP_PASSWORD

echo "==> Done. $APP_USER is current and $CLONE_USER is previous in $APP_SECRET."
echo "    Next: scripts/check-db-app-user.sh to prove it works and is limited."
