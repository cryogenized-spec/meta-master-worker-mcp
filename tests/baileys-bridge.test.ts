import { describe, expect, it, vi } from "vitest";
import {
  computeBridgeMac, handleBaileysIngress, normalizeBridgeEvents,
  signedBridgeBytes, type BaileysIngressEnv,
} from "../src/modules/whatsapp/bridge-ingress";

const encoder = new TextEncoder();
const bridgeId = "omen-local";
const now = 1794560000;
const token = btoa(String.fromCharCode(...new Uint8Array(32).fill(31)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

function data() {
  return {
    version: 1,
    events: [{
      messageId: "BAILEYS-msg-001",
      chatJid: "27123456789@s.whatsapp.net",
      timestamp: now,
      text: "Do you have today's opening hours?",
    }],
  };
}
function settings(): BaileysIngressEnv {
  return {
    BAILEYS_BRIDGE_INGRESS_ENABLED: "true",
    BAILEYS_BRIDGE_ID: bridgeId,
    BAILEYS_BRIDGE_HMAC_KEY: token,
    WHATSAPP_DATA_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(44)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
    WHATSAPP_DB: {
      prepare: vi.fn(() => ({ bind: () => ({ first: async () => null }) })),
    } as unknown as D1Database,
  };
}
async function signed(body: string): Promise<Request> {
  const time = String(now);
  const nonce = "this-is-a-fixture-nonce-001";
  const signature = await computeBridgeMac(
    bridgeId, time, nonce, encoder.encode(body), new Uint8Array(32).fill(31),
  );
  return new Request("https://example.test/internal/whatsapp/baileys", {
    method: "POST",
    headers: {
      "x-bridge-id": bridgeId,
      "x-bridge-timestamp": time,
      "x-bridge-nonce": nonce,
      "x-bridge-signature": "sha256=" + signature,
      "content-type": "application/json",
    },
    body,
  });
}

describe("separate Baileys bridge authentication boundary", () => {
  it("creates deterministic domain-separated HMAC input", async () => {
    const bytes = signedBridgeBytes(bridgeId, String(now), "test-nonce-123456789", encoder.encode("hello"));
    expect(new TextDecoder().decode(bytes)).toBe(
      "wa-bridge-v1\nomen-local\n1794560000\ntest-nonce-123456789\nhello",
    );
    const a = await computeBridgeMac(bridgeId, String(now), "test-nonce-123456789",
      encoder.encode("hello"), new Uint8Array(32).fill(31));
    const b = await computeBridgeMac(bridgeId, String(now), "test-nonce-123456789",
      encoder.encode("hello!"), new Uint8Array(32).fill(31));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("does not confuse Cloud API webhook signatures with bridge signatures", async () => {
    const request = await signed(JSON.stringify(data()));
    const headers = new Headers(request.headers);
    headers.delete("x-bridge-signature");
    headers.set("x-hub-signature-256", "sha256=" + "0".repeat(64));
    const replacement = new Request(request.url, {
      method: "POST", headers, body: await request.text(),
    });
    expect((await handleBaileysIngress(replacement, settings(), now)).status).toBe(401);
  });

  it("defaults to disabled without an explicit bridge opt-in and storage", async () => {
    expect((await handleBaileysIngress(await signed(JSON.stringify(data())), {}, now)).status).toBe(503);
    expect((await handleBaileysIngress(await signed(JSON.stringify(data())),
      { ...settings(), BAILEYS_BRIDGE_INGRESS_ENABLED: "false" }, now)).status).toBe(503);
  });

  it("denies signature tampering, expired timestamps and wrong bridge IDs", async () => {
    const original = await signed(JSON.stringify(data()));
    const headers = new Headers(original.headers);
    headers.set("x-bridge-signature", "sha256=" + "0".repeat(64));
    expect((await handleBaileysIngress(new Request(original.url, {
      method: "POST", headers, body: await original.text(),
    }), settings(), now)).status).toBe(401);
    expect((await handleBaileysIngress(await signed(JSON.stringify(data())), settings(), now + 360)).status).toBe(401);
    expect((await handleBaileysIngress(await signed(JSON.stringify(data())),
      { ...settings(), BAILEYS_BRIDGE_ID: "different" }, now)).status).toBe(401);
  });

  it("accepts individual chats and LID IDs but rejects groups and malformed events", () => {
    expect(normalizeBridgeEvents(data(), bridgeId, now)).toHaveLength(1);
    const lid = data();
    lid.events[0].chatJid = "123456789@lid";
    expect(normalizeBridgeEvents(lid, bridgeId, now)[0].chatJid).toBe("123456789@lid");
    const group = data();
    group.events[0].chatJid = "1234@g.us";
    expect(() => normalizeBridgeEvents(group, bridgeId, now)).toThrow("invalid_bridge_event");
    const old = data();
    old.events[0].timestamp = now - 5000;
    expect(() => normalizeBridgeEvents(old, bridgeId, now)).toThrow("invalid_bridge_event");
  });

  it("fails closed on malformed signed JSON", async () => {
    expect((await handleBaileysIngress(await signed("{not-json"), settings(), now)).status).toBe(400);
  });
});
