import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { clearStaleSessionLock, inspectSessionLock } from "./session-lock.js";
import { EncryptedSpool } from "./spool.js";
import { validateTransport } from "./transport.js";

/**
 * Offline-only status probe. Never connects, retrieves chats or prints
 * secrets, phone numbers or message contents.
 */
export async function doctor(
  env: NodeJS.ProcessEnv = process.env,
  args: readonly string[] = [],
): Promise<{
  mode: string;
  pairing_permitted: boolean;
  allowlisted_individual_chats: number;
  transport_configured: boolean;
  session_credentials_present: boolean;
  session_directory_private: boolean | null;
  session_lock: string;
  spool_key_configured: boolean;
  spool: { pending: number; expired: number; damaged: number } | null;
}> {
  const session = env.BAILEYS_SESSION_DIR ??
    join(homedir(), ".local", "share", "meta-master-baileys");
  const spoolDir = env.BAILEYS_SPOOL_DIR ??
    join(homedir(), ".local", "share", "meta-master-baileys-spool");
  const allowed = (env.BAILEYS_ALLOWED_JIDS ?? "")
    .split(",").map(x => x.trim()).filter(x => /^[0-9]{4,25}@(s\.whatsapp\.net|lid)$/.test(x));
  let transportConfigured = false;
  try {
    validateTransport(env.BAILEYS_BRIDGE_URL ?? "",
      env.BAILEYS_BRIDGE_ID ?? "", env.BAILEYS_BRIDGE_HMAC_KEY ?? "");
    transportConfigured = true;
  } catch { /* Configuration only; do not log secret details. */ }

  let sessionDirectoryPrivate: boolean | null = null;
  try {
    const st = await stat(session);
    sessionDirectoryPrivate = st.isDirectory() && (st.mode & 0o077) === 0;
  } catch { /* Session has not been created. */ }

  let credsPresent = false;
  try { await access(join(session, "creds.json")); credsPresent = true; }
  catch { /* Account has not been paired. */ }

  let lock = await inspectSessionLock(session);
  if (args.includes("--clear-stale-lock")) {
    if (!args.includes("--confirm-session-not-running")) {
      throw new Error("recovery_requires_explicit_confirmation");
    }
    await clearStaleSessionLock(session);
    lock = await inspectSessionLock(session);
  }

  let spool: { pending: number; expired: number; damaged: number } | null = null;
  let spoolKeyConfigured = false;
  try {
    if (env.BAILEYS_SPOOL_KEY &&
        env.BAILEYS_SPOOL_KEY !== env.BAILEYS_BRIDGE_HMAC_KEY) {
      const queue = new EncryptedSpool(spoolDir, env.BAILEYS_SPOOL_KEY);
      spoolKeyConfigured = true;
      try {
        await stat(spoolDir);
        // Read-only inspection: do not create or mutate the queue directory.
        spool = await queue.inspect();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.message === "invalid_spool_key")) throw error;
  }

  return {
    mode: env.BAILEYS_ENABLE === "true" ? "enabled" : "off",
    pairing_permitted: env.BAILEYS_ALLOW_PAIRING === "true",
    allowlisted_individual_chats: new Set(allowed).size,
    transport_configured: transportConfigured,
    session_credentials_present: credsPresent,
    session_directory_private: sessionDirectoryPrivate,
    session_lock: lock,
    spool_key_configured: spoolKeyConfigured,
    spool,
  };
}

if (process.argv[1]?.endsWith("/doctor.js")) {
  void doctor(process.env, process.argv.slice(2)).then(report => {
    console.info(JSON.stringify(report, null, 2));
  }).catch(() => {
    console.error("Baileys offline doctor failed; inspect private configuration and local filesystem.");
    process.exitCode = 1;
  });
}
