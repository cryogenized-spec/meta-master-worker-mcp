# WhatsApp gateway on Cloudflare — staging deployment gate

**Status:** prepared, not provisioned or deployed. These instructions describe Cloudflare account changes requiring the operator's explicit terminal execution. No account IDs, production secrets, contacts, WhatsApp pairing, incoming messages or OpenAI requests are included.

The current **Baileys Node process remains on the HP OMEN**. This stage moves the private signed event intake into a dedicated Cloudflare Worker + D1 database. It does NOT deploy the Baileys socket itself.

## 1. Deployment layout

- A **separate staging Worker** named \`meta-master-whatsapp-gateway-staging\`, using the existing \`src/index.ts\` router.
- A **separate staging D1 database** named \`meta-master-whatsapp-staging\`, bound only as \`WHATSAPP_DB\`.
- Existing route: \`POST /internal/whatsapp/baileys\`, enabled only when \`BAILEYS_BRIDGE_INGRESS_ENABLED=true\`.
- Authentication: a dedicated random 32-byte \`BAILEYS_BRIDGE_HMAC_KEY\`; signed raw body + bridge ID + Unix timestamp + nonce, five-minute skew. D1 receipts prevent replay.
- Encryption: a DIFFERENT random 32-byte \`WHATSAPP_DATA_KEY\`; sender identifiers and message content are stored encrypted in D1. These keys must never be shared with a Meta app secret or your OpenAI API key.
- The \`/webhooks/whatsapp\` official Meta endpoint is separate and stays disabled unless its own official credentials are present.
- MCP OAuth remains separately disabled until its other Worker bindings are configured. The staging gateway is **not** a consumer-facing AI service.

## 2. Operator setup on HP OMEN (commands do NOT silently deploy)

From the repository root:

\`\`\`bash
cd ~/meta-master-worker-mcp
git pull --ff-only
npm ci
npm run check
npm run build
bash -n scripts/generate-whatsapp-staging-secrets.sh

# Generate private, distinct secrets only on your own laptop.
bash scripts/generate-whatsapp-staging-secrets.sh

# Login and confirm which Cloudflare account will be used.
npx --no-install wrangler whoami
\`\`\`

The script writes \`.private/whatsapp-staging.env\` with file permissions 0600 and **does not print secret values** or make any Cloudflare changes. If the file already exists, the generator refuses to overwrite it. Back it up securely; losing the data key makes encrypted conversation records unreadable.

Provision the dedicated **staging** database on your own Cloudflare account:

\`\`\`bash
npx --no-install wrangler d1 create meta-master-whatsapp-staging
\`\`\`

Use the real database UUID returned by Wrangler only in a **local ignored** config file. The repository template contains a deliberately invalid placeholder UUID:

\`\`\`bash
cp wrangler.whatsapp.example.jsonc .wrangler.whatsapp.local.jsonc
nano .wrangler.whatsapp.local.jsonc
\`\`\`

Change only the \`database_id\` to the returned UUID. Check the name and account. Keep \`workers_dev: false\` until ready for an authenticated HTTPS ingress test. Cloudflare Workers cannot receive public HTTPS traffic without a route or a workers.dev URL. For staging test access, an operator may deliberately change \`workers_dev\` to \`true\` just before deploying.

Apply the **two WhatsApp migrations, in order**, to the staging database. Both are shipped with the repo. **Do not apply 0001_meta_connections.sql** to the separate WhatsApp D1 instance:

\`\`\`bash
npx --no-install wrangler d1 execute meta-master-whatsapp-staging --remote --file=migrations/0002_whatsapp_gateway.sql
npx --no-install wrangler d1 execute meta-master-whatsapp-staging --remote --file=migrations/0003_whatsapp_bridge.sql
\`\`\`

These commands mutate the remote database; check the target account/database name before running. They should be run only for the new staging instance, not a pre-existing production database.

## 3. Staging secrets

After choosing the correct private config and target Worker, upload the individual secret values through Wrangler. Avoid echoing or pasting them into a terminal command that would enter shell history.

\`\`\`bash
# Interactive: supply values from your private secret file when prompted.
npx --no-install wrangler secret put BAILEYS_BRIDGE_ID -c .wrangler.whatsapp.local.jsonc
npx --no-install wrangler secret put BAILEYS_BRIDGE_HMAC_KEY -c .wrangler.whatsapp.local.jsonc
npx --no-install wrangler secret put WHATSAPP_DATA_KEY -c .wrangler.whatsapp.local.jsonc
npx --no-install wrangler secret put BAILEYS_BRIDGE_INGRESS_ENABLED -c .wrangler.whatsapp.local.jsonc
\`\`\`

Use \`omen-local\` for \`BAILEYS_BRIDGE_ID\`, \`true\` for \`BAILEYS_BRIDGE_INGRESS_ENABLED\`, and the two different values in \`.private/whatsapp-staging.env\` for the HMAC and data keys. Cloudflare's \`secret put\` may create a Worker version/deployment as part of configuration, depending on account/runtime; do not treat it as a no-impact read operation. No keys should be committed or published.

Run a **dry-run** build first:

\`\`\`bash
npx --no-install wrangler deploy -c .wrangler.whatsapp.local.jsonc --dry-run --outdir dist-whatsapp
\`\`\`

Only after explicit operator approval, deploy staging through:

\`\`\`bash
npx --no-install wrangler deploy -c .wrangler.whatsapp.local.jsonc
\`\`\`

A public workers.dev test route must still verify HMAC on every request. Without both non-example secrets, the ingress fails closed. Record the HTTPS endpoint privately as the Baileys \`BAILEYS_BRIDGE_URL\` (suffix \`/internal/whatsapp/baileys\`). Do **not** include that URL and credentials in the same public issue.

## 4. Connectivity acceptance gate

Before using any personal WhatsApp account:

1. Verify unsigned and invalid signatures fail with HTTP 401; missing enable/secrets returns 503.
2. POST a **synthetic fixture** signed using the Node \`transport.ts\` signing routine (not a real customer message). Expect HTTP 200 and encrypted D1 receipt.
3. Re-submit the *same* signed fixture: HTTP 200, one D1 event. Submit different body with same nonce and valid MAC: HTTP 409.
4. Confirm D1 contains no plaintext message text or customer phone number; the agent control row remains OFF.
5. Configure an explicit local test-chat allowlist. The observer must not access other chats, groups, message history or outbound send APIs.
6. Decide separately whether to pair a disposable WhatsApp test account or a primary personal account, with full awareness of platform restrictions.

CI tests already exercise the signed bridge and replay logic in local workerd D1. A local passing test is not live account validation.

## 5. Eventually move Baileys to Cloudflare too

As of November 2026, Cloudflare offers **Containers** running Linux/Node processes managed by Durable Objects. This is the likely route for the real-time Baileys WebSocket; a stateless Worker request is **not** a drop-in replacement for the long-lived Node process.

An **image build scaffold** lives at \`apps/baileys-bridge/Dockerfile\`. The image is intentionally inert and \`BAILEYS_HOST_MODE=cloudflare-container\` is rejected at runtime if \`BAILEYS_ENABLE=true\`. This guard must remain until a durable, encrypted Baileys Signal authentication store has been implemented and reviewed.

Why the guard matters: **Cloudflare Container filesystems are ephemeral**; a restart can discard multi-file Baileys auth state. Container snapshots exist, but session keys rotate and must be persisted reliably, not only at infrequent snapshots. A future design can store encrypted auth state in a Durable Object's SQLite storage or a strongly consistent authenticated storage service, with key rotation, account isolation and migration tests. It must persist key changes before acknowledging them and must guarantee a single active connector per number. This is not yet built.

Additional host requirements before a cloud move:
- Cloudflare Workers Paid and Container billing review (a continuously connected process cannot assume scale-to-zero savings).
- Single-instance ownership and lease/fencing of Baileys sessions.
- Persisted send/receive spool and retry/dead-letter handling. Current observer **can lose events** on network failure.
- Recovery across container sleep, host restart, deploy rollouts and lost connectivity.
- A private control plane; avoid public QR code/status routes.
- Migration of locally saved auth state to encrypted hosted state with explicit operator consent, no re-pair without approval.
- Evaluate whether an adapted Cloudflare-native WebSocket + Durable Object implementation can meet all protocol/session requirements, but do not claim the current Baileys Node package runs directly in Workers isolates.

Authoritative documentation:
- https://developers.cloudflare.com/containers/get-started/
- https://developers.cloudflare.com/containers/api/durable-object-container/
- https://developers.cloudflare.com/containers/concepts/architecture/
- https://developers.cloudflare.com/containers/platform/pricing/
- https://developers.cloudflare.com/containers/guides/migrate-to-durable-object-container-api/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
