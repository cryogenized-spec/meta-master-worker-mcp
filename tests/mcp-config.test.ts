import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { isMcpResourcePath, isResourceConfigured, type ResourceEnv } from "../src/mcp/config";

const connected = (): ResourceEnv => ({
  MCP_SERVER_URL: "https://meta.example.com/mcp",
  AUTH_SERVER_URL: "https://auth.example.com",
  AUTH_SERVER: {
    validateToken: vi.fn(async () => null),
  } as unknown as NonNullable<ResourceEnv["AUTH_SERVER"]>,
});

describe("M1 configuration boundary", () => {
  it("recognises only the MCP path and OAuth metadata paths", () => {
    expect(isMcpResourcePath("/mcp")).toBe(true);
    expect(isMcpResourcePath("/.well-known/oauth-protected-resource/mcp")).toBe(true);
    expect(isMcpResourcePath("/unknown")).toBe(false);
  });

  it("rejects missing and untrusted configuration", () => {
    expect(isResourceConfigured({})).toBe(false);
    expect(isResourceConfigured(connected())).toBe(true);
    expect(isResourceConfigured({ ...connected(), MCP_SERVER_URL: "http://remote.test/mcp" })).toBe(false);
    expect(isResourceConfigured({ ...connected(), MCP_SERVER_URL: "https://remote.test/other" })).toBe(false);
    expect(isResourceConfigured({ ...connected(), AUTH_SERVER_URL: "https://user:pass@auth.test" })).toBe(false);
  });

  it("blocks all unconfigured MCP methods without leaking bearer strings", async () => {
    for (const method of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) {
      const res = await worker.fetch(
        new Request("https://meta.example.com/mcp?access_token=DO_NOT_ECHO", {
          method,
          headers: { authorization: "Bearer DO_NOT_ECHO" },
        }),
        {},
      );
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain("DO_NOT_ECHO");
    }
  });

  it("does not serve authentication metadata when no auth server is bound", async () => {
    const response = await worker.fetch(
      new Request("https://meta.example.com/.well-known/oauth-protected-resource/mcp"),
      {},
    );
    expect(response.status).toBe(404);
  });
});
