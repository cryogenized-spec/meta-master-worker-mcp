import { describe, expect, it } from "vitest";
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { consentPage, escapeHtml } from "../apps/auth/src/consent-page";

function description(overrides: Record<string, unknown> = {}): ConsentDescription {
  return {
    clientName: "Example agent",
    clientDomain: "example.org",
    redirectHost: "localhost:5000",
    redirectIsLoopback: true,
    scope: ["mcp:read"],
    ...overrides,
  } as ConsentDescription;
}

describe("OAuth consent rendering", () => {
  it("escapes all untrusted app metadata and the browser-bound handle", () => {
    const html = consentPage(description({
      clientName: '<img src=x onerror="alert(1)">',
      clientDomain: "<script>alert(2)</script>",
      redirectHost: "<em>bad</em>",
    }), '<script>alert(3)</script>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain("Local app warning");
    expect(html).toContain('action="/authorize"');
    expect(html).toContain('name="decision" value="deny"');
  });

  it("does not display unsupported privileges", () => {
    const html = consentPage(description({ scope: ["mcp:read", "mcp:write", "<script>"] }), "safe-handle");
    expect(html).toContain("Read-only MCP diagnostics");
    expect(html).not.toContain('value="mcp:write"');
    expect(html).not.toContain("<script>");
    expect(escapeHtml('a&"<b>')).toBe("a&#38;&#34;&#60;b&#62;");
  });
});
