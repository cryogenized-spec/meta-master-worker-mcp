import { randomBytes } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const LOCK_FILENAME = ".bridge-active.lock";
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

interface LockRecord {
  pid: number;
  token: string;
  createdAt: number;
}

function validRecord(value: unknown): value is LockRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LockRecord>;
  return Number.isSafeInteger(record.pid) && Number(record.pid) > 0 &&
    typeof record.token === "string" && TOKEN_PATTERN.test(record.token) &&
    Number.isSafeInteger(record.createdAt);
}

function lockPath(directory: string): string {
  return join(directory, LOCK_FILENAME);
}

export type LockStatus = "unlocked" | "active" | "stale" | "unknown";

/**
 * A crash leaves an intentionally visible stale file. Never seize ownership
 * automatically: an alternative Node process might still hold the session.
 */
export async function inspectSessionLock(directory: string): Promise<LockStatus> {
  const path = lockPath(directory);
  let content: string;
  try { content = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "unlocked";
    return "unknown";
  }
  let record: unknown;
  try { record = JSON.parse(content); }
  catch { return "unknown"; }
  if (!validRecord(record)) return "unknown";
  try {
    process.kill(record.pid, 0);
    return "active"; // Includes our own process.
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return "stale";
    // EPERM means an inaccessible but potentially live process: stay cautious.
    return "unknown";
  }
}

export interface SessionLock {
  release(): Promise<void>;
}

/** Prevent two local sockets from sharing and corrupting Signal auth state. */
export async function acquireSessionLock(directory: string): Promise<SessionLock> {
  const info = await stat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new Error("session_directory_permissions_unsafe");
  }
  const path = lockPath(directory);
  const record: LockRecord = {
    pid: process.pid,
    token: randomBytes(24).toString("hex"),
    createdAt: Math.floor(Date.now() / 1000),
  };
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("bridge_session_lock_exists_run_doctor");
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(record), "utf8");
    await handle.sync();
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      // Never remove a lock replaced by an operator or another process.
      let stored: unknown;
      try { stored = JSON.parse(await readFile(path, "utf8")); }
      catch { throw new Error("bridge_lock_missing_or_invalid"); }
      if (!validRecord(stored) || stored.token !== record.token ||
          stored.pid !== record.pid) {
        throw new Error("bridge_lock_ownership_lost");
      }
      await unlink(path);
      released = true;
    },
  };
}

/**
 * Explicit operator recovery only, after verifying that the original PID is
 * absent. No automatic stale-lock deletion on startup or in the doctor tool.
 */
export async function clearStaleSessionLock(directory: string): Promise<boolean> {
  if (await inspectSessionLock(directory) !== "stale") {
    throw new Error("bridge_lock_not_verifiably_stale");
  }
  const path = lockPath(directory);
  const before = await readFile(path, "utf8");
  // Reduce accidental removal if the lock changed while we were inspecting.
  if (before !== await readFile(path, "utf8")) {
    throw new Error("bridge_lock_changed_during_inspection");
  }
  await unlink(path);
  return true;
}
