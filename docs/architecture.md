# Architecture sketch (M0)

**Current implementation:** a stateless Cloudflare Worker with `GET /health` and a disabled `/mcp` route. No OAuth, Meta API calls, D1, KV, R2 or MCP protocol handling is active.

**Target:** one authenticated Worker route exposing modular, least-privilege MCP tools. The initial Meta integration is Facebook Pages only. The service is built for a single operator first, without embedding that operator's identifiers or credentials.

## Intended components

1. **Transport:** authenticated Streamable HTTP MCP endpoint using the official TypeScript MCP SDK and a verified Cloudflare-compatible adapter. Choose and pin tested package versions before enabling the endpoint.
2. **Authorisation:** two separately enforced trust relationships: MCP client -> Worker, and Worker -> Meta. Validate MCP caller, session, account and target resource on every operation. Separate read and write capabilities.
3. **Meta connection:** OAuth `state` with short expiry and single use, redirect URI validation, least-privilege scopes; encrypt token data at rest, support revocation and expiration.
4. **Module registry:** Facebook Pages, Instagram, Threads, Messenger, WhatsApp Business and Ads are independently enabled by configuration and granted scopes.
5. **Storage:** evaluate Cloudflare D1 for encrypted connection metadata and audit records, KV for noncritical cache and R2 for temporary media staging. D1 (not eventually consistent KV) is the authoritative store for single-use OAuth state, replay protection and approvals. No bindings are provisioned in M0.
6. **API client:** narrowly allowlisted Meta Graph API operations, rate-limit awareness, bounded retries and structured redacted errors.
7. **Approval engine:** bind each pending write to an authenticated actor, target, action, content digest and expiration; prevent duplicate execution.
8. **CLI:** share API services with MCP; never bypass server-side permissions.

## Design constraints

- A public repository does **not** imply a publicly callable authenticated API.
- Do not accept arbitrary Graph URLs or caller-provided bearer tokens as an unrestricted proxy.
- Personal-profile features are not an assumption of the Graph API.
- Do not enable advertising writes in early milestones.
- Every supported tool must document its required permissions and whether it has been tested live.
- Production deployment remains a separate, explicitly authorised operation.

Official reference: https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/

See [technology stack](tech-stack.md) and [milestone dependency roadmap](roadmap.md) for verified versus planned components.
