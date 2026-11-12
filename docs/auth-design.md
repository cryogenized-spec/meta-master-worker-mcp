# M0 authentication architecture decision

Decision date: 2026-11-12. **Design record only. No OAuth endpoint or connected account has been deployed.**

## Decision: split client auth from the MCP resource server

Adopt the recommended Cloudflare Workers OAuth Provider **v1 split architecture** for M1:

```text
MCP client (ChatGPT/Claude)
   | OAuth 2.1, resource-bound access token
   v
meta-master-mcp (Resource Worker, /mcp)
   | token validation over service binding
   v
meta-master-auth (Auth Worker)
   | operator sign-in + explicit client consent
   v
operator identity

Meta API grants are entirely separate:
meta-master-mcp --> stored, scoped Meta connection --> Meta Graph API
```

The auth Worker will run `OAuthAuthorizationServer`; the MCP Worker will use `OAuthResourceServer` around an SDK-provided Streamable HTTP `createMcpHandler`. Both Worker's public addresses and service binding names will be configured by the operator, not hardcoded to a particular user's account. The `/mcp` resource remains disabled in M0.

Official references:
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/
- https://developers.cloudflare.com/changelog/post/2026-10-01-workers-oauth-provider-1x/

## Two distinct trust relationships

1. **MCP client -> server.** Identify the operator, issue limited MCP tokens, bind them to the intended protected resource, verify before each tool call; separate `mcp:read` and `mcp:write`.
2. **Our server -> Meta.** Link accounts via Meta's applicable OAuth flow, inspect granted permissions and Page tasks, store provider token encrypted, verify target asset entitlement at execution time.

A valid MCP client access token does not by itself authorise Meta account access. A valid Meta token does not authorise an arbitrary MCP client.

## Intended persistent storage

- **OAuth provider internals:** Use the officially supported Cloudflare Workers OAuth Provider KV storage, including its built-in hashing/encryption/PKCE safeguards. Do not reinvent its token issuance, code lifecycle or authorisation state semantics.
- **Application D1:** Store account connection metadata, ciphertext of Meta tokens, explicit permissions, Page relationships, transactionally consumed single-use approvals, operation IDs and audit records.
- **KV outside OAuth provider:** Only for best-effort cache and expendable configuration. Never make a custom one-time approval depend on eventually consistent KV.
- **R2:** Not provisioned until media publishing requires it.

Provider token encryption keys will live in Cloudflare Worker secrets (Web Crypto); plaintext Meta credentials will not appear in public logs, issues, errors or client output.

## Permissions, redirect and consent

- Test with operator-controlled developer assets and minimum applicable Meta scopes; document each tool's scope and eligible asset requirements.
- Verify redirect URIs and CSRF/PKCE with the established OAuth provider; fail closed on missing or mismatched grants.
- Restrict access to the operator until public onboarding is explicitly designed and approved.
- Revocation/expired token cases must be tested; show a clear reconnect action instead of silently escalating permissions.

## Write approval design

A separate server-side one-use approval record will bind: MCP operator identity + Meta account/Page + operation type + canonical action parameters hash + expiry + idempotency key. Approval must be obtained through an authenticated trusted confirmation channel; a caller-supplied `approved: true` field cannot authorise a write. Use a D1 atomic transaction to consume approval only once. Stronger policy applies to deletion, messages and ad spend.

## M0 vs M1 boundary

M0 only documents and tests the denied-by-default shell. **No auth SDK dependencies are added until an M1 compatibility prototype has been proven and pinned.** Never enable `/mcp` while credentials or authorisation checks are absent.
