-- Schema groundwork only. No D1 binding or live token writes are active.
-- Store ONLY AES-GCM ciphertext; plaintext Meta tokens must never be persisted.
CREATE TABLE IF NOT EXISTS meta_connections (
  connection_id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (
    platform IN ('facebook', 'instagram', 'threads', 'messenger', 'whatsapp', 'ads')
  ),
  external_account_id TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  granted_scopes_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(operator_id, platform, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_connections_operator
  ON meta_connections (operator_id, platform);

-- Operator-scoped audit metadata. Never store token values in this table.
CREATE TABLE IF NOT EXISTS connection_audit (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('connected', 'refreshed', 'disconnected', 'revoked', 'failed')
  ),
  occurred_at INTEGER NOT NULL
);
