/**
 * WhatsApp Business Cloud API webhook input adapter.
 * The endpoint never invokes a model, sends a WhatsApp reply, or exposes
 * customer message contents to an unauthenticated HTTP client.
 */
export interface WhatsAppWebhookEnv {
  WHATSAPP_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_DATA_KEY?: string;
  WHATSAPP_DB?: D1Database;
}

export interface InboundWhatsAppMessage {
  id: string;
  from: string;
  phoneNumberId: string;
  timestamp: number;
  type: "text" | "unsupported";
  text: string | null;
}

const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_MESSAGES = 80;
const jsonHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function answer(status: number, text: string): Response {
  return new Response(text, { status, headers: {
    ...jsonHeaders, "content-type": "text/plain; charset=utf-8",
  } });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

function secureStringEqual(actual: string, expected: string): boolean {
  return constantTimeEqual(
    new TextEncoder().encode(actual),
    new TextEncoder().encode(expected),
  );
}

export function verifyChallenge(request: Request, verifyToken?: string): Response {
  if (!verifyToken || verifyToken.length < 16) return answer(503, "Webhook not configured");
  const q = new URL(request.url).searchParams;
  const token = q.get("hub.verify_token");
  const challenge = q.get("hub.challenge");
  if (q.get("hub.mode") !== "subscribe" || token === null ||
      challenge === null || !/^[0-9]{1,100}$/.test(challenge) ||
      !secureStringEqual(token, verifyToken)) {
    return answer(403, "Forbidden");
  }
  return answer(200, challenge);
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(2*i,2*i+2),16);
  return bytes;
}

/** Verify the HMAC over the exact raw bytes Meta signed (not re-serialized JSON). */
export async function verifySignature(
  body: Uint8Array,
  signatureHeader: string | null,
  appSecret?: string,
): Promise<boolean> {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;
  const received = hexToBytes(signatureHeader.slice(7));
  if (!received) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const source = new Uint8Array(body.byteLength);
  source.set(body);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, source.buffer));
  return constantTimeEqual(received, signed);
}

/**
 * Strictly extract inbound messages from the configured number. Status
 * notifications and unsupported event categories are not treated as inbound
 * customer requests. Media is routed to human review, not AI inference.
 */
export function extractIncoming(
  payload: unknown,
  phoneNumberId: string,
): InboundWhatsAppMessage[] {
  if (!object(payload) || payload.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry) || payload.entry.length > 20) {
    throw new Error("invalid_webhook_payload");
  }
  const collected: InboundWhatsAppMessage[] = [];
  for (const entry of payload.entry) {
    if (!object(entry) || !Array.isArray(entry.changes) || entry.changes.length > 20) continue;
    for (const change of entry.changes) {
      if (!object(change) || change.field !== "messages" || !object(change.value)) continue;
      const value = change.value;
      if (!object(value.metadata) || value.metadata.phone_number_id !== phoneNumberId) continue;
      if (!Array.isArray(value.messages)) continue;
      if (value.messages.length > MAX_MESSAGES) throw new Error("too_many_messages");
      for (const message of value.messages) {
        if (!object(message) || typeof message.id !== "string" ||
            !/^[A-Za-z0-9._:-]{1,256}$/.test(message.id) ||
            typeof message.from !== "string" || !/^[0-9]{8,20}$/.test(message.from) ||
            typeof message.timestamp !== "string" || !/^[0-9]{9,12}$/.test(message.timestamp)) continue;
        const type = message.type === "text" && object(message.text) &&
          typeof message.text.body === "string" &&
          message.text.body.length >= 1 && message.text.body.length <= 4096
          ? "text" : "unsupported";
        collected.push({
          id: message.id,
          from: message.from,
          phoneNumberId,
          timestamp: Number(message.timestamp),
          type,
          text: type === "text" ? String((message.text as Record<string, unknown>).body) : null,
        });
        if (collected.length > MAX_MESSAGES) throw new Error("too_many_messages");
      }
    }
  }
  return collected;
}

export interface IngressHandler {
  (messages: InboundWhatsAppMessage[], env: WhatsAppWebhookEnv): Promise<void>;
}

export async function handleWhatsAppWebhook(
  request: Request,
  env: WhatsAppWebhookEnv,
  persist: IngressHandler,
): Promise<Response> {
  if (request.method === "GET") return verifyChallenge(request, env.WHATSAPP_VERIFY_TOKEN);
  if (request.method !== "POST") return answer(405, "Method not allowed");
  if (!env.META_APP_SECRET || !env.WHATSAPP_PHONE_NUMBER_ID ||
      !env.WHATSAPP_DB || !env.WHATSAPP_DATA_KEY) {
    return answer(503, "Webhook not configured");
  }
  const announced = Number(request.headers.get("content-length") ?? "0");
  if (announced > MAX_WEBHOOK_BYTES) return answer(413, "Payload too large");
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    return answer(400, "Invalid body");
  }
  if (raw.byteLength > MAX_WEBHOOK_BYTES) return answer(413, "Payload too large");
  if (!await verifySignature(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
    return answer(401, "Invalid signature");
  }
  let messages: InboundWhatsAppMessage[];
  try {
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    messages = extractIncoming(data, env.WHATSAPP_PHONE_NUMBER_ID);
  } catch {
    return answer(400, "Invalid payload");
  }
  try {
    await persist(messages, env);
  } catch {
    // A non-2xx response allows Meta to retry. D1 uniqueness will
    // deduplicate any messages already saved in a partial batch.
    return answer(503, "Temporarily unavailable");
  }
  return answer(200, "OK");
}
