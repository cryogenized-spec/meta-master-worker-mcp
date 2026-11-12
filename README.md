# Meta Master Worker MCP

A modular, Cloudflare-native Model Context Protocol server for authorised Meta business and social-platform workflows.

> **Status: M0 foundation complete (pre-alpha); M1 not started.** No Meta account connection, OAuth flow, publishing, messaging or advertising features are implemented. The `/mcp` endpoint is deliberately unavailable until authentication and authorisation controls have been implemented and tested.

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

Local endpoints: `GET /health` returns M0 status; `/mcp` returns HTTP 503 until the authenticated transport is implemented. No Cloudflare account or Meta credentials are needed to run tests.

## Roadmap and decisions

- [Milestone roadmap and dependency chart](docs/roadmap.md)
- [M0 successful GitHub-hosted validation](docs/m0-verification.md)
- [MCP/Meta OAuth design](docs/auth-design.md)
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
