# M0 threat model

Version: 2026-11-12. This is the baseline for the public repository, not a certification or an indication that Meta OAuth is working.

## Assets and trust boundaries

Protected assets: operator identity, OAuth tokens, Meta account/Page permissions, customer conversations, drafts, publishing approval records, advertising spend, temporary media, audit trail.

Trust boundaries:
1. Internet MCP client -> resource Worker.
2. MCP resource Worker -> authentication Worker via Cloudflare service binding.
3. Operator -> Meta authorisation page -> OAuth callback.
4. MCP application -> Meta Graph API.
5. Worker -> encrypted D1 records, OAuth provider KV and (later) R2 storage.
6. GitHub public code/CI -> runtime secrets and deployment credentials (must never cross).

## Top threats and required mitigations

| Threat | Risk | Required mitigation | Verification gate |
|---|---|---|---|
| Anonymous tool invocation | Critical | Resource-bound client authentication; deny all tools until enabled | M0 503 tests; M1 unauthenticated tests |
| Forged/faked model approval | Critical | Server-side authenticated approval tied to exact payload and target | M3 mismatch, expiration and replay tests |
| Token leak into GitHub or logs | Critical | Ignore env files; private encrypted token store; safe log event allowlist; no raw provider errors | M0 ignore checks and safe-error tests |
| Cross-Page/account access | High | Check actor, connected account, granted scopes and Page task for every operation | M1/M2 foreign asset tests |
| OAuth redirect CSRF or code reuse | High | Standard OAuth library with PKCE/state/redirect verification | M1 OAuth callback contract tests |
| Reused approval after successful publish | High | D1 atomic one-time consume, idempotency keys and bounded retry policy | M3 repeated request tests |
| Arbitrary Graph request / SSRF | High | Fixed Meta API origin, endpoint allowlist, forbid caller-supplied target URLs | M1 input validation tests |
| Webhook spoofing and replay | High | Meta signature verification over raw body, event deduplication | M5 webhook tests |
| Public workflow exposing secrets | High | CI read-only token, no production secrets and no deployment from PRs | M0 workflow review |
| Overbroad scopes or unexpected ads spend | High | Read-only first, explicit scope review and separate advertising spend approval | M4/M5 review |

## What exists today

- Only GET /health is available as a service route; /mcp returns 503 for every HTTP method. All OAuth and Meta routes return 404.
- No Meta account credentials, access tokens, OAuth services, webhook endpoints or D1 bindings are configured.
- HTTP responses are fixed and never echo incoming query, headers or request bodies.
- A safe structured event type and public error mapper are included, with no freeform request logging.

## Outstanding security work before enabling MCP

- Add runtime authentication using Cloudflare Workers OAuth Provider v1 split API and full expiry/revocation tests.
- Test audience/resource validation and apply read/write scope checks per tool.
- Define trusted operator sign-in and approval UI. Never trust LLM-generated approval claims.
- Implement encryption, D1 migrations, credential rotation and reconnect.
- Review CORS, host/origin validation, output filtering, session handling, rate limits and Graph API responses.
- Conduct live verification against only authorised test assets after explicit consent.

Security disclosure: do not report actual secrets in public issues. Rotate exposed credentials immediately.
