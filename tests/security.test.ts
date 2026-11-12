import { describe, expect, it } from "vitest";
import { publicFailure, safeEvent } from "../src/security/safe-logging";

describe("safe event contracts", () => {
  it("only includes a fixed set of non-sensitive fields", () => {
    expect(Object.keys(safeEvent("security.mcp_disabled", "denied")).sort()).toEqual([
      "event", "outcome", "service",
    ]);
  });

  it("never exposes internal error or credential strings", () => {
    const secret = "Bearer TEST_DO_NOT_LEAK";
    const providerError = new Error(`Meta returned invalid token ${secret}`);
    expect(JSON.stringify(publicFailure(providerError))).not.toContain(secret);
    expect(publicFailure()).toEqual({ error: "internal_error" });
  });
});
