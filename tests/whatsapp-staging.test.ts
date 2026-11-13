import { describe, expect, it } from "vitest";
import worker from "../src/whatsapp-staging";

describe("Dedicated free-tier WhatsApp staging entrypoint", () => {
  it("exposes only public non-sensitive health metadata", async () => {
    const response = await worker.fetch(
      new Request("https://staging.example/health"), {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "meta-master-whatsapp-staging",
      phase: "synthetic-ingress",
      whatsapp_linked: false,
      agent_enabled: false,
    });
  });
  it("does not expose unrelated OAuth, Meta, administration, or MCP routes", async () => {
    for (const path of ["/mcp","/oauth/callback","/webhooks/whatsapp",
      "/admin","/internal/messages","/"]) {
      const response = await worker.fetch(
        new Request("https://staging.example"+path), {},
      );
      expect(response.status, path).toBe(404);
    }
  });
  it("keeps signed ingress unavailable without private bridge secrets and D1", async () => {
    const response = await worker.fetch(
      new Request("https://staging.example/internal/whatsapp/baileys",{
        method:"POST",body:"{}",
      }), {},
    );
    expect(response.status).toBe(503);
  });
});
