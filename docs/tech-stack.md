# Technology stack and architecture decisions

> Updated 2026-11-12. **Implemented** means present in the repository; **selected** means planned but not installed; **candidate** means still subject to evaluation.

## Current, implemented code stack

| Layer | Technology | Status | Evidence |
|---|---|---|---|
| Backend | TypeScript ES modules on Cloudflare Workers | Implemented skeleton | `src/index.ts`, `wrangler.jsonc` |
| Toolchain | Node.js >=24, npm | Configured | `package.json` and CI workflow |
| Language | TypeScript ^5.9.3 | Configured; locked by package-lock.json | `package.json`, `tsconfig.json` |
| Cloudflare CLI | Wrangler ^4.0.0 | Configured; not deployed | `package.json`, `wrangler.jsonc` |
| Tests | Vitest ^4.0.0 | Test suite passed on GitHub Node 24 | `tests/worker.test.ts` |
| CI | GitHub Actions, Node 24 | Node 24 verified; main CI uses npm ci | `.github/workflows/ci.yml` |
| Protocol | MCP SDK v2 via conditional OAuthResourceServer; unconfigured `/mcp` 503 | Implemented staging | `src/mcp/` |

A committed npm lockfile enables reproducible `npm ci` installs. See [M0 GitHub-hosted verification](m0-verification.md). MCP transport and OAuth resource-server code now bundle and pass unit tests. The separate authorization server, Meta API integration, OAuth login, D1, KV, R2, encryption, deployed endpoints and real platform tools do not exist yet.

## Selected for upcoming milestones

- **MCP protocol:** MCP SDK v2.3.1, `agents` v0.31.0 stateless Streamable HTTP handler. The bundle is verified; live client interoperability remains untested.
- **MCP client authorization:** Cloudflare Workers OAuth Provider v1.2.4 split architecture; resource half coded, authorization half pending. Separate authorization of a ChatGPT/Claude client from authorization to use a Meta account.
- **Meta integration:** version-pinned Meta Graph API over native `fetch`, with granular permission checks. Account eligibility, endpoint permissions and API deprecations must be validated against current primary documentation.
- **Database:** Cloudflare D1 for durable connection metadata, encrypted token payloads, pending approvals and audit events.
- **Cryptography:** Workers Web Crypto. Encryption keys remain Cloudflare secrets, never D1, KV or GitHub.
- **Validation:** Zod 4 installed; schema and input constraints to be introduced with real tools.
- **Media:** Cloudflare R2 for bounded temporary uploads only when publishing workflows need it.
- **Cache:** Cloudflare KV for noncritical cache/config only. **The official Workers OAuth Provider manages OAuth internals in its supported KV storage.** Do not invent separate OAuth state logic; use transactional D1 for our custom one-time approvals and application replay protection.
- **Local tests:** Vitest unit tests, mocked Meta API contract tests and Worker integration tests. Live permission tests occur only against assets controlled by the operator.
- **CLI:** a Node.js TypeScript entry point sharing the same service layer and security decisions as the MCP transport.

## Possible later UI

Prefer plain server-rendered pages for initial OAuth administration. A React + Vite dashboard can be added in a separate `apps/admin` package if its complexity is justified. React, Vite, Hono, ORMs, queues and Durable Objects are **not** part of the current stack and should not be introduced by default.

## Deliberate exclusions

- No Python, Rust, VPS or always-on Node server required for the initial product.
- No scraping, personal-profile posting hacks or deprecated Facebook Groups API dependencies.
- No unrestricted Graph proxy or arbitrary endpoint URL supplied by an MCP client.
- No production deployment from pull-request workflows; no secrets in Git.
- No automatic high-risk writes (posts, messages, deletions or ad-spend changes) based only on model-supplied confirmation flags.

## Suggested logical modules

```text
src/
  index.ts                  # Cloudflare Worker entrypoint
  auth/                     # MCP client auth; Meta OAuth; permission checks
  core/                     # transport, tool registry, validation, errors
  meta/                     # versioned Meta API client, token handling
  modules/
    facebook-pages/         # first platform module
    instagram/              # optional
    threads/                # optional
    messenger/              # optional
    whatsapp/               # optional
    ads/                    # optional
  approval/                 # draft review, signatures, idempotency and audit
  storage/                  # D1 / KV / R2 ports and adapters
apps/
  cli/                      # future CLI; optional
  admin/                    # future minimal UI or Vite/React dashboard
tests/
```

This tree is a design target, **not** a representation of current files.

## Authoritative references

- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- https://developers.cloudflare.com/agents/model-context-protocol/
- https://ts.sdk.modelcontextprotocol.io/
- https://developers.facebook.com/docs/graph-api/
- https://developers.cloudflare.com/workers/configuration/environment-variables/
