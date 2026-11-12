# Competitor research starting points

This is a **research index**, not an endorsement or a test report. Feature inventories, advertised tool counts and API support can change, and repository README claims must be verified in code and against live, authorised Meta accounts.

| Repository | What to examine |
|---|---|
| https://github.com/open-work-org/open-mcp-servers | Breadth of Meta operations, registry patterns, Graph API escape hatches |
| https://github.com/IvanBBaev/facebook-mcp | Read/write safeguards, preview-before-action, test coverage and maintenance |
| https://github.com/hello-emrah/meta-mcp | Compact Facebook/Instagram/Threads tool structure |
| https://github.com/brijr/meta-mcp | Cloudflare Workers deployment, OAuth, D1/KV storage architecture |
| https://github.com/pipeboard-co/meta-ads-mcp | Ads workflows, licensing restrictions and hosted-service tradeoffs |
| https://github.com/meta/agentic-tools | Meta's own developer-facing MCP and agent skills |

## Due diligence checklist
- [ ] Confirm repository licence and compatible reuse rights.
- [ ] Record latest commit date and maintainers, issues and releases.
- [ ] Compare declared capabilities against implemented routes and actual permission requirements.
- [ ] Separate mocked tests from live integration testing.
- [ ] Identify token storage, caller auth, approver identity and audit logging.
- [ ] Compare tool discovery, error handling, rate limits, retries and reliability.
- [ ] Record current Meta API version and deprecation exposure before adopting code.

We prefer a focused, authenticated, tested toolset rather than inflated counts.
