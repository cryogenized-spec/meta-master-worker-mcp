var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/storage/token-crypto.ts
function contextAAD(ctx) {
  if (!ctx.operatorId || !ctx.connectionId || !ctx.platform) {
    throw new Error("invalid_token_context");
  }
  return new TextEncoder().encode(
    JSON.stringify(["meta-master-mcp", "token-v1", ctx.operatorId, ctx.connectionId, ctx.platform])
  );
}
__name(contextAAD, "contextAAD");
function encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(encode, "encode");
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_encoded_secret");
  try {
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new Error("invalid_encoded_secret");
  }
}
__name(decode, "decode");
function asBuffer(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
__name(asBuffer, "asBuffer");
async function importKey(secret) {
  if (!secret) throw new Error("missing_encryption_key");
  const bytes = decode(secret);
  if (bytes.length !== 32) throw new Error("invalid_encryption_key");
  return crypto.subtle.importKey("raw", asBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(importKey, "importKey");
async function encryptMetaToken(plaintext, keySecret, context) {
  if (!plaintext) throw new Error("empty_token");
  const key = await importKey(keySecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(iv), additionalData: asBuffer(contextAAD(context)) },
    key,
    asBuffer(data)
  );
  return ["v1", encode(iv), encode(new Uint8Array(ciphertext))].join(".");
}
__name(encryptMetaToken, "encryptMetaToken");

// src/modules/whatsapp/review-policy.ts
var SENSITIVE_TOPICS = [
  /\b(?:blank[\s-]?guns?|firearms?|pistols?|rifles?|shotguns?|ammunition|cartridges|weapon(?:s)?)\b/i,
  /\b(?:pcp\s+(?:rifle|gun)|co2\s+(?:pistol|gun)|blow\s+mini\s*9|bruni\s+mini\s+gap)\b/i,
  /\b(?:payday\s+loan|borrow\s+money|cash\s+advance|loan(?:s)?)\b/i
];
var HUMAN_REQUESTS = [
  /\b(?:human|real person|speak to (?:someone|a person)|call me|manager|complaint)\b/i
];
function reviewReason(type, text) {
  if (type !== "text" || text === null) return "unsupported_content_requires_human";
  if (SENSITIVE_TOPICS.some((pattern) => pattern.test(text))) return "regulated_or_sensitive_topic";
  if (HUMAN_REQUESTS.some((pattern) => pattern.test(text))) return "customer_requests_human";
  return null;
}
__name(reviewReason, "reviewReason");

// src/modules/whatsapp/storage.ts
function configured(env) {
  if (!env.WHATSAPP_DB || !env.WHATSAPP_DATA_KEY || typeof env.WHATSAPP_DB.prepare !== "function" || typeof env.WHATSAPP_DB.batch !== "function") {
    throw new Error("whatsapp_storage_not_configured");
  }
  return { db: env.WHATSAPP_DB, key: env.WHATSAPP_DATA_KEY };
}
__name(configured, "configured");
function base64UrlDecode(raw) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new Error("invalid_whatsapp_data_key");
  const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
__name(base64UrlDecode, "base64UrlDecode");
async function contactDigest(secret, phoneNumberId, from) {
  const bytes = base64UrlDecode(secret);
  if (bytes.byteLength !== 32) throw new Error("invalid_whatsapp_data_key");
  const buffer = new ArrayBuffer(32);
  new Uint8Array(buffer).set(bytes);
  const key = await crypto.subtle.importKey(
    "raw",
    buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const hash = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("wa-contact-v1:" + phoneNumberId + ":" + from)
  ));
  return Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join("");
}
__name(contactDigest, "contactDigest");
async function storeWhatsAppEvents(messages, env, bridgeReceipt) {
  if (messages.length === 0 && !bridgeReceipt) return;
  const { db, key } = configured(env);
  if (messages.length > 80) throw new Error("whatsapp_event_batch_too_large");
  const receivedAt = Math.floor(Date.now() / 1e3);
  const queries = [];
  if (bridgeReceipt) {
    queries.push(db.prepare(
      "INSERT INTO wa_bridge_receipts (bridge_id,nonce,body_sha256,received_at) VALUES (?,?,?,?)"
    ).bind(
      bridgeReceipt.bridgeId,
      bridgeReceipt.nonce,
      bridgeReceipt.bodyDigest,
      bridgeReceipt.receivedAt
    ));
  }
  for (const message of messages) {
    const encrypted = await encryptMetaToken(
      JSON.stringify({
        from: message.from,
        body: message.text,
        timestamp: message.timestamp,
        type: message.type
      }),
      key,
      {
        operatorId: "wa-number:" + message.phoneNumberId,
        connectionId: message.id,
        platform: "whatsapp"
      }
    );
    const digest = await contactDigest(key, message.phoneNumberId, message.from);
    const reason = reviewReason(message.type, message.text);
    const state = reason === null ? "received" : "needs_human";
    queries.push(db.prepare(
      "INSERT OR IGNORE INTO wa_events (message_id,phone_number_id,contact_digest,event_ciphertext,event_type,event_ts,received_at,state) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(
      message.id,
      message.phoneNumberId,
      digest,
      encrypted,
      message.type,
      message.timestamp,
      receivedAt,
      state
    ));
    queries.push(db.prepare(
      "INSERT OR IGNORE INTO wa_audit (audit_key,message_id,action,recorded_at) VALUES (?,?,?,?)"
    ).bind(message.id + ":received", message.id, "received", receivedAt));
    if (reason !== null) {
      queries.push(db.prepare(
        "INSERT OR IGNORE INTO wa_handoffs (message_id,reason,status,created_at) VALUES (?,?,'open',?)"
      ).bind(message.id, reason, receivedAt));
    }
  }
  await db.batch(queries);
}
__name(storeWhatsAppEvents, "storeWhatsAppEvents");

// src/modules/whatsapp/bridge-ingress.ts
var LIMIT = 64 * 1024;
var WINDOW_SECONDS = 300;
function reply(status, message) {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
__name(reply, "reply");
function plainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
__name(plainObject, "plainObject");
function base64Key(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const out = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return out.byteLength === 32 ? out : null;
  } catch {
    return null;
  }
}
__name(base64Key, "base64Key");
function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hex, "hex");
function constantTimeMatch(a, b) {
  let diff = a.byteLength ^ b.byteLength;
  for (let i = 0; i < Math.max(a.byteLength, b.byteLength); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
__name(constantTimeMatch, "constantTimeMatch");
function signedBridgeBytes(bridgeId, timestamp, nonce, rawBody) {
  const header = new TextEncoder().encode(
    ["wa-bridge-v1", bridgeId, timestamp, nonce, ""].join("\n")
  );
  const combined = new Uint8Array(header.byteLength + rawBody.byteLength);
  combined.set(header);
  combined.set(rawBody, header.byteLength);
  return combined;
}
__name(signedBridgeBytes, "signedBridgeBytes");
async function computeBridgeMac(bridgeId, timestamp, nonce, rawBody, keyBytes) {
  const key = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(key).set(keyBytes);
  const webKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const message = signedBridgeBytes(bridgeId, timestamp, nonce, rawBody);
  const buffer = new ArrayBuffer(message.byteLength);
  new Uint8Array(buffer).set(message);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", webKey, buffer)));
}
__name(computeBridgeMac, "computeBridgeMac");
function normalizeBridgeEvents(value, bridgeId, nowSeconds) {
  if (!plainObject(value) || value.version !== 1 || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 20) {
    throw new Error("invalid_bridge_envelope");
  }
  const events = [];
  for (const item of value.events) {
    if (!plainObject(item) || typeof item.messageId !== "string" || !/^[A-Za-z0-9._:/+=-]{1,256}$/.test(item.messageId) || typeof item.chatJid !== "string" || !/^[0-9]{4,25}@(s\.whatsapp\.net|lid)$/.test(item.chatJid) || !Number.isSafeInteger(item.timestamp) || Math.abs(nowSeconds - item.timestamp) > 3600 || item.text !== null && (typeof item.text !== "string" || item.text.length < 1 || item.text.length > 4096)) {
      throw new Error("invalid_bridge_event");
    }
    events.push({
      messageId: item.messageId,
      chatJid: item.chatJid,
      timestamp: item.timestamp,
      text: item.text
    });
  }
  return events;
}
__name(normalizeBridgeEvents, "normalizeBridgeEvents");
async function readBoundedBody(request) {
  if (!request.body) throw new Error("invalid_body");
  const reader = request.body.getReader();
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) break;
      total += value.value.byteLength;
      if (total > LIMIT) {
        await reader.cancel();
        throw new Error("payload_too_large");
      }
      parts.push(value.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error("invalid_body");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of parts) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
__name(readBoundedBody, "readBoundedBody");
async function handleBaileysIngress(request, env, nowSeconds = Math.floor(Date.now() / 1e3)) {
  if (request.method !== "POST") return reply(405, "Method not allowed");
  const bridgeId = env.BAILEYS_BRIDGE_ID;
  const key = env.BAILEYS_BRIDGE_HMAC_KEY && base64Key(env.BAILEYS_BRIDGE_HMAC_KEY);
  const db = env.WHATSAPP_DB;
  if (env.BAILEYS_BRIDGE_INGRESS_ENABLED !== "true" || !bridgeId || !/^[a-z0-9-]{3,64}$/.test(bridgeId) || !key || !db || !env.WHATSAPP_DATA_KEY || env.WHATSAPP_DATA_KEY === env.BAILEYS_BRIDGE_HMAC_KEY || typeof db.prepare !== "function") {
    return reply(503, "Bridge not configured");
  }
  const headerId = request.headers.get("x-bridge-id");
  const timestamp = request.headers.get("x-bridge-timestamp");
  const nonce = request.headers.get("x-bridge-nonce");
  const signature = request.headers.get("x-bridge-signature");
  if (headerId !== bridgeId || !timestamp || !/^[0-9]{10,12}$/.test(timestamp) || Math.abs(Number(timestamp) - nowSeconds) > WINDOW_SECONDS || !nonce || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
    return reply(401, "Unauthorized");
  }
  if (Number(request.headers.get("content-length") ?? "0") > LIMIT) {
    return reply(413, "Payload too large");
  }
  let body;
  try {
    body = await readBoundedBody(request);
  } catch (error) {
    return error instanceof Error && error.message === "payload_too_large" ? reply(413, "Payload too large") : reply(400, "Invalid body");
  }
  const expected = await computeBridgeMac(bridgeId, timestamp, nonce, body, key);
  const expectedBytes = new TextEncoder().encode("sha256=" + expected);
  const actualBytes = new TextEncoder().encode(signature);
  if (!constantTimeMatch(actualBytes, expectedBytes)) return reply(401, "Unauthorized");
  let events;
  try {
    events = normalizeBridgeEvents(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
      bridgeId,
      nowSeconds
    );
  } catch {
    return reply(400, "Invalid payload");
  }
  const bodyBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(bodyBuffer).set(body);
  const bodyHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bodyBuffer)));
  const receipt = {
    bridgeId,
    nonce,
    bodyDigest: bodyHash,
    receivedAt: nowSeconds
  };
  const sameReceipt = /* @__PURE__ */ __name(async () => {
    const previous = await db.prepare(
      "SELECT body_sha256 FROM wa_bridge_receipts WHERE bridge_id=? AND nonce=?"
    ).bind(bridgeId, nonce).first();
    return previous ? previous.body_sha256 === bodyHash : null;
  }, "sameReceipt");
  try {
    const previous = await sameReceipt();
    if (previous === true) return reply(200, "OK");
    if (previous === false) return reply(409, "Replay conflict");
    const normalized = [];
    for (const event of events) {
      const identifier = new TextEncoder().encode(
        [bridgeId, event.chatJid, event.messageId].join("\n")
      );
      const idBuffer = new ArrayBuffer(identifier.byteLength);
      new Uint8Array(idBuffer).set(identifier);
      const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", idBuffer)));
      normalized.push({
        id: "bridge-" + digest,
        from: event.chatJid,
        phoneNumberId: "bridge-" + bridgeId,
        timestamp: event.timestamp,
        type: event.text === null ? "unsupported" : "text",
        text: event.text
      });
    }
    await storeWhatsAppEvents(normalized, env, receipt);
    return reply(200, "OK");
  } catch {
    try {
      const previous = await sameReceipt();
      if (previous === true) return reply(200, "OK");
      if (previous === false) return reply(409, "Replay conflict");
    } catch {
    }
    return reply(503, "Temporarily unavailable");
  }
}
__name(handleBaileysIngress, "handleBaileysIngress");

// src/whatsapp-staging.ts
var responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};
function answer(text, status, type = "text/plain; charset=utf-8") {
  return new Response(text, { status, headers: { ...responseHeaders, "content-type": type } });
}
__name(answer, "answer");
var whatsapp_staging_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET") return answer("Method not allowed", 405);
      return answer(JSON.stringify({
        service: "meta-master-whatsapp-staging",
        phase: "synthetic-ingress",
        whatsapp_linked: false,
        agent_enabled: false
      }), 200, "application/json; charset=utf-8");
    }
    if (url.pathname === "/internal/whatsapp/baileys") {
      return handleBaileysIngress(request, env);
    }
    return answer("Not found", 404);
  }
};
export {
  whatsapp_staging_default as default
};
//# sourceMappingURL=whatsapp-staging.js.map
