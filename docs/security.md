# Public-repository security baseline

The project is public from the first commit, but code publication is not a grant to use our accounts or tokens.

## M0 guarantees
- No credential values or provider endpoints are embedded in the Worker.
- No authenticated API functionality is implemented.
- `/mcp` deliberately returns 503 and does not process MCP protocol requests.
- GitHub Actions validates code only; no deploy job and no production permissions.
- `workers_dev` is disabled in Wrangler config.

## Required before any account connection
- Validate the MCP client identity and reject unauthorised requests.
- Check OAuth state single-use, expiration and redirect URI binding.
- Encrypt stored provider tokens; rotate keys and revoke access when requested.
- Request only necessary permissions; independently verify account or Page resource ownership.
- Use structured, redacted logs and bounded network retries.
- Verify webhook signatures against the unmodified body before processing.
- Never copy production tokens into CI, issue descriptions or fixture data.

## Required before a write tool
- Server-side, one-time confirmation bound to actor, target, action and exact payload digest.
- Request idempotency and a durable audit record.
- Higher approval threshold for deletion, outbound messaging and spending money.
- No externally reachable write tool without enforcement tests.

## Local secret workflow
Keep local secrets in ignored `.dev.vars` or `.env` and production values in Cloudflare secrets. They must never appear in `wrangler.jsonc` or tracked files. See https://developers.cloudflare.com/workers/configuration/environment-variables/

## Incident response
If a secret is exposed, revoke/rotate it immediately at Meta or Cloudflare and investigate repository history and logs. Deleting a file alone does not remove an exposed credential from history.
