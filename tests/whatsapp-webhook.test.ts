import { describe, expect, it, vi } from "vitest";
import {
  verifyChallenge, verifySignature, extractIncoming,
  handleWhatsAppWebhook, type WhatsAppWebhookEnv,
  type InboundWhatsAppMessage,
} from "../src/modules/whatsapp/webhook";

const verifyToken = "test-verify-token-just-for-ci";
const appSecret = "test-meta-app-secret-not-a-credential";
const number = "123456789012345";

function sample() {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456",
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: number, display_phone_number: "0000000" },
          contacts: [{ wa_id: "27831234567", profile: { name: "Customer" } }],
          messages: [{
            from: "27831234567",
            id: "wamid.fixture-0001",
            timestamp: "1794560000",
            type: "text",
            text: { body: "Hi, do you have a catalog?" },
          }],
          statuses: [{ id: "unrelated-status" }],
        },
      }],
    }],
  };
}

async function signedRequest(body: string, secret = appSecret, signatureOverride?: string): Promise<Request> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(body)))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://example.test/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signatureOverride ?? "sha256=" + signature,
    },
    body,
  });
}

const env: WhatsAppWebhookEnv = {
  WHATSAPP_VERIFY_TOKEN: verifyToken,
  META_APP_SECRET: appSecret,
  WHATSAPP_PHONE_NUMBER_ID: number,
  WHATSAPP_DATA_KEY: "x".repeat(43),
  WHATSAPP_DB: {} as D1Database,
};

describe("WhatsApp Cloud API webhook authentication", () => {
  it("answers Meta challenge only for correct verify token", async () => {
    const params = "?hub.mode=subscribe&hub.challenge=123456&hub.verify_token=";
    const good = verifyChallenge(new Request("https://test.invalid/webhooks/whatsapp" + params + verifyToken), verifyToken);
    expect(good.status).toBe(200);
    expect(await good.text()).toBe("123456");
    expect(verifyChallenge(new Request("https://test.invalid/webhooks/whatsapp" + params + "wrong"), verifyToken).status).toBe(403);
    expect(verifyChallenge(new Request("https://test.invalid/webhooks/whatsapp" + params + verifyToken), undefined).status).toBe(503);
    expect(verifyChallenge(new Request("https://test.invalid/webhooks/whatsapp" + "?hub.mode=subscribe&hub.challenge=<script>&hub.verify_token=" + verifyToken), verifyToken).status).toBe(403);
  });

  it("authenticates raw bytes, rejects tampering and missing signatures", async () => {
    const original = JSON.stringify(sample());
    const request = await signedRequest(original);
    const bytes = new Uint8Array(await request.arrayBuffer());
    expect(await verifySignature(bytes, request.headers.get("x-hub-signature-256"), appSecret)).toBe(true);
    expect(await verifySignature(new TextEncoder().encode(original + " "), request.headers.get("x-hub-signature-256"), appSecret)).toBe(false);
    expect(await verifySignature(bytes, "sha256=bad", appSecret)).toBe(false);
    expect(await verifySignature(bytes, null, appSecret)).toBe(false);
  });

  it("extracts only inbound messages for the configured phone, not statuses", () => {
    expect(extractIncoming(sample(), number)).toEqual([{
      id: "wamid.fixture-0001",
      from: "27831234567",
      phoneNumberId: number,
      timestamp: 1794560000,
      type: "text",
      text: "Hi, do you have a catalog?",
    }]);
    expect(extractIncoming(sample(), "different")).toEqual([]);
    const statusOnly = sample();
    delete (statusOnly.entry[0].changes[0].value as Record<string, unknown>).messages;
    expect(extractIncoming(statusOnly, number)).toEqual([]);
  });

  it("routes media to review without forwarding untrusted media contents", () => {
    const payload = sample();
    const message = payload.entry[0].changes[0].value.messages[0] as unknown as Record<string, unknown>;
    message.type = "image";
    message.image = { id: "media-id", caption: "untrusted caption" };
    expect(extractIncoming(payload, number)[0]).toMatchObject({ type: "unsupported", text: null });
  });

  it("persists a verified event and responds OK, without sending any message", async () => {
    const persist = vi.fn(async (_messages: InboundWhatsAppMessage[]) => undefined);
    const request = await signedRequest(JSON.stringify(sample()));
    const response = await handleWhatsAppWebhook(request, env, persist);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0][0].from).toBe("27831234567");
  });

  it("fails closed for missing credentials, forged events and failed persistence", async () => {
    const spy = vi.fn(async () => undefined);
    const request = await signedRequest(JSON.stringify(sample()));
    expect((await handleWhatsAppWebhook(request, {}, spy)).status).toBe(503);
    expect(spy).not.toHaveBeenCalled();

    const forged = await signedRequest(JSON.stringify(sample()), "other-app-secret");
    expect((await handleWhatsAppWebhook(forged, env, spy)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();

    const failing = vi.fn(async () => { throw new Error("database unavailable - secret"); });
    const valid = await signedRequest(JSON.stringify(sample()));
    const denied = await handleWhatsAppWebhook(valid, env, failing);
    expect(denied.status).toBe(503);
    expect(await denied.text()).not.toContain("secret");
  });

  it("rejects oversized payloads and invalid JSON before persistence", async () => {
    const spy = vi.fn(async () => undefined);
    const huge = new Request("https://example.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-length": "9999999", "x-hub-signature-256": "sha256=" + "0".repeat(64) },
      body: "{}",
    });
    expect((await handleWhatsAppWebhook(huge, env, spy)).status).toBe(413);
    const notJson = await signedRequest("{invalid json");
    expect((await handleWhatsAppWebhook(notJson, env, spy)).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
