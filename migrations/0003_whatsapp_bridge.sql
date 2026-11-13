-- Signed, private Baileys bridge replay receipts (separate from Meta Cloud API).
-- This migration requires the existing 0002 WhatsApp inbox schema.
CREATE TABLE IF NOT EXISTS wa_bridge_receipts (
  bridge_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (bridge_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_wa_bridge_receipts_age
  ON wa_bridge_receipts (received_at);
