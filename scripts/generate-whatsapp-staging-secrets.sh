#!/usr/bin/env bash
set -euo pipefail

# Strictly LOCAL secrets generation. NEVER deploys, prints or commits secrets.
# Run from repository root. Refuse to overwrite existing credentials.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="$ROOT/.private/whatsapp-staging.env"
if [[ -e "$SECRETS" ]]; then
  printf '%s\n' "Existing private credentials file found; refusing to overwrite."
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required." >&2
  exit 1
fi
umask 077
mkdir -p "$ROOT/.private"
chmod 700 "$ROOT/.private"
HMAC_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
DATA_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
SPOOL_KEY="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
if [[ "${#HMAC_KEY}" -ne 43 || "${#DATA_KEY}" -ne 43 ||
      "${#SPOOL_KEY}" -ne 43 ||
      "$HMAC_KEY" == "$DATA_KEY" ||
      "$HMAC_KEY" == "$SPOOL_KEY" ||
      "$DATA_KEY" == "$SPOOL_KEY" ]]; then
  echo "Failed to generate two independent 256-bit keys." >&2
  exit 1
fi
{
  printf 'BAILEYS_BRIDGE_INGRESS_ENABLED=true\n'
  printf 'BAILEYS_BRIDGE_ID=omen-local\n'
  printf 'BAILEYS_BRIDGE_HMAC_KEY=%s\n' "$HMAC_KEY"
  printf 'WHATSAPP_DATA_KEY=%s\n' "$DATA_KEY"
  printf 'BAILEYS_SPOOL_KEY=%s\n' "$SPOOL_KEY"
} > "$SECRETS"
chmod 600 "$SECRETS"
unset HMAC_KEY DATA_KEY SPOOL_KEY
printf 'Created private local secret file (mode 0600): %s\n' "$SECRETS"
printf '%s\n' "Do not paste or upload its contents. No Cloudflare changes were made."
