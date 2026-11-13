# WhatsApp gateway on Cloudflare — staging deployment gate

## Live free-tier checkpoint — 13 November 2026

The account already has the isolated `meta-master-whatsapp-staging` D1 database, and migrations 0002 and 0003 were applied and verified. The dedicated `meta-master-whatsapp-gateway-staging` Worker has been uploaded with its D1 binding to this exact database. **Its workers.dev URL and preview URLs remain disabled and no secrets are yet installed.** Operator account: Cryogenized. **Do not repeat the database creation commands below**; they remain as new-account reference instructions.

No paid plan, Containers, R2, OpenAI calls, WhatsApp account pairing or customer message sends have occurred. The deployed Worker is compiled from `src/whatsapp-staging.ts`, which exposes only `/health` and `/internal/whatsapp/baileys`. It does not deploy the main MCP/OAuth entrypoint.

### Install the private stage keys from the operator's HP OMEN

The Cloudflare connector declined an attempt to send private credential values. Rather than weaken that protection, the operator must install them locally using the guarded script. Download the two private configuration files supplied in the conversation to the HP OMEN; never attach them to GitHub or another chat.

```bash
mkdir -p ~/.config/meta-master-mcp
chmod 700 ~/.config/meta-master-mcp
mv ~/Downloads/meta-master-whatsapp-worker-secrets.env \
  ~/.config/meta-master-mcp/worker-secrets.env
chmod 600 ~/.config/meta-master-mcp/worker-secrets.env

cd ~/meta-master-worker-mcp
git pull --ff-only
npm ci
cp wrangler.whatsapp.example.jsonc .wrangler.whatsapp.local.jsonc
sed -i 's/00000000-0000-4000-8000-000000000000/2b17507a-8455-4a94-b32b-615de1af9f86/' \
  .wrangler.whatsapp.local.jsonc

bash scripts/install-whatsapp-staging-secrets.sh \
  ~/.config/meta-master-mcp/worker-secrets.env
```

The installer checks the exact Worker/D1 identifiers, disabled route, file permissions, independent 256-bit keys and Cloudflare login. It pipes each secret through standard input to Wrangler and never prints its value. Secret upload may create new Worker deployments. Inspect `wrangler whoami` to verify the intended Cloudflare account. Save the private recovery file offline; losing `WHATSAPP_DATA_KEY` means stored events cannot be decrypted.

Then install the **local observer** settings:

```bash
cp ~/Downloads/meta-master-baileys-local.env \
  ~/meta-master-worker-mcp/apps/baileys-bridge/.env.local
chmod 600 ~/meta-master-worker-mcp/apps/baileys-bridge/.env.local
```

The `.env.local` file explicitly keeps `BAILEYS_ENABLE=false` and `BAILEYS_ALLOW_PAIRING=false`. Running `npm start` does not automatically load this file and remains safe/off by default. The synthetic ingress command later uses `node --env-file=.env.local dist/smoke.js` and requires an explicit `BAILEYS_SMOKE_SEND=true` per execution.

**Stop here until the four Worker secret bindings are verified and the public test URL is intentionally enabled.** The existing staging Worker has no public route. The next controlled test is a synthetic signed fixture, not real WhatsApp messages.


**Original template status:** source and reference instructions prepared. See the live checkpoint above for current staging deployment state. These instructions describe Cloudflare account changes requiring the operator's explicit terminal execution. No account IDs, production secrets, contacts, WhatsApp pairing, incoming messages or OpenAI requests are included.

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

### Safe signed smoke request without connecting WhatsApp

Once the Worker is deployed with **real** staging secrets, you can submit a fake, clearly-labelled message through the same HMAC protocol without pairing any WhatsApp account:

```bash
cd ~/meta-master-worker-mcp/apps/baileys-bridge
cp .env.example .env.local
nano .env.local
# Keep BAILEYS_ENABLE=false and BAILEYS_ALLOW_PAIRING=false.
# Set only BAILEYS_BRIDGE_URL, BAILEYS_BRIDGE_ID=omen-local and
# BAILEYS_BRIDGE_HMAC_KEY to the same private HMAC key as the Worker.
# Never put the WHATSAPP_DATA_KEY or your WhatsApp number here.
npm run build
BAILEYS_SMOKE_SEND=true node --env-file=.env.local dist/smoke.js
```

Expected success is a **signed synthetic event accepted** message. This uses a fictitious contact and **does not contact WhatsApp**. The resulting D1 entry is test data; remove it under an approved retention policy when the live pipeline is implemented. Running `npm run smoke` without `BAILEYS_SMOKE_SEND=true` does nothing.


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
