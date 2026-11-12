import type { AuthorizationServerBinding } from "@cloudflare/workers-oauth-provider";

export type AuthProps = { userId: string };

export interface ResourceEnv {
  /** Cloudflare Service Binding to the separate OAuth authorization Worker. */
  AUTH_SERVER?: AuthorizationServerBinding<AuthProps>;
  /** Canonical HTTPS URI for the MCP protected resource, ending in /mcp. */
  MCP_SERVER_URL?: string;
  /** OAuth issuer URL; an independent authorization server. */
  AUTH_SERVER_URL?: string;
}

export function isMcpResourcePath(path: string): boolean {
  return path === "/mcp" ||
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp";
}

function trustedEndpoint(raw: string, resource: boolean): boolean {
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
      !url.username && !url.password && !url.search && !url.hash &&
      (!resource || url.pathname === "/mcp");
  } catch {
    return false;
  }
}

/** A missing or malformed binding never activates MCP. */
export function isResourceConfigured(
  env: ResourceEnv,
): env is ResourceEnv & {
  AUTH_SERVER: AuthorizationServerBinding<AuthProps>;
  MCP_SERVER_URL: string;
  AUTH_SERVER_URL: string;
} {
  return typeof env.AUTH_SERVER?.validateToken === "function" &&
    typeof env.MCP_SERVER_URL === "string" &&
    typeof env.AUTH_SERVER_URL === "string" &&
    trustedEndpoint(env.MCP_SERVER_URL, true) &&
    trustedEndpoint(env.AUTH_SERVER_URL, false);
}
