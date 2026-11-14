import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { assertSupportedHost } from "./runtime.js";
import { EncryptedSpool } from "./spool.js";
import { acquireSessionLock } from "./session-lock.js";
import { access, chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  forwardObservedMessage,
  normalizeBaileysMessage,
  validateTransport,
} from "./transport.js";

/**
 * Local, opt-in, observation-only WhatsApp connector.
 * No outbound WhatsApp send call or AI processing exists in this process.
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
  if (process.env.BAILEYS_BRIDGE_HMAC_KEY === process.env.BAILEYS_SPOOL_KEY) {
    throw new Error("bridge_and_spool_keys_must_be_distinct");
  }
  process.umask(0o077);
  const spoolDirectory = process.env.BAILEYS_SPOOL_DIR ??
    join(homedir(), ".local", "share", "meta-master-baileys-spool");
  const spool = new EncryptedSpool(spoolDirectory, process.env.BAILEYS_SPOOL_KEY ?? "");
  await spool.initialize();

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

  // Lock the Signal auth folder, not the event spool, to prevent simultaneous
  // sockets from using the same WhatsApp credentials even with different queues.
  const lock = await acquireSessionLock(session);
  let stopping = false;
  let generation = 0;
  let socket: ReturnType<typeof makeWASocket> | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let work: Promise<void> = Promise.resolve();
  let credentialWrites: Promise<void> = Promise.resolve();

  function scheduleWork(action: () => Promise<void>): void {
    if (stopping) return;
    work = work.then(action, action).catch(() => {
      console.error("Encrypted local spool failure. Run the offline doctor and check disk health.");
    });
  }

  function drain(): void {
    scheduleWork(async () => {
      const result = await spool.flush(message => forwardObservedMessage(message, transport));
      if (result.expired) {
        console.error("Encrypted pending events are too old for the gateway; manual review required.");
      }
      if (result.pending >= 1000) {
        console.error("Encrypted event queue is full; no additional events can be accepted.");
      }
    });
  }

  async function shutdown(exitCode = 0): Promise<void> {
    if (stopping) return;
    stopping = true;
    generation++;
    if (retryTimer) clearInterval(retryTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try { socket?.end(new Error("Local bridge stopping")); } catch { /* Already closed. */ }
    await Promise.allSettled([work, credentialWrites]);
    try {
      await lock.release();
    } catch {
      console.error("Could not release session lock safely. Inspect the offline doctor.");
      exitCode = 1;
    }
    process.exit(exitCode);
  }

  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });

  async function connect(attempt: number): Promise<void> {
    if (stopping) return;
    const currentGeneration = ++generation;
    const { state, saveCreds } = await useMultiFileAuthState(session);
    if (stopping || currentGeneration !== generation) return;
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
    });
    socket = sock;
    let disconnected = false;
    const current = () => !stopping && !disconnected &&
      currentGeneration === generation;

    sock.ev.on("creds.update", () => {
      if (!current()) return;
      // Auth writes must not race each other or a graceful shutdown.
      credentialWrites = credentialWrites.then(saveCreds).catch(() => {
        console.error("Could not persist WhatsApp session credentials; stopping.");
        void shutdown(1);
      });
    });
    sock.ev.on("connection.update", update => {
      if (!current()) return;
      if (update.qr) {
        if (allowPairing) {
          // Display only on this local terminal, never forward or log the QR.
          qrcode.generate(update.qr, { small: true });
        } else {
          console.error("Unexpected pairing request refused by local configuration.");
          void shutdown(1);
          return;
        }
      }
      if (update.connection === "open") {
        attempt = 0; // Reset reconnect budget only after an actual connection.
        console.info("Baileys linked; observation-only mode, allowlisted chats.");
      }
      if (update.connection === "close") {
        disconnected = true;
        const reason = (update.lastDisconnect?.error as {
          output?: { statusCode?: number };
        } | undefined)?.output?.statusCode;
        if (reason === DisconnectReason.loggedOut) {
          console.error("Linked device logged out. Will not automatically re-pair.");
          void shutdown(1);
          return;
        }
        const nextAttempt = attempt + 1;
        if (nextAttempt > 5) {
          console.error("Reconnect limit reached; stop instead of looping forever.");
          void shutdown(1);
          return;
        }
        scheduleReconnect(nextAttempt);
      }
    });
    sock.ev.on("messages.upsert", event => {
      if (!current() || event.type !== "notify") return; // No history backfill.
      for (const raw of event.messages) {
        const message = normalizeBaileysMessage(raw, allowed);
        if (!message) continue; // No own messages, unknown chats, groups or statuses.
        scheduleWork(async () => {
          await spool.enqueue(message); // Fsync encrypted event before HTTP.
          const result = await spool.flush(item => forwardObservedMessage(item, transport));
          if (result.deferred) {
            console.error("Cloudflare unavailable; encrypted events retained for retry.");
          }
        });
      }
    });
  }

  function scheduleReconnect(attempt: number): void {
    if (stopping || reconnectTimer) return;
    const delay = Math.min(30_000, 2000 * 2 ** (attempt - 1));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect(attempt).catch(() => {
        console.error("Baileys connection failed; retrying within bounded limit.");
        if (attempt >= 5) void shutdown(1);
        else scheduleReconnect(attempt + 1);
      });
    }, delay);
  }

  retryTimer = setInterval(drain, 15_000);
  retryTimer.unref();
  drain();
  try {
    await connect(0);
  } catch {
    console.error("Initial connection could not be established.");
    await shutdown(1);
  }
}

void main().catch(() => {
  console.error("Baileys bridge did not start. Verify private configuration or run the offline doctor.");
  process.exitCode = 1;
});
