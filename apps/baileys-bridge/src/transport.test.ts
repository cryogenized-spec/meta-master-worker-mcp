import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBaileysMessage, signBridgeEvent, validateTransport,
  forwardObservedMessage,
} from "./transport.js";

const now = 1794560000;
const jid = "27123456789@s.whatsapp.net";
const allow = new Set([jid]);
const config = validateTransport(
  "https://example.com/internal/whatsapp/baileys",
  "omen-local",
  Buffer.alloc(32, 7).toString("base64url"),
);

test("does not forward unknown chats, groups, status or own messages", () => {
  const good = {
    key: { remoteJid: jid, id: "BAILEYS-123", fromMe: false },
    messageTimestamp: now,
    message: { conversation: "Hello there" },
  };
  assert.deepEqual(normalizeBaileysMessage(good, allow, now), {
    messageId: "BAILEYS-123", chatJid: jid, timestamp: now, text: "Hello there",
  });
  assert.equal(normalizeBaileysMessage({ ...good, key: { ...good.key, fromMe: true } }, allow, now), null);
  assert.equal(normalizeBaileysMessage({ ...good, key: { ...good.key, remoteJid: "123@g.us" } }, allow, now), null);
  assert.equal(normalizeBaileysMessage({ ...good, key: { ...good.key, remoteJid: "999@s.whatsapp.net" } }, allow, now), null);
  assert.equal(normalizeBaileysMessage({ ...good, messageTimestamp: now - 5000 }, allow, now), null);
});
test("safely classifies unsupported media without downloading it", () => {
  const raw = {
    key: { remoteJid: jid, id: "123", fromMe: false },
    messageTimestamp: { toNumber: () => now },
    message: { imageMessage: { caption: "untrusted" } },
  };
  const normalized = normalizeBaileysMessage(raw, allow, now);
  assert.equal(normalized?.text, null);
});
test("rejects wildcard/insecure endpoints, credentials and invalid HMAC keys", () => {
  const key = Buffer.alloc(32, 9).toString("base64url");
  assert.throws(() => validateTransport("https://evil.test/bad", "omen-local", key), /invalid_bridge_endpoint/);
  assert.throws(() => validateTransport("http://remote.test/internal/whatsapp/baileys", "omen-local", key), /invalid_bridge_endpoint/);
  assert.throws(() => validateTransport("https://user:pass@evil.test/internal/whatsapp/baileys", "omen-local", key), /invalid_bridge_endpoint/);
  assert.throws(() => validateTransport(config.endpoint, "bad id", key), /invalid_bridge_id/);
  assert.throws(() => validateTransport(config.endpoint, "omen-local", "missing"), /invalid_bridge_key/);
});
test("signs raw body with identical documented HMAC wire format", () => {
  const message = {
    messageId: "id", chatJid: jid, timestamp: now, text: "Fixture message",
  };
  const { body, headers } = signBridgeEvent(
    message, config, String(now), "signed-nonce-12345678",
  );
  const prefix = ["wa-bridge-v1", "omen-local", String(now), "signed-nonce-12345678", ""].join("\n");
  const computed = createHmac("sha256", config.key).update(prefix).update(body).digest("hex");
  assert.equal(headers["x-bridge-signature"], "sha256=" + computed);
  assert.equal(JSON.parse(body.toString("utf8")).events[0].text, message.text);
});
test("forwarder sends signed observation only, never WhatsApp messages", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init! });
    return new Response("OK", { status: 200 });
  };
  const message = { messageId: "id", chatJid: jid, timestamp: now, text: "Fixture" };
  await forwardObservedMessage(message, config, fetcher as typeof fetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/internal/whatsapp/baileys");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("x-bridge-id"), "omen-local");
  assert.ok(!calls[0].url.includes(jid));
});
