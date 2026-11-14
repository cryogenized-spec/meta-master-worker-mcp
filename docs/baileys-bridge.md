# Baileys linked-device bridge — experimental prototype

This is an **unofficial, opt-in** connector for ordinary WhatsApp Messenger. It is not supported by WhatsApp and may violate platform terms. An account restriction/suspension is possible even if the system only responds to inbound messages. Do **not** connect an irreplaceable account merely because another user has been successful.

The purpose of this first implementation is **observation only**. It contains no WhatsApp send call, no agent/model API call, no outbound customer message, and no automatic joining of groups or indexing of entire history. Nothing has been paired or deployed.

## Architecture

```text
WhatsApp linked device (Baileys v7 rc, Node.js 24)
   - opt-in startup; QR pairing requires second opt-in
   - only fresh notify events, not history or outgoing messages
   - individual-chat allowlist mandatory; groups ignored
   |
   | POST /internal/whatsapp/baileys
   | HMAC-SHA256 over raw bytes + bridgeId + timestamp + nonce
   v
Meta Master Cloudflare Worker (separate from official Meta webhook)
   - dedicated bridge secret, strict signature and time window
   - hashed, opaque contact/message identifiers
   - D1 replay receipts committed with encrypted events
   - zero model execution, no send operation
   v
D1 encrypted WhatsApp inbox + OFF-by-default processing state
   - future authenticated human review / draft agent
```

The official `/webhooks/whatsapp` remains unchanged and continues to accept only Meta-signed Cloud API notifications. Never forward Baileys packets through that official endpoint.

## Version / runtime

- Separate package: `apps/baileys-bridge/`
- Node.js >=24, TypeScript 5.9.
- `@whiskeysockets/baileys@7.0.0-rc14` pinned to a specific published pre-release; the 7.x API contains breaking changes. Upgrade only after tests.
- `pino` silent logging; `qrcode-terminal` only for explicit local QR display.
- Cloudflare Worker/D1 code uses the existing root dependencies and does not import Baileys into the Worker runtime.

## Build and safe demonstration

```sh
npm ci
npm run check
npm run build

cd apps/baileys-bridge
npm ci
npm test
npm start
```

With the default environment, `npm start` reports **disabled** and never attempts a WhatsApp connection.

**Only after intentionally approving linking a suitable test account** should the operator privately supply settings based on `.env.example`: `BAILEYS_ENABLE=true`, `BAILEYS_ALLOW_PAIRING=true`, a specific test-contact `BAILEYS_ALLOWED_JIDS`, and `BAILEYS_BRIDGE_URL` / `BAILEYS_BRIDGE_ID` / `BAILEYS_BRIDGE_HMAC_KEY`.

The Worker needs **independently configured, private** `BAILEYS_BRIDGE_INGRESS_ENABLED=true`, `BAILEYS_BRIDGE_ID`, `BAILEYS_BRIDGE_HMAC_KEY`, `WHATSAPP_DB` and `WHATSAPP_DATA_KEY`. The bridge HMAC key and data-encryption key must be different random 32-byte values. No value or actual account number belongs in GitHub issues, code, logs or CI.

**Current staging status:** a separate Cloudflare D1 database and a dedicated Worker were created on the existing free plan. Its public route was left disabled until the private keys can be configured and verified. Do not assume a live receiving endpoint exists, and do not try to use an example URL.

## Pairing/session details

Baileys stores long-lived Signal session keys. This prototype uses its built-in `useMultiFileAuthState` for **local development only** because the project maintainers discourage it for production. The default session directory is `~/.local/share/meta-master-baileys`; process file-creation mask is restricted and the directory is chmod 0700. Treat these credentials like private SSH keys. The linked-device QR code is displayed only when the operator explicitly enables pairing.

The local observer now has a durable encrypted inbound event spool and bounded retries, but a future production-grade bridge still requires a reviewed Signal auth-state store, reconciliation after long outages, authorised reply handling, privacy/retention controls and full real-device tests. At-least-once delivery is **not guaranteed** across a complete system crash or messages older than the one-hour ingress window.

## Why no unrestricted automation

This first slice is intentionally missing: customer-facing reply sends, group chats, arbitrary browsing, AI-generated messages, stock/pricing claims, regulated-goods sales, scheduled campaigns, or an automatic mode toggle. The rest of our WhatsApp agent roadmap, including OpenAI Responses and SHIORI human-review integration, is tracked in [WhatsApp roadmap](whatsapp-agent-roadmap.md).

## Verification

PR CI tests the HMAC wire protocol, missing/incomplete credentials, incorrect signature and timestamp, contact filtering, encrypted database storage, replay-idempotency, and both Worker dry-run bundles. A separate child-package build checks the actual Baileys v7 imports and Node compatibility, but **no test pairs a real WhatsApp account**.

## Sources

- Official Baileys repository: https://github.com/WhiskeySockets/Baileys
- Current auth storage guidance: https://github.com/WhiskeySockets/docs/blob/main/authentication/session-management.mdx
- Current quickstart: https://github.com/WhiskeySockets/docs/blob/main/quickstart.mdx
- WhatsApp Messenger terms: https://www.whatsapp.com/legal/terms-of-service

## Local encrypted observation spool (W0g)

An allowlisted `notify` message is now written first to an AES-256-GCM-encrypted local queue (outside Git) and fsynced before any signed HTTP forwarding. Files are named with a private keyed digest of the sender/chat and message ID, never a plaintext WhatsApp number or message. Delivery is retried every 15 seconds while the bridge remains running, and a restart can replay records encrypted under the **same** `BAILEYS_SPOOL_KEY`. Only successful HTTP 200 acknowledgment removes the file. HTTP errors keep the record.

An event more than one hour old is **not automatically retried to the current Worker**, because the Worker deliberately rejects stale event timestamps. Instead it remains encrypted on disk and is reported for manual review. The queue is bounded to 1000 events. This prevents silent loss but is **not** a complete production dead-letter/retention solution; manual quarantine, user-visible review and privacy deletion are still on the roadmap.

The spool requires a THIRD independent 32-byte random secret, `BAILEYS_SPOOL_KEY`. Do not reuse `WHATSAPP_DATA_KEY` or `BAILEYS_BRIDGE_HMAC_KEY`. The updated private generator emits all three into `.private/whatsapp-staging.env` on a new installation. If you already generated that file, **do not overwrite the existing Worker keys**: separately create a new `BAILEYS_SPOOL_KEY` using `openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\\n'` and store it privately on your laptop. Losing this third key makes pending encrypted messages unreadable. The runtime refuses to connect if the spool key is invalid or the queue directory has group/other permissions.

The default spool directory is `~/.local/share/meta-master-baileys-spool`. Only explicitly allowlisted chats enter the spool, and WhatsApp pairing continues to require independent opt-in. This local spool deliberately remains off-container until a reviewed Cloudflare session/auth storage adapter is available.

The current queue needs further hardening before any high-volume or business-critical deployment: single-process locking, manual stale-entry quarantine UI, race-free concurrent deduplication across processes, and privacy retention/erasure. It is a safety improvement for the local prototype, **not** a guarantee of zero lost events.


## HP OMEN offline operator checks (W0h)

After updating the repository, test the runtime and run the new offline diagnostics. These commands do not pair WhatsApp or send a WhatsApp message; `npm ci` may contact the npm registry to install dependencies:

```bash
cd ~/meta-master-worker-mcp
git pull --ff-only
cd apps/baileys-bridge
npm ci
npm test
npm run doctor
npm run selftest
```

Node does **not** automatically load local environment files. If you have a private `.env.local` already in this folder, run the doctor with it explicitly:

```bash
node --env-file=.env.local dist/doctor.js
```

The doctor reports whether the bridge is enabled, whether pairing is permitted, the *number* of allowlisted individual chats (never their numbers), whether the HMAC endpoint and local AES key are configured, whether a paired session exists, lock status, and aggregate encrypted spool counts (pending / stale / damaged). It does **not** print any messages, chat identifiers or secret key values, and makes no network requests.

Baileys now acquires an exclusive local lock inside the Signal session directory before opening a socket. A second process using that directory fails rather than corrupting credentials. SIGINT/SIGTERM stops the retry timer, waits for pending observation and credentials writes, and releases the lock. If the host crashes without a graceful shutdown, the lock may stay on disk. This is an intentional fail-closed behaviour.

If the offline doctor reports `session_lock: "stale"`, first check that no Baileys process is active, and then explicitly recover the stale lock:

```bash
node --env-file=.env.local dist/doctor.js --clear-stale-lock --confirm-session-not-running
```

Recovery refuses an active or unknown lock. Do **not** delete session credentials to solve a lock warning.

Encrypted spool writes now use an atomic link rather than a replaceable rename: a concurrent enqueue cannot overwrite an already-existing queued event. A read-only inspection detects stale/damaged queue entries without decrypting or displaying their content. Damaged records are retained; recovery and retention/erasure tools remain future work.

**Limitations:** This is still a local development observer, not an AI replying to customers. There are no automatic replies, no text-generation service, no WhatsApp send function and no pairing without the operator explicitly enabling it. Baileys is unofficial and may lead to account restrictions; evaluate with a non-essential test account first.

The `npm run selftest` command is an entirely offline, synthetic end-to-end rehearsal. It filters a fabricated allowlisted message, saves it in a temporary AES-GCM-encrypted queue, deliberately simulates an HTTP 503 failure, verifies that the message is retained, and then simulates HTTP 200 delivery while independently checking the HMAC signature. The temporary queue is removed and neither WhatsApp nor Cloudflare is contacted.

## Signed replay acceptance — synthetic only

After the HP OMEN has successfully sent the first synthetic live event and the staging Worker has its own private keys configured, run a dedicated idempotency test:

```sh
cd ~/meta-master-worker-mcp
git pull --ff-only
cd apps/baileys-bridge
npm ci
npm test
# Safe default: makes no network requests.
npm run replay-smoke
# Explicitly opt into three HTTPS requests containing only fabricated test data:
BAILEYS_REPLAY_SMOKE_SEND=true node --env-file=.env.local dist/replay-smoke.js
```

The opt-in command requires the **exact** `meta-master-whatsapp-gateway-staging.cryogenized.workers.dev` HTTPS hostname and private bridge credentials already stored locally. It creates one fake message with a random message ID, posts a correctly signed envelope, replays **identical raw bytes and nonce**, then re-signs a **different synthetic body using the same nonce**. The expected HTTP statuses are **200, 200, 409**, respectively. Only one new event should appear in encrypted D1 despite three requests. A mismatch fails the command. Nothing touches WhatsApp, contacts, real messages or the agent's OFF mode. Do not paste private keys or `.env.local` into tickets or chat.

This acceptance check is distinct from the Node unit tests: it exercises live Cloudflare's replay receipt transaction and idempotence. It intentionally does not enable WhatsApp pairing.
