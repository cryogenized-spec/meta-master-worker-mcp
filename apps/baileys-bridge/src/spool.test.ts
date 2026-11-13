import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EncryptedSpool, decodeSpoolKey } from "./spool.js";

const testKey = Buffer.alloc(32, 27).toString("base64url");
const now = 1794560000;
const message = {
  messageId: "BAILEYS-plain-001",
  chatJid: "27831234567@s.whatsapp.net",
  timestamp: now,
  text: "A private example that must never appear in a local queue file",
};

async function withSpool(fn: (spool: EncryptedSpool, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "wa-spool-test-"));
  await chmod(dir, 0o700);
  const spool = new EncryptedSpool(dir, testKey);
  try {
    await spool.initialize();
    await fn(spool, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("rejects incomplete spool keys and relative queue directories", () => {
  assert.throws(() => decodeSpoolKey("bad"), /invalid_spool_key/);
  assert.throws(() => new EncryptedSpool("./relative", testKey), /spool_directory_must_be_absolute/);
});

test("durably encrypts private content and contact before write", async () => {
  await withSpool(async (spool, dir) => {
    assert.equal(await spool.enqueue(message), true);
    const files = (await readdir(dir)).filter(v => v.endsWith(".sealed"));
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f]{64}\.sealed$/);
    assert.ok(!files[0].includes(message.messageId));
    const bytes = await readFile(join(dir, files[0]));
    assert.ok(!bytes.toString("utf8").includes(message.text));
    assert.ok(!bytes.toString("utf8").includes(message.chatJid));
    assert.equal(bytes[0], 1);
    const restored = await spool.read(files[0].slice(0, -".sealed".length));
    assert.deepEqual(restored.message, message);
  });
});

test("survives process restart, suppresses duplicate enqueue and removes only acknowledged messages", async () => {
  await withSpool(async (spool, dir) => {
    assert.equal(await spool.enqueue(message), true);
    assert.equal(await spool.enqueue(message), false);
    assert.equal(await spool.count(), 1);
    const afterRestart = new EncryptedSpool(dir, testKey);
    await afterRestart.initialize();
    let received = 0;
    const result = await afterRestart.flush(async m => {
      received++;
      assert.deepEqual(m, message);
    }, now);
    assert.equal(received, 1);
    assert.deepEqual(result, { delivered: 1, deferred: 0, expired: 0, pending: 0 });
    assert.equal(await afterRestart.count(), 0);
  });
});

test("network failure retains encrypted message for next delivery attempt", async () => {
  await withSpool(async spool => {
    await spool.enqueue(message);
    const failed = await spool.flush(async () => { throw new Error("network offline"); }, now);
    assert.deepEqual(failed, { delivered: 0, deferred: 1, expired: 0, pending: 1 });
    let delivered = 0;
    const recovered = await spool.flush(async () => { delivered++; }, now + 30);
    assert.equal(delivered, 1);
    assert.deepEqual(recovered, { delivered: 1, deferred: 0, expired: 0, pending: 0 });
  });
});

test("stale events remain encrypted for manual review; never silently discarded", async () => {
  await withSpool(async spool => {
    await spool.enqueue(message);
    let called = false;
    const result = await spool.flush(async () => { called = true; }, now + 3601);
    assert.equal(called, false);
    assert.deepEqual(result, { delivered: 0, deferred: 0, expired: 1, pending: 1 });
  });
});

test("tampering with ciphertext is detected and leaves evidence on disk", async () => {
  await withSpool(async (spool, dir) => {
    await spool.enqueue(message);
    const file = (await readdir(dir)).find(f => f.endsWith(".sealed"))!;
    const content = await readFile(join(dir, file));
    content[20] ^= 0xff;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, file), content);
    await assert.rejects(
      spool.read(file.slice(0, -".sealed".length)),
    );
    assert.equal(await spool.count(), 1);
  });
});

test("unsafe queue-directory permissions are rejected", async () => {
  await withSpool(async (spool, dir) => {
    await chmod(dir, 0o755);
    await assert.rejects(spool.initialize(), /spool_directory_permissions_unsafe/);
    await chmod(dir, 0o700);
  });
});
