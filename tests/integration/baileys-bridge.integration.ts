import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import inboxSql from "../../migrations/0002_whatsapp_gateway.sql?raw";
import bridgeSql from "../../migrations/0003_whatsapp_bridge.sql?raw";
import {
  computeBridgeMac, handleBaileysIngress, type BaileysIngressEnv,
} from "../../src/modules/whatsapp/bridge-ingress";
import { decryptMetaToken } from "../../src/storage/token-crypto";
import { whatsappAgentMode } from "../../src/modules/whatsapp/storage";

const db = (env as unknown as { WHATSAPP_DB: D1Database }).WHATSAPP_DB;
const now = 1794560000;
const bridgeId = "test-observer";
const keyBytes = new Uint8Array(32).fill(41);
const key = btoa(String.fromCharCode(...keyBytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const dataBytes = new Uint8Array(32).fill(55);
const dataKey = btoa(String.fromCharCode(...dataBytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const config: BaileysIngressEnv = {
  BAILEYS_BRIDGE_INGRESS_ENABLED: "true",
  BAILEYS_BRIDGE_ID: bridgeId,
  BAILEYS_BRIDGE_HMAC_KEY: key,
  WHATSAPP_DATA_KEY: dataKey,
  WHATSAPP_DB: db,
};

async function signed(messageId: string, nonce: string, text: string | null, timestamp = now): Promise<Request> {
  const body = JSON.stringify({
    version: 1,
    events: [{ messageId, chatJid: "27123456789@s.whatsapp.net", text, timestamp }],
  });
  const time = String(now);
  const mac = await computeBridgeMac(bridgeId, time, nonce, new TextEncoder().encode(body), keyBytes);
  return new Request("https://example.test/internal/whatsapp/baileys", {
    method: "POST",
    headers: {
      "x-bridge-id": bridgeId,
      "x-bridge-timestamp": time,
      "x-bridge-nonce": nonce,
      "x-bridge-signature": "sha256=" + mac,
    },
    body,
  });
}

async function migrate(sql: string): Promise<void> {
  const statements = sql.replace(/^\s*--.*$/gm, "").split(";")
    .map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(s => db.prepare(s)));
}

beforeAll(async () => {
  await migrate(inboxSql);
  await migrate(bridgeSql);
});

describe("Baileys signed private ingress against actual local D1", () => {
  it("keeps agent off after applying both schema migrations", async () => {
    expect(await whatsappAgentMode(db)).toBe("off");
  });

  it("saves only ciphertext and deduplicates identical signed bridge requests", async () => {
    const nonce = "signed-replay-nonce-" + crypto.randomUUID().replaceAll("-", "");
    const messageId = "bridge-message-" + crypto.randomUUID();
    const message = "Fixture private chat; should never appear in database indexes";
    const original = await signed(messageId, nonce, message);
    expect((await handleBaileysIngress(original, config, now)).status).toBe(200);
    const repeat = await signed(messageId, nonce, message);
    expect((await handleBaileysIngress(repeat, config, now)).status).toBe(200);
    const stored = await db.prepare(
      "SELECT message_id,contact_digest,event_ciphertext,state FROM wa_events WHERE phone_number_id=?",
    ).bind("bridge-" + bridgeId).first<{
      message_id: string;
      contact_digest: string;
      event_ciphertext: string;
      state: string;
    }>();
    expect(stored).toBeTruthy();
    expect(stored!.message_id).toMatch(/^bridge-[0-9a-f]{64}$/);
    expect(stored!.message_id).not.toContain(messageId);
    expect(stored!.message_id).not.toContain("27123456789");
    expect(stored!.event_ciphertext).toMatch(/^v1\./);
    expect(stored!.event_ciphertext).not.toContain(message);
    expect(stored!.contact_digest).not.toContain("27123456789");
    expect(stored!.state).toBe("received");

    const plaintext = await decryptMetaToken(stored!.event_ciphertext, dataKey, {
      operatorId: "wa-number:bridge-" + bridgeId,
      connectionId: stored!.message_id,
      platform: "whatsapp",
    });
    expect(JSON.parse(plaintext)).toMatchObject({ body: message, from: "27123456789@s.whatsapp.net" });
    const record = await db.prepare(
      "SELECT count(*) AS count FROM wa_bridge_receipts WHERE bridge_id=? AND nonce=?",
    ).bind(bridgeId, nonce).first<{ count: number }>();
    expect(record?.count).toBe(1);
    const event = await db.prepare(
      "SELECT count(*) AS count FROM wa_events WHERE message_id=?",
    ).bind(stored!.message_id).first<{ count: number }>();
    expect(event?.count).toBe(1);
  });

  it("blocks same signed nonce with changed body instead of writing new messages", async () => {
    const nonce = "conflict-nonce-" + crypto.randomUUID().replaceAll("-", "");
    const original = await signed("message-one", nonce, "first safe message");
    expect((await handleBaileysIngress(original, config, now)).status).toBe(200);
    const changed = await signed("message-two", nonce, "different message");
    expect((await handleBaileysIngress(changed, config, now)).status).toBe(409);
  });

  it("routes an unsupported media message into a human-review item", async () => {
    const nonce = "media-nonce-" + crypto.randomUUID().replaceAll("-", "");
    const msg = await signed("media-" + crypto.randomUUID(), nonce, null);
    expect((await handleBaileysIngress(msg, config, now)).status).toBe(200);
    const result = await db.prepare(
      "SELECT count(*) AS count FROM wa_handoffs h JOIN wa_events e ON e.message_id=h.message_id WHERE e.phone_number_id=?",
    ).bind("bridge-" + bridgeId).first<{ count: number }>();
    expect(result?.count).toBeGreaterThan(0);
  });
});
