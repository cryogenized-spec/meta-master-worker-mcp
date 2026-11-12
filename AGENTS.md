# Agent development rules

This repository is public and is currently in M0.

## Work style

- Make small, reviewable changes and include test results.
- Read `docs/architecture.md`, `docs/security.md` and the milestone definition before new features.
- Preserve the explicit draft -> review -> approve -> execute workflow for every external write.
- Do not claim an operation is implemented without a corresponding live API integration test.
- Never deploy to Cloudflare or change Meta app settings without explicit authorisation.
- Do not enable new API scopes by default.
- Keep platform modules optional and typed; minimise exposed MCP tool count.

## Security boundaries

- No Meta access tokens, app secrets, refresh tokens, user content, credentials or sensitive logs in Git.
- Do not print OAuth codes, tokens, signatures, or raw provider error payloads.
- Do not expose any authenticated tool before validating caller identity, connected account, permission and resource ownership.
- Read and write permissions must be separately scoped. Model-provided 'approved=true' is **not** sufficient authorisation.
- Publishing, sending messages, deleting and ad-spend changes need durable server-side approval tied to exact action parameters.
- Never build covert profile automation, credential scraping or permission bypasses.
- No production secrets or deployments in GitHub PR workflows, including forked PRs.

## Verification

- Run `npm run check` and `npm run build`.
- Tests must fail closed when credentials, scopes or approvals are missing.
- Preserve `/mcp` returning 503 until MCP authentication and authorisation are implemented.
- Prefer minimal dependencies; review licences before importing competitor code.
