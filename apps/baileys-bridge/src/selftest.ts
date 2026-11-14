import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedSpool } from "./spool.js";
import {
  forwardObservedMessage, normalizeBaileysMessage, validateTransport,
} from "./transport.js";

/**
 * Full offline rehearsal using invented contact/message data.
 * Does NOT create a WhatsApp socket or perform an actual HTTP request.
 */
export async function runOfflineSelfTest(): Promise<{
  observed: number;
  failed_delivery_preserved: boolean;
  successful_delivery_removed: boolean;
  signed_request_valid: boolean;
}> {
  const dir = await mkdtemp(join(tmpdir(), "baileys-selftest-"));
  await chmod(dir, 0o700);
  try {
    const now = Math.floor(Date.now() / 1000);
    const contact = "279999999999@s.whatsapp.net"; // Synthetic identifier only.
    const message = normalizeBaileysMessage({
      key: { remoteJid: contact, id: "OFFLINE-SELFTEST-0001", fromMe: false },
      messageTimestamp: now,
      message: { conversation: "Synthetic offline test. Not a real WhatsApp chat." },
    }, new Set([contact]), now);
    if (!message) throw new Error("selftest_filter_rejected");
    const spool = new EncryptedSpool(dir, randomBytes(32).toString("base64url"));
    await spool.initialize();
    await spool.enqueue(message);
    const transport = validateTransport(
      "http://127.0.0.1/internal/whatsapp/baileys",
      "offline-selftest",
      randomBytes(32).toString("base64url"),
    );

    let calls = 0;
    let signedValid = false;
    const fetcher: typeof fetch = async (_input, init) => {
      calls++;
      if (!init || !init.headers || !init.body) throw new Error("invalid_test_request");
      const headers = new Headers(init.headers);
      const timestamp = headers.get("x-bridge-timestamp");
      const nonce = headers.get("x-bridge-nonce");
      if (!timestamp || !nonce) throw new Error("missing_signature_inputs");
      const body = Buffer.from(init.body as ArrayBuffer);
      const prefix = ["wa-bridge-v1", transport.bridgeId, timestamp, nonce, ""].join("\n");
      const mac = createHmac("sha256", transport.key)
        .update(prefix).update(body).digest("hex");
      signedValid = headers.get("x-bridge-signature") === "sha256=" + mac &&
        JSON.parse(body.toString("utf8")).events[0].messageId === message.messageId;
      if (!signedValid) throw new Error("invalid_test_signature");
      return new Response("OK", { status: calls === 1 ? 503 : 200 });
    };
    const failed = await spool.flush(
      item => forwardObservedMessage(item, transport, fetcher), now,
    );
    const preserved = failed.pending === 1 && failed.deferred === 1;
    const recovered = await spool.flush(
      item => forwardObservedMessage(item, transport, fetcher), now,
    );
    const removed = recovered.delivered === 1 && await spool.count() === 0;
    if (!preserved || !removed || !signedValid || calls !== 2) {
      throw new Error("offline_pipeline_selftest_failed");
    }
    return {
      observed: 1,
      failed_delivery_preserved: preserved,
      successful_delivery_removed: removed,
      signed_request_valid: signedValid,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("/selftest.js")) {
  void runOfflineSelfTest().then(report => {
    console.info("Offline Baileys pipeline passed: " + JSON.stringify(report));
    console.info("No WhatsApp account linked. No actual HTTP or outgoing chat message.");
  }).catch(() => {
    console.error("Offline Baileys pipeline test failed.");
    process.exitCode = 1;
  });
}
