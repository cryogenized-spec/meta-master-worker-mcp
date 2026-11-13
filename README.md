# Meta Master Worker MCP

A modular, Cloudflare-native Model Context Protocol server for authorised Meta business and social-platform workflows.

> **Status: M1.2d — local workerd OAuth/D1 integration tests passing; live GitHub/Cloudflare OAuth and Meta account onboarding still pending.** No Meta account connection, OAuth flow, publishing, messaging or advertising features are implemented. The `/mcp` endpoint is still unavailable by default; the authenticated handler only activates with a configured OAuth authorization service binding.

## Goals

- Personal-first deployment, with a path to community self-hosting.
- Independently enabled modules for Facebook Pages, Instagram, Threads, Messenger, WhatsApp Business and Meta Ads.
- Explicit human approval before content publishing, messaging, deletion, or advertising changes.
- Keep Meta tokens encrypted and server-side; never commit credentials or log them.
- Cloudflare Workers hosting with well-scoped configuration and no deployment from pull requests.
- Fewer, reliable, well-documented tools rather than inflated tool counts.

## Getting started (M0)

Requires Node.js 24+ and npm.

```sh
npm ci
npm run check
npm run dev
```

Local endpoints: `GET /health` reports M1 staging; `/mcp` returns HTTP 503 until the independent OAuth auth service is configured. No Cloudflare account or Meta credentials are needed to run tests.

## Roadmap and decisions

- [Milestone roadmap and dependency chart](docs/roadmap.md)
- [M0 successful GitHub-hosted validation](docs/m0-verification.md)
- [MCP/Meta OAuth design](docs/auth-design.md)
- [M1 transport implementation and remaining work](docs/m1.md)
- [M1 verified CI run](docs/m1-validation.md)
- [M1.2a authorisation Worker and token-vault groundwork](docs/m1-2a.md)
- [M1.2a CI verification](docs/m1-2a-validation.md)
- [M1.2b GitHub operator login, read-only consent and pending deployment gates](docs/m1-2b.md)
- [M1.2c encrypted D1 credential adapter and test limitations](docs/m1-2c.md)
- [M1.2d local OAuth and D1 integration results](docs/m1-2d.md)
- [Threat model](docs/threat-model.md)
- [Verified and planned technology stack](docs/tech-stack.md)
- [Architecture](docs/architecture.md)
- [Security rules](docs/security.md)
- [Competitor references](docs/competitors.md)
- [Agent development guidelines](AGENTS.md)

**Deployment is manual and disabled by default.** This repository is public; GitHub Actions runs validation only. Never put secrets in issues, source code, workflows, logs or committed environment files.

## Project status

This is an independent project, not affiliated with or endorsed by Meta. API availability depends on Meta's current permissions, account eligibility, review requirements and platform terms.

License: **not yet selected**. Do not assume permission to redistribute third-party competitors' code; review licenses before incorporation.
