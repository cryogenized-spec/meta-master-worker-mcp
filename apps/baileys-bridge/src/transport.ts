import { createHmac, randomBytes } from "node:crypto";

/** Only explicitly selected individual chats, never groups/history/self. */
export interface NormalizedBridgeMessage {
  messageId: string;
  chatJid: string;
  timestamp: number;
  text: string | null;
}

export interface MinimalBaileysMessage {
  key?: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null };
  messageTimestamp?: number | string | { toNumber(): number } | null;
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    imageMessage?: unknown;
  } | null;
}

export function normalizeBaileysMessage(
  item: MinimalBaileysMessage,
  allowedJids: ReadonlySet<string>,
  nowSeconds = Math.floor(Date.now() / 1000),
): NormalizedBridgeMessage | null {
  const key = item.key;
  const jid = key?.remoteJid;
  const id = key?.id;
  if (!jid || !id || key?.fromMe ||
      !/^[0-9]{4,25}@(s\.whatsapp\.net|lid)$/.test(jid) ||
      !allowedJids.has(jid) ||
      !/^[A-Za-z0-9._:/+=-]{1,256}$/.test(id)) return null;

  const timestamp = item.messageTimestamp === null || item.messageTimestamp === undefined
    ? NaN : typeof item.messageTimestamp === "object"
      ? item.messageTimestamp.toNumber() : Number(item.messageTimestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 3600) return null;
  if (!item.message) return null;
  const raw = typeof item.message.conversation === "string"
    ? item.message.conversation : item.message.extendedTextMessage?.text;
  const text = typeof raw === "string" && raw.length > 0 && raw.length <= 4096
    ? raw : null;
  return { messageId: id, chatJid: jid, timestamp, text };
}

export interface TransportSettings {
  endpoint: string;
  bridgeId: string;
  key: Buffer;
}

export function validateTransport(
  endpoint: string, bridgeId: string, encodedKey: string,
): TransportSettings {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new Error("invalid_bridge_endpoint"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.pathname !== "/internal/whatsapp/baileys" ||
      url.search || url.hash || url.username || url.password) {
    throw new Error("invalid_bridge_endpoint");
  }
  if (!/^[a-z0-9-]{3,64}$/.test(bridgeId)) throw new Error("invalid_bridge_id");
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw new Error("invalid_bridge_key");
  const key = Buffer.from(encodedKey, "base64url");
  if (key.byteLength !== 32) throw new Error("invalid_bridge_key");
  return { endpoint: url.href, bridgeId, key };
}

export function signBridgeEvent(
  message: NormalizedBridgeMessage,
  config: TransportSettings,
  timestamp = String(Math.floor(Date.now() / 1000)),
  nonce = randomBytes(24).toString("base64url"),
): { body: Buffer; headers: Record<string, string> } {
  if (!/^[0-9]{10,12}$/.test(timestamp) ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) throw new Error("invalid_bridge_nonce");
  const body = Buffer.from(JSON.stringify({ version: 1, events: [message] }), "utf8");
  const header = ["wa-bridge-v1", config.bridgeId, timestamp, nonce, ""].join("\n");
  const signature = createHmac("sha256", config.key).update(header).update(body).digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-bridge-id": config.bridgeId,
      "x-bridge-timestamp": timestamp,
      "x-bridge-nonce": nonce,
      "x-bridge-signature": "sha256=" + signature,
    },
  };
}

export async function forwardObservedMessage(
  message: NormalizedBridgeMessage,
  config: TransportSettings,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const request = signBridgeEvent(message, config);
  // An ingress acknowledgment does not authorise an AI reply.
  const body = new ArrayBuffer(request.body.byteLength);
  new Uint8Array(body).set(request.body);
  const response = await fetcher(config.endpoint, {
    method: "POST", headers: request.headers, body,
    redirect: "error", signal: AbortSignal.timeout(8000),
  });
  if (response.status !== 200) throw new Error("bridge_ingress_rejected");
}
