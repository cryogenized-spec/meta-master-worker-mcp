import { randomUUID } from "node:crypto";
import {
  forwardObservedMessage, validateTransport,
} from "./transport.js";

/**
 * Synthetic-only private ingress acceptance test.
 * No Baileys socket or WhatsApp account is used; no customer is contacted.
 * Running without explicit BAILEYS_SMOKE_SEND=true does nothing.
 */
async function main(): Promise<void> {
  if (process.env.BAILEYS_SMOKE_SEND !== "true") {
    console.info("Synthetic ingress smoke test disabled (default).");
    return;
  }
  const config = validateTransport(
    process.env.BAILEYS_BRIDGE_URL ?? "",
    process.env.BAILEYS_BRIDGE_ID ?? "",
    process.env.BAILEYS_BRIDGE_HMAC_KEY ?? "",
  );
  const message = {
    messageId: "smoke-" + randomUUID(),
    chatJid: "999999999999@s.whatsapp.net",
    timestamp: Math.floor(Date.now() / 1000),
    text: "Synthetic staging ingress verification only; no real customer.",
  };
  await forwardObservedMessage(message, config);
  console.info("Signed synthetic event accepted by staging Worker. No WhatsApp connection or reply.");
}

void main().catch(() => {
  console.error("Staging ingress smoke test failed; no customer messages were sent.");
  process.exitCode = 1;
});
