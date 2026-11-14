import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "./doctor.js";
import { EncryptedSpool } from "./spool.js";

const localKey = Buffer.alloc(32, 35).toString("base64url");

test("offline doctor works with no session and no secrets, without connecting", async () => {
  const root = await mkdtemp(join(tmpdir(), "baileys-doctor-"));
  try {
    const status = await doctor({
      BAILEYS_SESSION_DIR: join(root, "session"),
      BAILEYS_SPOOL_DIR: join(root, "queue"),
      BAILEYS_ENABLE: "false",
      BAILEYS_ALLOWED_JIDS: "",
    });
    assert.equal(status.mode, "off");
    assert.equal(status.session_credentials_present, false);
    assert.equal(status.session_lock, "unlocked");
    assert.equal(status.spool, null);
    assert.equal(status.transport_configured, false);
    assert.equal(status.pairing_permitted, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("offline doctor reports only aggregate encrypted spool counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "baileys-doctor-"));
  const directory = join(root, "sealed");
  try {
    const queue = new EncryptedSpool(directory, localKey);
    await queue.initialize();
    await queue.enqueue({
      chatJid: "27831234567@s.whatsapp.net",
      messageId: "test-1",
      timestamp: 1,
      text: "Private customer message",
    });
    const report = await doctor({
      BAILEYS_SPOOL_DIR: directory,
      BAILEYS_SPOOL_KEY: localKey,
      BAILEYS_SESSION_DIR: join(root, "not-paired"),
      BAILEYS_ENABLE: "false",
      BAILEYS_ALLOWED_JIDS: "27831234567@s.whatsapp.net",
    });
    assert.equal(report.spool_key_configured, true);
    assert.deepEqual(report.spool, {pending: 1, expired: 1, damaged: 0});
    assert.equal(report.allowlisted_individual_chats, 1);
    const summary = JSON.stringify(report);
    assert.ok(!summary.includes("27831234567"));
    assert.ok(!summary.includes("Private customer message"));
    assert.ok(!summary.includes(localKey));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale-lock recovery requires operator flag and refuses implicit deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "baileys-doctor-"));
  try {
    await chmod(root, 0o700);
    await assert.rejects(
      doctor({ BAILEYS_SESSION_DIR: root }, ["--clear-stale-lock"]),
      /recovery_requires_explicit_confirmation/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
