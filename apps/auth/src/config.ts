/**
 * OAuth authorisation Worker configuration. This is intentionally independent of
 * the MCP resource Worker: it issues tokens but never calls Meta APIs.
 */
export interface AuthEnv {
  OAUTH_KV?: KVNamespace;
  ISSUER?: string;
  MCP_SERVER_URL?: string;
  /** Explicit opt-in. No operator login / consent has been implemented yet. */
  AUTH_ENABLED?: string;
}

function safeUrl(raw: string, isResource: boolean): boolean {
  try {
    const url = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const secure = url.protocol === "https:" || (url.protocol === "http:" && loopback);
    if (!secure || url.username || url.password || url.search || url.hash) return false;
    return isResource ? url.pathname === "/mcp" : url.pathname === "/" ;
  } catch {
    return false;
  }
}

/**
 * Does not imply that an operator can log in. Consent remains disabled even
 * when the OAuth provider's metadata and token-validation endpoints are active.
 */
export function isAuthProviderConfigured(env: AuthEnv): env is AuthEnv & {
  OAUTH_KV: KVNamespace;
  ISSUER: string;
  MCP_SERVER_URL: string;
} {
  return env.AUTH_ENABLED === "true" &&
    typeof env.ISSUER === "string" &&
    typeof env.MCP_SERVER_URL === "string" &&
    safeUrl(env.ISSUER, false) &&
    safeUrl(env.MCP_SERVER_URL, true) &&
    typeof env.OAUTH_KV?.get === "function" &&
    typeof env.OAUTH_KV?.put === "function" &&
    typeof env.OAUTH_KV?.delete === "function";
}
