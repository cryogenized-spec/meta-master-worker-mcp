import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSupportedHost } from "./runtime.js";

test("local linked-device prototype remains permitted by default", () => {
  assert.doesNotThrow(() => assertSupportedHost({}));
  assert.doesNotThrow(() => assertSupportedHost({ BAILEYS_HOST_MODE: "local" }));
});
test("Cloudflare Container cannot pair without a durable auth-state adapter", () => {
  assert.throws(
    () => assertSupportedHost({ BAILEYS_HOST_MODE: "cloudflare-container" }),
    /remote_session_backend_not_implemented/,
  );
  assert.throws(
    () => assertSupportedHost({ BAILEYS_HOST_MODE: "unexpected" }),
    /remote_session_backend_not_implemented/,
  );
});
