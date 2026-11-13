#!/usr/bin/env bash
set -euo pipefail

# Install staging Worker secrets from a PRIVATE local file.
# No values printed, logged, pushed to GitHub or passed as process arguments.
# Usage: bash scripts/install-whatsapp-staging-secrets.sh /private/path/worker-secrets.env

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/.wrangler.whatsapp.local.jsonc"
KEY_FILE="${1:-}"
WORKER="meta-master-whatsapp-gateway-staging"
DATABASE="2b17507a-8455-4a94-b32b-615de1af9f86"

if [[ -z "$KEY_FILE" || ! -f "$KEY_FILE" ]]; then
  echo "Provide a private worker-secrets.env file path (no content)." >&2
  exit 1
fi
if [[ ! -f "$CONFIG" ]]; then
  echo "Missing ignored .wrangler.whatsapp.local.jsonc staging configuration." >&2
  exit 1
fi
if ! grep -Fq "\"name\": \"$WORKER\"" "$CONFIG" ||
   ! grep -Fq "\"database_id\": \"$DATABASE\"" "$CONFIG" ||
   ! grep -Fq '"workers_dev": false' "$CONFIG"; then
  echo "Staging config must target the exact Worker and D1 database with workers_dev=false." >&2
  exit 1
fi
perms="$(stat -c '%a' "$KEY_FILE")"
owner="$(stat -c '%u' "$KEY_FILE")"
if [[ "$owner" != "$(id -u)" || "$perms" != "600" ]]; then
  echo "Private secret file must be owned by the current user and mode 0600." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "Node/npm are required." >&2
  exit 1
fi

read_value() {
  local name="$1" line
  # Parse simple KEY=value only; never source or eval an arbitrary file.
  line="$(grep -E "^${name}=" "$KEY_FILE" || true)"
  if [[ "$line" != *$'\n'* && -n "$line" ]]; then
    printf '%s' "${line#*=}"
  else
    echo "Missing or duplicated required setting: $name" >&2
    return 1
  fi
}

BRIDGE_ID="$(read_value BAILEYS_BRIDGE_ID)"
HMAC_KEY="$(read_value BAILEYS_BRIDGE_HMAC_KEY)"
DATA_KEY="$(read_value WHATSAPP_DATA_KEY)"
ENABLED="$(read_value BAILEYS_BRIDGE_INGRESS_ENABLED)"
if [[ "$BRIDGE_ID" != "omen-local" ||
      ! "$HMAC_KEY" =~ ^[A-Za-z0-9_-]{43}$ ||
      ! "$DATA_KEY" =~ ^[A-Za-z0-9_-]{43}$ ||
      "$HMAC_KEY" == "$DATA_KEY" ||
      "$ENABLED" != "true" ]]; then
  echo "Invalid staging values: bridge ID, independent 256-bit keys or ingress flag." >&2
  exit 1
fi

cd "$ROOT"
echo "Checking Cloudflare account before staging secret installation."
npx --no-install wrangler whoami
echo "Installing four secret bindings on $WORKER (values hidden)."
for setting in BAILEYS_BRIDGE_ID BAILEYS_BRIDGE_HMAC_KEY WHATSAPP_DATA_KEY BAILEYS_BRIDGE_INGRESS_ENABLED; do
  value="$(read_value "$setting")"
  printf '%s' "$value" | npx --no-install wrangler secret put "$setting" -c "$CONFIG"
  unset value
done
unset HMAC_KEY DATA_KEY BRIDGE_ID ENABLED
echo "All staging secrets uploaded. The workers.dev route remains disabled."
