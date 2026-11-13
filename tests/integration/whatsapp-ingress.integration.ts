import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import migration from "../../migrations/0002_whatsapp_gateway.sql?raw";
import {
  listOpenWhatsAppHandoffs, storeWhatsAppEvents, whatsappAgentMode,
} from "../../src/modules/whatsapp/storage";
import { decryptMetaToken } from "../../src/storage/token-crypto";
import type { InboundWhatsAppMessage, WhatsAppWebhookEnv } from "../../src/modules/whatsapp/webhook";

const db = (env as unknown as { WHATSAPP_DB: D1Database }).WHATSAPP_DB;
const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const number = "100000000000000";
const settings: WhatsAppWebhookEnv = {
  WHATSAPP_DB: db, WHATSAPP_DATA_KEY: secret, WHATSAPP_PHONE_NUMBER_ID: number,
};
const record = (kind: "text" | "unsupported"): InboundWhatsAppMessage => ({
  id: "wamid.fixture-" + crypto.randomUUID(),
  from: "27831234567",
  phoneNumberId: number,
  timestamp: 1794560000,
  type: kind,
  text: kind === "text" ? "Sensitive fixture: reference number 083 000 0000" : null,
});

beforeAll(async () => {
  const sql = migration.replace(/^\s*--.*$/gm, "");
  const statements = sql.split(";").map(item => item.trim()).filter(Boolean);
  await db.batch(statements.map(statement => db.prepare(statement)));
});

describe("WhatsApp webhook inbox in real local Cloudflare D1", () => {
  it("initially disables the autonomous agent without any manual action", async () => {
    expect(await whatsappAgentMode(db)).toBe("off");
  });

  it("encrypts text and sender, keys contact digests, and deduplicates repeated webhook events", async () => {
    const msg = record("text");
    await storeWhatsAppEvents([msg], settings);
    await storeWhatsAppEvents([msg], settings);

    const stored = await db.prepare(
      "SELECT message_id, contact_digest, event_ciphertext, state FROM wa_events WHERE message_id=?",
    ).bind(msg.id).first<{
      message_id: string; contact_digest: string; event_ciphertext: string; state: string;
    }>();
    expect(stored?.message_id).toBe(msg.id);
    expect(stored?.event_ciphertext).toMatch(/^v1\./);
    expect(stored?.event_ciphertext).not.toContain(msg.from);
    expect(stored?.event_ciphertext).not.toContain("Sensitive fixture");
    expect(stored?.contact_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.contact_digest).not.toContain(msg.from);
    expect(stored?.state).toBe("received");

    const clear = await decryptMetaToken(stored!.event_ciphertext, secret, {
      operatorId: "wa-number:" + number, connectionId: msg.id, platform: "whatsapp",
    });
    expect(JSON.parse(clear)).toMatchObject({
      from: msg.from, body: msg.text, type: "text",
    });

    const audit = await db.prepare("SELECT count(*) AS n FROM wa_audit WHERE message_id=?")
      .bind(msg.id).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it("routes unsupported media to a deduplicated human handoff, never an agent reply", async () => {
    const message = record("unsupported");
    await storeWhatsAppEvents([message], settings);
    await storeWhatsAppEvents([message], settings);
    const item = await db.prepare("SELECT state FROM wa_events WHERE message_id=?")
      .bind(message.id).first<{ state: string }>();
    expect(item?.state).toBe("needs_human");
    const handoffs = await listOpenWhatsAppHandoffs(db);
    expect(handoffs.find(h => h.messageId === message.id)).toMatchObject({
      reason: "unsupported_content_requires_human",
      status: "open",
      messageType: "unsupported",
    });
    expect(JSON.stringify(handoffs)).not.toContain(message.from);
    expect(JSON.stringify(handoffs)).not.toContain("Sensitive fixture");
    const count = await db.prepare(
      "SELECT count(*) AS n FROM wa_handoffs WHERE message_id=?",
    ).bind(message.id).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});
