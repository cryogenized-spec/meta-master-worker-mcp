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

**No Cloudflare resources or secrets have been provisioned.** Do not try to use an example URL; there is no public Worker endpoint yet.

## Pairing/session details

Baileys stores long-lived Signal session keys. This prototype uses its built-in `useMultiFileAuthState` for **local development only** because the project maintainers discourage it for production. The default session directory is `~/.local/share/meta-master-baileys`; process file-creation mask is restricted and the directory is chmod 0700. Treat these credentials like private SSH keys. The linked-device QR code is displayed only when the operator explicitly enables pairing.

A future production-grade bridge will need a robust encrypted auth-state store, a local durable outgoing-event spool, crash recovery, reconciliation after network interruption, user-controlled disconnect/pause, and privacy/retention controls. The current observer has a bounded reconnect policy but **does not guarantee at-least-once message delivery** if the local-to-Cloudflare hop fails. Do not use for customer service before those are implemented.

## Why no unrestricted automation

This first slice is intentionally missing: customer-facing reply sends, group chats, arbitrary browsing, AI-generated messages, stock/pricing claims, regulated-goods sales, scheduled campaigns, or an automatic mode toggle. The rest of our WhatsApp agent roadmap, including OpenAI Responses and SHIORI human-review integration, is tracked in [WhatsApp roadmap](whatsapp-agent-roadmap.md).

## Verification

PR CI tests the HMAC wire protocol, missing/incomplete credentials, incorrect signature and timestamp, contact filtering, encrypted database storage, replay-idempotency, and both Worker dry-run bundles. A separate child-package build checks the actual Baileys v7 imports and Node compatibility, but **no test pairs a real WhatsApp account**.

## Sources

- Official Baileys repository: https://github.com/WhiskeySockets/Baileys
- Current auth storage guidance: https://github.com/WhiskeySockets/docs/blob/main/authentication/session-management.mdx
- Current quickstart: https://github.com/WhiskeySockets/docs/blob/main/quickstart.mdx
- WhatsApp Messenger terms: https://www.whatsapp.com/legal/terms-of-service
