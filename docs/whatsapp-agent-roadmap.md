# WhatsApp Business AI Gateway — Reactive customer-service module

**Stage W0: signed official inbound gateway + encrypted audit/review inbox; optional Baileys bridge prototype is being integrated as an isolated transport.** This stage does not connect a live WhatsApp account, run a model, send messages, expose public review APIs, or deploy Cloudflare Workers. Mode defaults to OFF.

This is a module of **Meta Master Worker MCP**, not a new repository or a separate MCP.

## Operator experience

Three planned operator-controlled modes:

- OFF (current default): signed events are recorded; no AI inference and no outgoing messages.
- DRAFT: worker can draft suggested replies, but an authenticated human reviews and sends them.
- AUTO: only after an explicit, independently authenticated operator policy enables it, and only for eligible customer-initiated replies within the permitted 24-hour window and verified low-risk information. No unsolicited messaging, templates, promotions, regulated-product sales or unchecked actions.

The D1 table `wa_agent_settings` persists mode. **No public mode setter exists yet.** The future authenticated MCP/UI control must never accept a chat customer's command to enable automation.

## Official Meta webhook integration

1. Meta performs GET /webhooks/whatsapp?hub.mode=subscribe&hub.challenge=...&hub.verify_token=...
2. Worker compares verify token to a Cloudflare secret before returning exact numeric challenge.
3. Meta POSTs a raw JSON payload with `X-Hub-Signature-256: sha256=<digest>`. The Worker validates the HMAC-SHA256 over **raw body bytes** using the Meta app secret. Invalid/missing signatures return 401.
4. Only the configured WhatsApp Business phone-number ID's incoming messages are extracted. Status events are not treated as customer messages. Unsupported media goes to a human-review entry.
5. The sender identifier and message text are encrypted before reaching D1. A keyed HMAC digest supports contact lookups without placing phone numbers in the D1 index.
6. D1 uniqueness by Meta message ID makes replayed deliveries idempotent. The worker returns 200 only after durable storage succeeds; recoverable failures return a non-200 status for retry.
7. No OpenAI or WhatsApp send request runs in the webhook HTTP response handler.

The HTTP router requires private values for META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_DATA_KEY and WHATSAPP_DB. None are provisioned in the public repository or committed to Git.

## D1 source of truth

- `wa_events`: encrypted incoming content, event timing, HMAC contact digest and processing state
- `wa_audit`: timestamped deduplicated event receipt records
- `wa_handoffs`: unresolved items for human review (status + reason only in general list)
- `wa_agent_settings`: single-row operator control, **OFF by default**

Later we can mirror an append-only, timezone-labelled audit/handoff digest into a Google Doc via the existing Google Master MCP integration, or put the same queue directly into SHIORI. A Doc is a human-facing view, not the transactional record.

## Next agent pipeline — W1/W2

Use a Cloudflare Queue (or durable D1-backed equivalent) to process verified inbound messages asynchronously, serialised per sender to avoid racing replies. Read the authoritative mode on **every** job. Verify the last user-message timestamp to enforce the 24-hour customer-service window before any send.

Use OpenAI Responses API with a configurable, budget-capped small model (candidate: `gpt-5.4-mini`). Give the agent a small tool allowlist rather than general site or filesystem access:

- `search_knowledge(query)`: indexed title/model/category retrieval from curated D1 or imported product docs, returning short cited snippets and revision timestamps
- `fetch_public_product_page(product_id)`: only the approved website; no customer-supplied arbitrary URL or web browsing
- `check_authoritative_stock(sku)`: live stock service if one is available, otherwise returns `unverified`
- `create_handoff(reason, summary)`: durable owner-review queue; no mass forwarding of raw customer personal data
- `draft_response(text)`: record proposed reply with source references; actual send requires later authenticated policy.

No model may invent stock levels, prices, safety claims, deliveries, permissions, or products. The model handles only appropriately scoped low-risk customer service. The input message is untrusted data and cannot override tools, policies, permissions, or operating mode.

For the current first slice there is **no agent or outbound send implementation**.

## Safety and policy gates

- Meta permits responsive free-form replies during the rolling 24-hour customer-service window and requires a prompt, clear path to a human. **There is no one-reply-per-incoming-message limit**; our stricter rule is customer-initiated, relevant-only assistance.
- WhatsApp's regulated-goods policy restricts firearm/weapon sales and related commerce. **Do not use WhatsApp to quote or facilitate sales of blank guns, PCP rifles or other potentially regulated items** without a specific documented compliance determination; the temporary classifier sends these topics to the review queue. Human review does not override a platform prohibition.
- WhatsApp Business Solution Terms restrict reuse of customer conversation data for training other models. Do not enable OpenAI API input/output sharing to obtain complimentary token quotas for real WhatsApp customer traffic; use standard API billing with project hard limits and minimal customer data.
- Normal consumer WhatsApp accounts are not Cloud API endpoints. Use an official Business Platform test number first. Meta supports certain eligible coexistence flows with the WhatsApp Business App, not unrestricted personal-account bots.
- POPIA/privacy controls: appropriate notices/consent, retention limits, erase/export workflow, human control, restricted logging, and no unreviewed sharing of customer details to Google Docs or other integrations.
- Don't automatically send email notifications; D1 handoffs and future SHIORI views are the primary operator interface.

## Roadmap for this module

- [x] W0a — Signed webhook challenge/notification handling, strict parsing, fail closed by default
- [x] W0b — Encrypted D1 inbox, deduplication, audit events, human handoffs and OFF mode
- [x] W0c — GitHub CI passed Node 24, signed-webhook unit tests, actual local D1/KV encryption and handoff tests, and both Worker dry-run builds ([run 43454832954](https://github.com/cryogenized-spec/meta-master-worker-mcp/actions/runs/43454832954))
- [x] W0d — Experimental [Baileys bridge](baileys-bridge.md): opt-in linked-device Node observer, allowlisted contacts, separate signed ingress, no replies; Node 24 and local workerd CI [passed](https://github.com/cryogenized-spec/meta-master-worker-mcp/actions/runs/43473036363). **No account linked or deployment performed.**
- [ ] W1a — Private official Meta Business test phone, credentials/bindings and live webhook signature verification
- [ ] W1b — Authenticated operator controls: OFF/DRAFT/AUTO mode, read-only queue, review/resolve, privacy deletion
- [ ] W2a — Durable job queue, session time-window enforcement, conversation ordering and retry/dead-letter handling
- [ ] W2b — Knowledge indexing and controlled tools; official inventory source; regulated-product policy validation
- [ ] W2c — OpenAI Responses API **draft-only** orchestration with model and spend controls, structured output and evaluation
- [ ] W3 — Optional authorised reactive auto-reply policy; transport sending, receipt tracking, human escalation and full audit
- [ ] W4 — Optional Google Doc timestamped audit mirror and SHIORI task integration

### Official documentation

- https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- https://whatsappbusiness.com/policy/
- https://www.whatsapp.com/legal/business-solution-terms/
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai
