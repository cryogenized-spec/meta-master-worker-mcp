import { test } from "node:test";
import assert from "node:assert/strict";
import { runOfflineSelfTest } from "./selftest.js";

test("entire offline inbound filtering, encrypted spool, HMAC and retry pipeline passes", async () => {
  const result = await runOfflineSelfTest();
  assert.deepEqual(result, {
    observed: 1,
    failed_delivery_preserved: true,
    successful_delivery_removed: true,
    signed_request_valid: true,
  });
});
