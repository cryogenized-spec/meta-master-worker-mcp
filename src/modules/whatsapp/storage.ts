import { encryptMetaToken } from "../../storage/token-crypto";
import type { InboundWhatsAppMessage, WhatsAppWebhookEnv } from "./webhook";
import { reviewReason } from "./review-policy";

/**
 * Persist *only* authenticated webhook events. The gateway calls this AFTER
 * verifying X-Hub-Signature-256. No AI, outbound send or notification occurs.
 */
function configured(env: WhatsAppWebhookEnv): {
  db: D1Database; key: string;
} {
  if (!env.WHATSAPP_DB || !env.WHATSAPP_DATA_KEY ||
      typeof env.WHATSAPP_DB.prepare !== "function" ||
      typeof env.WHATSAPP_DB.batch !== "function") {
    throw new Error("whatsapp_storage_not_configured");
  }
  return { db: env.WHATSAPP_DB, key: env.WHATSAPP_DATA_KEY };
}

function base64UrlDecode(raw: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new Error("invalid_whatsapp_data_key");
  const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function contactDigest(secret: string, phoneNumberId: string, from: string): Promise<string> {
  const bytes = base64UrlDecode(secret);
  if (bytes.byteLength !== 32) throw new Error("invalid_whatsapp_data_key");
  const buffer = new ArrayBuffer(32);
  new Uint8Array(buffer).set(bytes);
  const key = await crypto.subtle.importKey("raw", buffer,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode("wa-contact-v1:" + phoneNumberId + ":" + from)));
  return Array.from(hash, value => value.toString(16).padStart(2, "0")).join("");
}

export async function storeWhatsAppEvents(
  messages: InboundWhatsAppMessage[],
  env: WhatsAppWebhookEnv,
): Promise<void> {
  if (messages.length === 0) return; // Delivery statuses require no write.
  const { db, key } = configured(env);
  if (messages.length > 80) throw new Error("whatsapp_event_batch_too_large");
  const receivedAt = Math.floor(Date.now() / 1000);
  const queries: D1PreparedStatement[] = [];

  for (const message of messages) {
    // The sender, text and event timestamp are entirely inside AES-GCM
    // ciphertext. Only a keyed contact digest and message ID stay indexable.
    const encrypted = await encryptMetaToken(
      JSON.stringify({
        from: message.from,
        body: message.text,
        timestamp: message.timestamp,
        type: message.type,
      }),
      key,
      {
        operatorId: "wa-number:" + message.phoneNumberId,
        connectionId: message.id,
        platform: "whatsapp",
      },
    );
    const digest = await contactDigest(key, message.phoneNumberId, message.from);
    const reason = reviewReason(message.type, message.text);
    const state = reason === null ? "received" : "needs_human";

    queries.push(db.prepare(
      "INSERT OR IGNORE INTO wa_events (message_id,phone_number_id,contact_digest,event_ciphertext,event_type,event_ts,received_at,state) VALUES (?,?,?,?,?,?,?,?)",
    ).bind(message.id, message.phoneNumberId, digest, encrypted,
      message.type, message.timestamp, receivedAt, state));

    queries.push(db.prepare(
      "INSERT OR IGNORE INTO wa_audit (audit_key,message_id,action,recorded_at) VALUES (?,?,?,?)",
    ).bind(message.id + ":received", message.id, "received", receivedAt));

    if (reason !== null) {
      queries.push(db.prepare(
        "INSERT OR IGNORE INTO wa_handoffs (message_id,reason,status,created_at) VALUES (?,?,'open',?)",
      ).bind(message.id, reason, receivedAt));
    }
  }
  // Transactional D1 batch. A webhook is acknowledged only once durable
  // storage succeeds. Replayed IDs are harmless due to UNIQUE keys.
  await db.batch(queries);
}

export interface WhatsAppReviewSummary {
  messageId: string;
  messageType: "text" | "unsupported";
  status: string;
  receivedAt: number;
  reason: string;
}

export async function listOpenWhatsAppHandoffs(
  db: D1Database,
  limit = 25,
): Promise<WhatsAppReviewSummary[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("invalid_handoff_limit");
  }
  const results = await db.prepare(
    "SELECT h.message_id AS messageId, e.event_type AS messageType, h.status, h.created_at AS receivedAt, h.reason FROM wa_handoffs h INNER JOIN wa_events e ON h.message_id=e.message_id WHERE h.status='open' ORDER BY h.created_at DESC LIMIT ?",
  ).bind(limit).all<WhatsAppReviewSummary>();
  // Never include sender identifiers or decrypted customer messages in
  // the general audit summary. Detail access needs operator OAuth later.
  return results.results;
}

/** Observation only; there is NO unauthenticated control API. */
export async function whatsappAgentMode(
  db: D1Database,
): Promise<"off" | "draft" | "auto"> {
  const row = await db.prepare(
    "SELECT mode FROM wa_agent_settings WHERE id=1",
  ).first<{ mode: string }>();
  return row?.mode === "draft" || row?.mode === "auto" ? row.mode : "off";
}
