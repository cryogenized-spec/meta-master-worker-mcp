-- WhatsApp data lives in a separate, narrowly scoped D1 binding.
-- Message body, sender identifier and other customer content are encrypted
-- before entering WhatsApp D1. No customer information belongs in Git logs.
CREATE TABLE IF NOT EXISTS wa_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  phone_number_id TEXT NOT NULL,
  contact_digest TEXT NOT NULL,
  event_ciphertext TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('text','unsupported')),
  event_ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'received'
    CHECK(state IN ('received','needs_human','drafted','handled','ignored'))
);
CREATE INDEX IF NOT EXISTS idx_wa_events_inbox ON wa_events(state, received_at);
CREATE INDEX IF NOT EXISTS idx_wa_events_contact ON wa_events(contact_digest, event_ts);

CREATE TABLE IF NOT EXISTS wa_audit (
  audit_key TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  action TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_handoffs (
  message_id TEXT PRIMARY KEY NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

-- OFF is the ONLY default. Not even draft generation may run until an
-- authenticated operator intentionally changes this state.
CREATE TABLE IF NOT EXISTS wa_agent_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
  mode TEXT NOT NULL DEFAULT 'off' CHECK(mode IN ('off','draft','auto')),
  changed_at INTEGER NOT NULL DEFAULT 0,
  changed_by TEXT
);
INSERT OR IGNORE INTO wa_agent_settings(id, mode) VALUES (1, 'off');
