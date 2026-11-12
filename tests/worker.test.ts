import { describe, expect, it } from "vitest";
import worker from "../src/index";

const request = (path: string, method = "GET") =>
  worker.fetch(new Request(`https://example.test${path}`, { method }), {});

describe("M0 Worker safety boundary", () => {
  it("reports M0 status without claiming Meta connectivity", async () => {
    const response = await request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "ok",
      phase: "M0",
      meta_connected: false,
      mcp_enabled: false,
    });
  });

  it("rejects health-check writes", async () => {
    const response = await request("/health", "POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it.each(["GET", "POST"])("keeps /mcp disabled for %s", async method => {
    const response = await request("/mcp", method);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "mcp_not_configured",
    });
  });

  it("does not expose unknown paths", async () => {
    const response = await request("/anything");
    expect(response.status).toBe(404);
  });
});
