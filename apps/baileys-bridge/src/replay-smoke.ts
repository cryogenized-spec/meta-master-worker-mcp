import { randomBytes, randomUUID } from "node:crypto";
import {
  signBridgeEvent, validateTransport,
  type NormalizedBridgeMessage, type TransportSettings,
} from "./transport.js";

/**
 * Synthetic-only acceptance check for the authenticated Worker gateway.
 * This NEVER imports Baileys, connects WhatsApp, reads chats, or sends replies.
 * One fresh fake D1 event is intentionally created on successful execution.
 */
export async function runReplayAcceptance(
  settings: TransportSettings,
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ initial: number; duplicate: number; conflict: number }> {
  const message: NormalizedBridgeMessage = {
    messageId: "replay-smoke-" + randomUUID(),
    chatJid: "279999999999@s.whatsapp.net",
    timestamp: nowSeconds,
    text: "Synthetic replay acceptance test; no actual customer or WhatsApp chat.",
  };
  const nonce = randomBytes(24).toString("base64url");
  const timestamp = String(nowSeconds);
  const first = signBridgeEvent(message, settings, timestamp, nonce);
  const different = signBridgeEvent({
    ...message,
    text: "Changed synthetic payload using the same signed nonce.",
  }, settings, timestamp, nonce);

  async function send(
    signed: ReturnType<typeof signBridgeEvent>,
  ): Promise<number> {
    const body = new ArrayBuffer(signed.body.byteLength);
    new Uint8Array(body).set(signed.body);
    const response = await fetcher(settings.endpoint, {
      method: "POST",
      headers: signed.headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    return response.status;
  }

  // Reusing a signed body and nonce should be acknowledged idempotently.
  const initial = await send(first);
  if (initial !== 200) throw new Error("replay_smoke_first_event_rejected");
  const duplicate = await send(first);
  if (duplicate !== 200) throw new Error("replay_smoke_duplicate_not_idempotent");
  // A different, correctly signed body using the same nonce must be blocked.
  const conflict = await send(different);
  if (conflict !== 409) throw new Error("replay_smoke_nonce_conflict_not_rejected");
  return { initial, duplicate, conflict };
}

if (process.argv[1]?.endsWith("/replay-smoke.js")) {
  if (process.env.BAILEYS_REPLAY_SMOKE_SEND !== "true") {
    console.info("Synthetic replay smoke test disabled (default). No request made.");
  } else {
    void (async () => {
      const endpoint = process.env.BAILEYS_BRIDGE_URL ?? "";
      const url = new URL(endpoint);
      if (url.protocol !== "https:" ||
          url.hostname !== "meta-master-whatsapp-gateway-staging.cryogenized.workers.dev" ||
          url.pathname !== "/internal/whatsapp/baileys") {
        throw new Error("replay_smoke_requires_exact_staging_endpoint");
      }
      const settings = validateTransport(
        endpoint,
        process.env.BAILEYS_BRIDGE_ID ?? "",
        process.env.BAILEYS_BRIDGE_HMAC_KEY ?? "",
      );
      const result = await runReplayAcceptance(settings);
      console.info("Replay acceptance passed: " + JSON.stringify(result));
      console.info("Only one synthetic event may have been stored. No WhatsApp or AI calls.");
    })().catch(() => {
      console.error("Replay acceptance failed. No WhatsApp connection was attempted.");
      process.exitCode = 1;
    });
  }
}
