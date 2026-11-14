import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSessionLock, clearStaleSessionLock, inspectSessionLock } from "./session-lock.js";

async function privateTemp(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "wa-session-test-"));
  await chmod(directory, 0o700);
  try { await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("exclusive session lock prevents a second process from opening the same auth directory", async () => {
  await privateTemp(async directory => {
    assert.equal(await inspectSessionLock(directory), "unlocked");
    const first = await acquireSessionLock(directory);
    assert.equal(await inspectSessionLock(directory), "active");
    await assert.rejects(acquireSessionLock(directory), /bridge_session_lock_exists_run_doctor/);
    await first.release();
    await first.release();
    assert.equal(await inspectSessionLock(directory), "unlocked");
    const again = await acquireSessionLock(directory);
    await again.release();
  });
});

test("session lock does not remove files it no longer owns", async () => {
  await privateTemp(async directory => {
    const acquired = await acquireSessionLock(directory);
    const file = join(directory, ".bridge-active.lock");
    const original = JSON.parse(await readFile(file, "utf8")) as {token: string};
    await writeFile(file, JSON.stringify({ ...original, token: "f".repeat(48) }));
    await assert.rejects(acquired.release(), /bridge_lock_ownership_lost/);
  });
});

test("operator must explicitly confirm stale-lock recovery, never clear an active process", async () => {
  await privateTemp(async directory => {
    const active = await acquireSessionLock(directory);
    await assert.rejects(clearStaleSessionLock(directory), /bridge_lock_not_verifiably_stale/);
    await active.release();
    await writeFile(join(directory, ".bridge-active.lock"),
      JSON.stringify({pid: 2147483647, token: "a".repeat(48), createdAt: 1}), { mode: 0o600 });
    assert.equal(await inspectSessionLock(directory), "stale");
    assert.equal(await clearStaleSessionLock(directory), true);
    assert.equal(await inspectSessionLock(directory), "unlocked");
  });
});

test("reject group-accessible Signal session directory", async () => {
  await privateTemp(async directory => {
    await chmod(directory, 0o750);
    await assert.rejects(acquireSessionLock(directory), /session_directory_permissions_unsafe/);
  });
});

test("unreadable or incomplete stale lock is classified as unknown", async () => {
  await privateTemp(async directory => {
    const file = join(directory, ".bridge-active.lock");
    await writeFile(file, "{");
    assert.equal(await inspectSessionLock(directory), "unknown");
    await assert.rejects(clearStaleSessionLock(directory), /bridge_lock_not_verifiably_stale/);
  });
});
