# Roadmap

These are intended milestones, not claims of implemented features.

## M0 — Foundations (current)
- [x] Public repository and README
- [x] Worker skeleton and CI checks
- [x] Security and architecture policies
- [ ] Dependency lockfile and successful CI run
- [ ] Threat-model review and chosen authentication protocol
- [ ] Contract tests for authentication failures

## M1 — Read-only Facebook Pages
- [ ] Meta app and redirect URI configuration with least-privilege access
- [ ] Secure OAuth onboarding, encrypted account tokens, revocation and rotation
- [ ] Authenticated Streamable HTTP MCP endpoint
- [ ] Discover connected Pages, verify permission scope and resource ownership
- [ ] Read Page metadata, posts and available insights
- [ ] Live tests against an authorised Page and granular error handling

## M2 — Controlled publishing
- [ ] Upload/stage media and check publish eligibility
- [ ] Draft + preview + server-side approval token scoped to exact payload and target
- [ ] Create/schedule posts, idempotency keys and audit log
- [ ] Cancellation, retry safety and confirmation of actual published state

## M3 — Instagram & Threads
- [ ] Separate account discovery, entitlement and permission checks
- [ ] Eligible read operations and approved content actions
- [ ] Platform-specific API version compatibility tests

## M4 — Optional modules
- [ ] Messenger
- [ ] WhatsApp Business
- [ ] Meta Ads (read-only first; ad-spend actions require stronger policy)
- [ ] Webhook verification and processing

## M5 — Public self-hosting release
- [ ] Migration and backup documentation
- [ ] Secure first-run setup, comprehensive permission diagnostics
- [ ] CI integration, dependency and licence audit, contributor guide
- [ ] Versioned releases and deployment documentation
