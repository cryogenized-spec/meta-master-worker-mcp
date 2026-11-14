import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runReplayAcceptance } from "./replay-smoke.js";
import { validateTransport } from "./transport.js";

const settings = validateTransport(
  "https://example.com/internal/whatsapp/baileys",
  "omen-local",
  Buffer.alloc(32, 29).toString("base64url"),
);

test("synthetic replay acceptance checks duplicate, conflict and HMAC without WhatsApp", async () => {
  const seen: Array<{ body: string; nonce: string; signature: string }> = [];
  const fakeFetch: typeof fetch = async (_input, request) => {
    assert.equal(request?.method, "POST");
    const headers = new Headers(request?.headers);
    const body = Buffer.from(request?.body as ArrayBuffer);
    const nonce = headers.get("x-bridge-nonce") ?? "";
    const stamp = headers.get("x-bridge-timestamp") ?? "";
    const mac = createHmac("sha256", settings.key)
      .update(["wa-bridge-v1", settings.bridgeId, stamp, nonce, ""].join("\n"))
      .update(body).digest("hex");
    assert.equal(headers.get("x-bridge-signature"), "sha256=" + mac);
    const decoded = JSON.parse(body.toString("utf8"));
    assert.equal(decoded.events.length, 1);
    assert.equal(decoded.events[0].chatJid, "279999999999@s.whatsapp.net");
    seen.push({body: body.toString("utf8"), nonce, signature: mac});
    return new Response("fake", {status: seen.length === 3 ? 409 : 200});
  };
  assert.deepEqual(await runReplayAcceptance(settings, fakeFetch), {
    initial: 200, duplicate: 200, conflict: 409,
  });
  assert.equal(seen.length, 3);
  assert.equal(seen[0].body, seen[1].body);
  assert.equal(seen[0].signature, seen[1].signature);
  assert.notEqual(seen[0].body, seen[2].body);
  assert.notEqual(seen[0].signature, seen[2].signature);
  assert.equal(seen[0].nonce, seen[2].nonce);
});

test("replay acceptance aborts after a rejected first event", async () => {
  let calls = 0;
  const reject: typeof fetch = async () => {
    calls++;
    return new Response("unavailable", {status: 503});
  };
  await assert.rejects(
    runReplayAcceptance(settings, reject),
    /replay_smoke_first_event_rejected/,
  );
  assert.equal(calls, 1);
});
