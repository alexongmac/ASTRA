#!/usr/bin/env bash
# Prove the astra_app login works and is limited to row access. Development only.
# Run after scripts/create-db-app-user.sh, with the same port-forward open:
#   kubectl port-forward -n mysql pod/rds-proxy 3306:3306
#
# Reads the login from Secrets Manager, runs app/scripts/check-app-user.mts
# (a read, plus two forbidden statements that must be refused), then lists the
# operators through the app's own Prisma client as astra_app. Prints no secrets.
set -euo pipefail

CLUSTER="astra-eks-development-cluster"
APP_SECRET="astra-eks-development-db-app-credentials"
PORT=3306

cd "$(dirname "$0")/.."

context="$(kubectl config current-context)"
case "$context" in
  *"cluster/$CLUSTER") ;;
  *) echo "Refusing to run: kubectl context is '$context', expected the development cluster ($CLUSTER)." >&2; exit 1 ;;
esac
nc -z 127.0.0.1 "$PORT" 2>/dev/null || { echo "Start: kubectl port-forward -n mysql pod/rds-proxy $PORT:$PORT" >&2; exit 1; }

APP_DATABASE_URL="$(aws secretsmanager get-secret-value --secret-id "$APP_SECRET" --query SecretString --output text | python3 -c "
import json, sys, urllib.parse
s = json.load(sys.stdin)
print('mysql://%s:%s@127.0.0.1:3306/astradb' % (
    urllib.parse.quote(s['username'], safe=''), urllib.parse.quote(s['password'], safe='')))
")"
export APP_DATABASE_URL

echo "==> Privilege check"
(cd app && npx --no-install tsx scripts/check-app-user.mts)

echo "==> Reading through the app's own Prisma client as the app login"
(cd app && DATABASE_URL="$APP_DATABASE_URL" npx --no-install tsx scripts/list-operators.mts | sed 's/^/    /')
