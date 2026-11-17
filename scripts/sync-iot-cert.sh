#!/usr/bin/env bash
# Sync the AWS IoT device certificate from Terraform state to the mosquitto
# bridge on the Raspberry Pi. Run after every `terraform apply` that recreates
# aws_iot_certificate.raspberry_pi (e.g. after a destroy/apply cycle).
#
# Usage: scripts/sync-iot-cert.sh [ssh-host]     (default host: r2d2-ts)
#        scripts/sync-iot-cert.sh --force [ssh-host]   reinstall even if unchanged
set -euo pipefail

FORCE=0
if [ "${1:-}" = "--force" ]; then FORCE=1; shift; fi

PI_HOST="${1:-r2d2-ts}"
CERT_DIR="/home/linuxbrew/.linuxbrew/etc/mosquitto/certs"
CERT_FILE="device-certificate.pem.crt"
KEY_FILE="device-private.pem.key"
SERVICE="sh.brew.mosquitto"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"

cd "$(dirname "$0")/.."

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fingerprint() { openssl x509 -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f'; }

echo "==> Reading certificate and key from Terraform outputs"
terraform output -raw iot_certificate_pem > "$TMP/$CERT_FILE"
terraform output -raw iot_private_key > "$TMP/$KEY_FILE"

cert_pub="$(openssl x509 -in "$TMP/$CERT_FILE" -noout -pubkey | openssl sha256)"
key_pub="$(openssl pkey -in "$TMP/$KEY_FILE" -pubout | openssl sha256)"
if [ "$cert_pub" != "$key_pub" ]; then
    echo "ERROR: private key in Terraform state does not match the certificate" >&2
    exit 1
fi

new_fp="$(fingerprint < "$TMP/$CERT_FILE")"
old_fp="$($SSH "$PI_HOST" "cat $CERT_DIR/$CERT_FILE 2>/dev/null" | fingerprint 2>/dev/null || true)"
echo "    Terraform: $new_fp"
echo "    $PI_HOST: ${old_fp:-<none>}"

if [ "$new_fp" = "$old_fp" ] && [ "$FORCE" -eq 0 ]; then
    echo "==> Certificate on $PI_HOST is already current, nothing to install"
else
    backup="backup-$(date +%Y%m%d-%H%M%S)"
    echo "==> Backing up current files on $PI_HOST to $CERT_DIR/$backup"
    $SSH "$PI_HOST" "mkdir -p $CERT_DIR/$backup && chmod 700 $CERT_DIR/$backup && cp -p $CERT_DIR/$CERT_FILE $CERT_DIR/$KEY_FILE $CERT_DIR/$backup/ 2>/dev/null || true"

    echo "==> Installing new certificate and key"
    scp -o BatchMode=yes -q "$TMP/$CERT_FILE" "$PI_HOST:$CERT_DIR/$CERT_FILE.new"
    scp -o BatchMode=yes -q "$TMP/$KEY_FILE" "$PI_HOST:$CERT_DIR/$KEY_FILE.new"
    $SSH "$PI_HOST" "cd $CERT_DIR && chmod 644 $CERT_FILE.new && chmod 600 $KEY_FILE.new && mv $CERT_FILE.new $CERT_FILE && mv $KEY_FILE.new $KEY_FILE"

    echo "==> Restarting mosquitto"
    $SSH "$PI_HOST" "systemctl --user restart $SERVICE"
fi

echo "==> Checking bridge connection to AWS IoT (port 8883)"
for _ in $(seq 1 6); do
    sleep 5
    if $SSH "$PI_HOST" "ss -tn state established | grep -q ':8883\b'"; then
        # A rejected certificate drops within a second or two; make sure it holds.
        sleep 10
        if $SSH "$PI_HOST" "ss -tn state established | grep -q ':8883\b'"; then
            echo "==> OK: bridge is connected to AWS IoT"
            exit 0
        fi
    fi
done

echo "ERROR: bridge is not connected to AWS IoT. Check on $PI_HOST:" >&2
echo "       systemctl --user status $SERVICE" >&2
exit 1
