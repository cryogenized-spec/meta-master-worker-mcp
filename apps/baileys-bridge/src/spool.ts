import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { link, mkdir, open, readdir, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { NormalizedBridgeMessage } from "./transport.js";

/**
 * Encrypted, bounded, on-disk queue for local development only.
 *
 * A received event is fsynced to disk before network delivery.
 * No WhatsApp send API, raw phone identifiers, or plaintext message bodies
 * are written to filenames or queue files.
 *
 * This is an observation queue, not a production delivery guarantee.
 */
const MAX_PENDING = 1000;
const MAX_BYTES_PER_RECORD = 8192;
const MAX_AGE_FOR_INGRESS_SECONDS = 3600;
const FILE_SUFFIX = ".sealed";
const VERSION = 1;

export interface DrainSummary {
  delivered: number;
  deferred: number;
  expired: number;
  pending: number;
}

export interface SpoolItem {
  id: string;
  message: NormalizedBridgeMessage;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodeSpoolKey(encoded: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error("invalid_spool_key");
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) throw new Error("invalid_spool_key");
  return key;
}

function eventValid(item: unknown): item is SpoolItem {
  if (!isObject(item) || typeof item.id !== "string" ||
      !/^[0-9a-f]{64}$/.test(item.id) || !isObject(item.message)) return false;
  const m = item.message;
  return typeof m.messageId === "string" &&
    /^[A-Za-z0-9._:/+=-]{1,256}$/.test(m.messageId) &&
    typeof m.chatJid === "string" &&
    /^[0-9]{4,25}@(s\.whatsapp\.net|lid)$/.test(m.chatJid) &&
    Number.isSafeInteger(m.timestamp) &&
    (m.text === null ||
      (typeof m.text === "string" && m.text.length > 0 && m.text.length <= 4096));
}

/** Hash chat+message with a PRIVATE key, not with plaintext chat identifiers. */
function messageDigest(message: NormalizedBridgeMessage, key: Buffer): string {
  return createHmac("sha256", key)
    .update("baileys-spool-v1\0")
    .update(message.chatJid).update("\0").update(message.messageId)
    .digest("hex");
}

function seal(item: SpoolItem, key: Buffer): Buffer {
  const plaintext = Buffer.from(JSON.stringify(item), "utf8");
  if (plaintext.byteLength > MAX_BYTES_PER_RECORD) throw new Error("spool_item_too_large");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(item.id, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Version (1 byte), IV (12), ciphertext, GCM tag (16).
  return Buffer.concat([Buffer.from([VERSION]), iv, encrypted, tag]);
}

function unseal(data: Buffer, id: string, key: Buffer): SpoolItem {
  if (data.length < 30 || data.length > MAX_BYTES_PER_RECORD + 64 ||
      data[0] !== VERSION) throw new Error("invalid_spool_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(1, 13));
  decipher.setAAD(Buffer.from(id, "utf8"));
  decipher.setAuthTag(data.subarray(data.length - 16));
  const raw = Buffer.concat([
    decipher.update(data.subarray(13, data.length - 16)), decipher.final(),
  ]);
  const item: unknown = JSON.parse(raw.toString("utf8"));
  if (!eventValid(item) || item.id !== id || messageDigest(item.message, key) !== id) {
    throw new Error("invalid_spool_record");
  }
  return item;
}

/**
 * Each per-message file is written through an exclusive temporary file,
 * fsynced, then atomically renamed into the pending directory.
 * An interrupted temporary file is inert; the next run can clean it up.
 */
export class EncryptedSpool {
  readonly directory: string;
  private readonly key: Buffer;
  private draining = false;

  constructor(directory: string, encodedKey: string) {
    if (!directory || !directory.startsWith("/")) {
      throw new Error("spool_directory_must_be_absolute");
    }
    this.directory = resolve(directory);
    this.key = decodeSpoolKey(encodedKey);
  }

  private path(id: string): string {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("invalid_spool_id");
    return join(this.directory, id + FILE_SUFFIX);
  }

  private async files(): Promise<string[]> {
    const entries = await readdir(this.directory);
    const sealed = entries.filter(e => /^[0-9a-f]{64}\.sealed$/.test(e));
    sealed.sort();
    return sealed;
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await stat(this.directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
      throw new Error("spool_directory_permissions_unsafe");
    }
  }

  async enqueue(message: NormalizedBridgeMessage): Promise<boolean> {
    const id = messageDigest(message, this.key);
    if (!eventValid({ id, message })) throw new Error("invalid_spool_message");
    const path = this.path(id);
    try {
      await stat(path);
      return false; // Already pending: no duplicate.
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if ((await this.files()).length >= MAX_PENDING) throw new Error("spool_full");

    const bytes = seal({ id, message }, this.key);
    const temporary = join(this.directory, "." + id + "-" + randomBytes(8).toString("hex") + ".tmp");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary).catch(() => {});
      throw error;
    }
    await handle.close();

    // Hard-linking publishes the fsynced record atomically without replacing
    // an existing pending record, even if two processes race to enqueue it.
    // The private temp file stays on the same filesystem as the final file.
    let added = false;
    try {
      try {
        await link(temporary, path);
        added = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      // Best effort sync directory metadata; some filesystems don't support it.
      if (added) {
        const parent = await open(dirname(path), "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return added;
  }

  async read(id: string): Promise<SpoolItem> {
    return unseal(await readFile(this.path(id)), id, this.key);
  }

  async count(): Promise<number> {
    return (await this.files()).length;
  }

  /** Read-only inspection for the operator; never prints or returns message content. */
  async inspect(nowSeconds = Math.floor(Date.now() / 1000)): Promise<{
    pending: number; expired: number; damaged: number;
  }> {
    const filenames = await this.files();
    let expired = 0;
    let damaged = 0;
    for (const filename of filenames) {
      const id = filename.slice(0, -FILE_SUFFIX.length);
      try {
        const item = await this.read(id);
        if (nowSeconds - item.message.timestamp > MAX_AGE_FOR_INGRESS_SECONDS) expired++;
      } catch {
        damaged++;
      }
    }
    return { pending: filenames.length, expired, damaged };
  }

  async flush(
    deliver: (message: NormalizedBridgeMessage) => Promise<void>,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<DrainSummary> {
    if (this.draining) return { delivered: 0, deferred: 0, expired: 0, pending: await this.count() };
    this.draining = true;
    let delivered = 0;
    let deferred = 0;
    let expired = 0;
    try {
      for (const filename of await this.files()) {
        const id = filename.slice(0, -FILE_SUFFIX.length);
        // Corrupted ciphertext stays on disk for manual quarantine/recovery;
        // never silently delete confidential message data.
        const item = await this.read(id);
        if (nowSeconds - item.message.timestamp > MAX_AGE_FOR_INGRESS_SECONDS) {
          expired++;
          continue;
        }
        try {
          await deliver(item.message);
          await unlink(this.path(id));
          delivered++;
        } catch {
          deferred++;
          // preserve the event for a later retry; do not disclose message text.
          break;
        }
      }
      return { delivered, deferred, expired, pending: await this.count() };
    } finally {
      this.draining = false;
    }
  }
}
