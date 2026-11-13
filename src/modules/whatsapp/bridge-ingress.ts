import type { InboundWhatsAppMessage, WhatsAppWebhookEnv } from "./webhook";
import { storeWhatsAppEvents } from "./storage";

/**
 * Private ingress for an optional Node/Baileys linked-device bridge.
 *
 * This is deliberately SEPARATE from /webhooks/whatsapp, which verifies
 * Meta's X-Hub-Signature-256 and MUST NOT accept bridge credentials.
 * No downstream agent invocation, WhatsApp send or pairing is implemented.
 */
export interface BaileysIngressEnv extends WhatsAppWebhookEnv {
  BAILEYS_BRIDGE_INGRESS_ENABLED?: string;
  BAILEYS_BRIDGE_ID?: string;
  BAILEYS_BRIDGE_HMAC_KEY?: string;
}

const LIMIT = 64 * 1024;
const WINDOW_SECONDS = 300;

function reply(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function plainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function base64Key(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const out = Uint8Array.from(binary, c => c.charCodeAt(0));
    return out.byteLength === 32 ? out : null;
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeMatch(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.byteLength ^ b.byteLength;
  for (let i = 0; i < Math.max(a.byteLength, b.byteLength); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Signed bytes = "wa-bridge-v1\n" + bridgeId + "\n" + timestamp + "\n"
 * + nonce + "\n" + EXACT raw request body bytes.
 */
export function signedBridgeBytes(
  bridgeId: string, timestamp: string, nonce: string, rawBody: Uint8Array,
): Uint8Array {
  const header = new TextEncoder().encode(
    ["wa-bridge-v1", bridgeId, timestamp, nonce, ""].join("\n"),
  );
  const combined = new Uint8Array(header.byteLength + rawBody.byteLength);
  combined.set(header);
  combined.set(rawBody, header.byteLength);
  return combined;
}

export async function computeBridgeMac(
  bridgeId: string, timestamp: string, nonce: string,
  rawBody: Uint8Array, keyBytes: Uint8Array,
): Promise<string> {
  const key = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(key).set(keyBytes);
  const webKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const message = signedBridgeBytes(bridgeId, timestamp, nonce, rawBody);
  const buffer = new ArrayBuffer(message.byteLength);
  new Uint8Array(buffer).set(message);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", webKey, buffer)));
}

export interface BridgeMessage {
  messageId: string;
  chatJid: string;
  timestamp: number;
  text: string | null;
}

export function normalizeBridgeEvents(
  value: unknown,
  bridgeId: string,
  nowSeconds: number,
): BridgeMessage[] {
  if (!plainObject(value) || value.version !== 1 || !Array.isArray(value.events) ||
      value.events.length < 1 || value.events.length > 20) {
    throw new Error("invalid_bridge_envelope");
  }
  const events: BridgeMessage[] = [];
  for (const item of value.events) {
    if (!plainObject(item) ||
        typeof item.messageId !== "string" ||
        !/^[A-Za-z0-9._:/+=-]{1,256}$/.test(item.messageId) ||
        typeof item.chatJid !== "string" ||
        !/^[0-9]{4,25}@(s\.whatsapp\.net|lid)$/.test(item.chatJid) ||
        !Number.isSafeInteger(item.timestamp) ||
        Math.abs(nowSeconds - (item.timestamp as number)) > 3600 ||
        (item.text !== null && (typeof item.text !== "string" ||
          item.text.length < 1 || item.text.length > 4096))) {
      throw new Error("invalid_bridge_event");
    }
    events.push({
      messageId: item.messageId,
      chatJid: item.chatJid,
      timestamp: item.timestamp as number,
      text: item.text as string | null,
    });
  }
  return events;
}

export async function handleBaileysIngress(
  request: Request,
  env: BaileysIngressEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  if (request.method !== "POST") return reply(405, "Method not allowed");
  const bridgeId = env.BAILEYS_BRIDGE_ID;
  const key = env.BAILEYS_BRIDGE_HMAC_KEY && base64Key(env.BAILEYS_BRIDGE_HMAC_KEY);
  const db = env.WHATSAPP_DB;
  if (env.BAILEYS_BRIDGE_INGRESS_ENABLED !== "true" ||
      !bridgeId || !/^[a-z0-9-]{3,64}$/.test(bridgeId) || !key ||
      !db || !env.WHATSAPP_DATA_KEY || typeof db.prepare !== "function") {
    return reply(503, "Bridge not configured");
  }

  const headerId = request.headers.get("x-bridge-id");
  const timestamp = request.headers.get("x-bridge-timestamp");
  const nonce = request.headers.get("x-bridge-nonce");
  const signature = request.headers.get("x-bridge-signature");
  if (headerId !== bridgeId || !timestamp || !/^[0-9]{10,12}$/.test(timestamp) ||
      Math.abs(Number(timestamp) - nowSeconds) > WINDOW_SECONDS ||
      !nonce || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
      !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
    return reply(401, "Unauthorized");
  }
  if (Number(request.headers.get("content-length") ?? "0") > LIMIT) {
    return reply(413, "Payload too large");
  }
  let body: Uint8Array;
  try {
    body = new Uint8Array(await request.arrayBuffer());
  } catch {
    return reply(400, "Invalid body");
  }
  if (body.byteLength === 0 || body.byteLength > LIMIT) return reply(413, "Payload too large");

  const expected = await computeBridgeMac(bridgeId, timestamp, nonce, body, key);
  const expectedBytes = new TextEncoder().encode("sha256=" + expected);
  const actualBytes = new TextEncoder().encode(signature);
  if (!constantTimeMatch(actualBytes, expectedBytes)) return reply(401, "Unauthorized");

  let events: BridgeMessage[];
  try {
    events = normalizeBridgeEvents(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown,
      bridgeId, nowSeconds,
    );
  } catch {
    return reply(400, "Invalid payload");
  }

  const bodyHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  const receipt = {
    bridgeId, nonce, bodyDigest: bodyHash, receivedAt: nowSeconds,
  };

  const sameReceipt = async (): Promise<boolean | null> => {
    const previous = await db.prepare(
      "SELECT body_sha256 FROM wa_bridge_receipts WHERE bridge_id=? AND nonce=?",
    ).bind(bridgeId, nonce).first<{ body_sha256: string }>();
    return previous ? previous.body_sha256 === bodyHash : null;
  };

  try {
    const previous = await sameReceipt();
    if (previous === true) return reply(200, "OK");
    if (previous === false) return reply(409, "Replay conflict");

    const normalized: InboundWhatsAppMessage[] = [];
    for (const event of events) {
      // Stable, opaque ID: even an index lookup cannot reveal the chat JID.
      const identifier = new TextEncoder().encode(
        [bridgeId, event.chatJid, event.messageId].join("\n"),
      );
      const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", identifier)));
      normalized.push({
        id: "bridge-" + digest,
        from: event.chatJid,
        phoneNumberId: "bridge-" + bridgeId,
        timestamp: event.timestamp,
        type: event.text === null ? "unsupported" : "text",
        text: event.text,
      });
    }
    await storeWhatsAppEvents(normalized, env, receipt);
    return reply(200, "OK");
  } catch {
    // A competing request may have atomically committed this signed nonce.
    // Confirm before replying so retry loops remain idempotent.
    try {
      const previous = await sameReceipt();
      if (previous === true) return reply(200, "OK");
      if (previous === false) return reply(409, "Replay conflict");
    } catch {
      // Database unavailable: allow a signed bridge request to retry.
    }
    return reply(503, "Temporarily unavailable");
  }
}
