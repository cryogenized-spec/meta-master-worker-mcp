import { describe, expect, it } from "vitest";
import { isAuthProviderConfigured, type AuthEnv } from "../apps/auth/src/config";
import { authServiceUnavailable, consentUnavailable } from "../apps/auth/src/deny";

const kv = {
  get: async () => null,
  put: async () => undefined,
  delete: async () => undefined,
  list: async () => ({ keys: [], list_complete: true }),
} as unknown as KVNamespace;

const ready = (): AuthEnv => ({
  AUTH_ENABLED: "true",
  ISSUER: "https://auth.example.org/",
  MCP_SERVER_URL: "https://mcp.example.org/mcp",
  OAUTH_KV: kv,
  GITHUB_CLIENT_ID: "Ov23liExample123456",
  GITHUB_CLIENT_SECRET: "fixture-no-real-oauth-secret-000000",
  OPERATOR_GITHUB_USER_ID: "123456789",
});

describe("M1.2 split authorization Worker setup", () => {
  it("is disabled without an explicit opt-in and proper storage", () => {
    expect(isAuthProviderConfigured({})).toBe(false);
    expect(isAuthProviderConfigured({ ...ready(), AUTH_ENABLED: "false" })).toBe(false);
    expect(isAuthProviderConfigured({ ...ready(), OAUTH_KV: undefined })).toBe(false);
    expect(isAuthProviderConfigured({ ...ready(), GITHUB_CLIENT_SECRET: undefined })).toBe(false);
    expect(isAuthProviderConfigured({ ...ready(), OPERATOR_GITHUB_USER_ID: "not-a-github-id" })).toBe(false);
    expect(isAuthProviderConfigured(ready())).toBe(true);
  });

  it("rejects untrusted issuer and audience URLs", () => {
    expect(isAuthProviderConfigured({ ...ready(), ISSUER: "http://auth.example.org/" })).toBe(false);
    expect(isAuthProviderConfigured({ ...ready(), ISSUER: "https://alice:secret@auth.example.org/" })).toBe(false);
    expect(isAuthProviderConfigured({ ...ready(), MCP_SERVER_URL: "https://mcp.example.org/other" })).toBe(false);
    expect(isAuthProviderConfigured({ ...ready(), MCP_SERVER_URL: "https://mcp.example.org/mcp?token=secret" })).toBe(false);
  });

  it("never grants consent from a guessed or forged approval", async () => {
    const denial = consentUnavailable();
    expect(denial.status).toBe(403);
    expect(denial.headers.get("cache-control")).toBe("no-store");
    expect(denial.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await denial.json()).toEqual({
      error: "authorization_not_enabled",
      message: "Operator sign-in and client consent have not been configured.",
    });
  });

  it("does not echo provider configuration in the default denial", async () => {
    const response = authServiceUnavailable();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "auth_not_configured" });
  });
});
