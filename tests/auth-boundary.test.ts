import { describe, expect, it } from "vitest";
import worker from "../src/index";

const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

describe("M0 MCP fail-closed contract", () => {
  for (const method of methods) {
    it(`rejects ${method} without executing any MCP tool`, async () => {
      const response = await worker.fetch(
        new Request("https://example.test/mcp?access_token=DO_NOT_LEAK", {
          method,
          headers: {
            authorization: "Bearer ALSO_DO_NOT_LEAK",
            "x-approval": "true",
          },
        }),
        {},
      );
      const body = await response.text();
      expect(response.status).toBe(503);
      expect(body).toContain("mcp_not_configured");
      expect(body).not.toContain("DO_NOT_LEAK");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  }

  it("does not offer unimplemented OAuth or provider endpoints", async () => {
    for (const path of ["/oauth/token", "/oauth/callback", "/authorize", "/graphql", "/api/graph"]) {
      const response = await worker.fetch(new Request(`https://example.test${path}`), {});
      expect(response.status).toBe(404);
    }
  });

  it("returns a constant error for unknown paths", async () => {
    const response = await worker.fetch(new Request("https://example.test/no?secret=LEAK"), {});
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});
