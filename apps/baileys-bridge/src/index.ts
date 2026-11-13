import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { assertSupportedHost } from "./runtime.js";
import { access, chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  forwardObservedMessage,
  normalizeBaileysMessage,
  validateTransport,
} from "./transport.js";

/**
 * Prototype. NEVER connects by default, NEVER calls sock.sendMessage(),
 * and NEVER forwards chats outside BAILEYS_ALLOWED_JIDS.
 * The sole output is an authenticated encrypted-inbox ingest request.
 */
async function main(): Promise<void> {
  if (process.env.BAILEYS_ENABLE !== "true") {
    console.info("Baileys bridge disabled (default). No connection attempted.");
    return;
  }

  assertSupportedHost(process.env);

  const allowed = new Set(
    (process.env.BAILEYS_ALLOWED_JIDS ?? "").split(",").map(v => v.trim()).filter(Boolean),
  );
  if (allowed.size === 0 ||
      [...allowed].some(jid => !/^[0-9]{4,25}@(s\.whatsapp\.net|lid)$/.test(jid))) {
    throw new Error("BAILEYS_ALLOWED_JIDS must list explicit individual chat IDs");
  }

  const transport = validateTransport(
    process.env.BAILEYS_BRIDGE_URL ?? "",
    process.env.BAILEYS_BRIDGE_ID ?? "",
    process.env.BAILEYS_BRIDGE_HMAC_KEY ?? "",
  );
  process.umask(0o077);
  const session = process.env.BAILEYS_SESSION_DIR ??
    join(homedir(), ".local", "share", "meta-master-baileys");
  const allowPairing = process.env.BAILEYS_ALLOW_PAIRING === "true";
  if (!allowPairing) {
    try {
      await access(join(session, "creds.json"));
    } catch {
      throw new Error("No saved session; pairing is disabled. Nothing connected.");
    }
  }
  await mkdir(session, { recursive: true, mode: 0o700 });
  await chmod(session, 0o700);

  async function connect(attempt = 0): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(session);
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
    });

    sock.ev.on("creds.update", () => {
      void saveCreds().catch(() => console.error("Could not persist session credentials."));
    });

    sock.ev.on("connection.update", update => {
      if (update.qr) {
        if (allowPairing) {
          // Display only on the local terminal, never forward or log the QR.
          qrcode.generate(update.qr, { small: true });
        } else {
          console.error("A new pairing request was rejected by local configuration.");
        }
      }
      if (update.connection === "open") {
        console.info("Baileys linked; observation-only mode, allowlisted chats.");
      }
      if (update.connection === "close") {
        const reason = (update.lastDisconnect?.error as {
          output?: { statusCode?: number };
        } | undefined)?.output?.statusCode;
        if (reason === DisconnectReason.loggedOut) {
          console.error("Linked device was logged out. No automatic re-pairing.");
          return;
        }
        if (attempt >= 5) {
          console.error("Reconnect limit reached; stopping instead of looping.");
          return;
        }
        // Bounded backoff, never log transport exceptions or message content.
        const delay = Math.min(30_000, 2_000 * 2 ** attempt);
        setTimeout(() => {
          void connect(attempt + 1).catch(() => {
            console.error("Baileys could not reconnect.");
          });
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", event => {
      if (event.type !== "notify") return; // no history backfill
      for (const raw of event.messages) {
        const message = normalizeBaileysMessage(raw, allowed);
        if (!message) continue; // ignore self, groups, statuses and other chats
        void forwardObservedMessage(message, transport).catch(() => {
          // No personal message content or JID is emitted to logs.
          console.error("Signed inbox delivery failed; check local transport status.");
        });
      }
    });
  }

  await connect();
}

void main().catch(() => {
  console.error("Baileys bridge did not start. Verify the private configuration.");
  process.exitCode = 1;
});
