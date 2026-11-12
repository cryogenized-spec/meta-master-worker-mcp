/**
 * AES-256-GCM envelope encryption for future Meta OAuth tokens.
 * Key material comes exclusively from a Cloudflare Worker secret.
 * Never log the key, plaintext or underlying Web Crypto exception.
 */
export interface TokenContext {
  operatorId: string;
  connectionId: string;
  platform: "facebook" | "instagram" | "threads" | "messenger" | "whatsapp" | "ads";
}

function contextAAD(ctx: TokenContext): Uint8Array {
  if (!ctx.operatorId || !ctx.connectionId || !ctx.platform) {
    throw new Error("invalid_token_context");
  }
  return new TextEncoder().encode(
    JSON.stringify(["meta-master-mcp", "token-v1", ctx.operatorId, ctx.connectionId, ctx.platform])
  );
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_encoded_secret");
  try {
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new Error("invalid_encoded_secret");
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("missing_encryption_key");
  const bytes = decode(secret);
  if (bytes.length !== 32) throw new Error("invalid_encryption_key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptMetaToken(
  plaintext: string,
  keySecret: string,
  context: TokenContext,
): Promise<string> {
  if (!plaintext) throw new Error("empty_token");
  const key = await importKey(keySecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: contextAAD(context) },
    key,
    data,
  );
  return ["v1", encode(iv), encode(new Uint8Array(ciphertext))].join(".");
}

export async function decryptMetaToken(
  envelope: string,
  keySecret: string,
  context: TokenContext,
): Promise<string> {
  const [version, iv64, cipher64, extra] = envelope.split(".");
  if (version !== "v1" || !iv64 || !cipher64 || extra) throw new Error("invalid_token_envelope");

  const key = await importKey(keySecret);
  try {
    const iv = decode(iv64);
    if (iv.length !== 12) throw new Error("invalid_iv");
    const data = decode(cipher64);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: contextAAD(context) },
      key,
      data,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    // Do not reveal context, key, ciphertext, token or provider internals.
    throw new Error("token_decryption_failed");
  }
}
