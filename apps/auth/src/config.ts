/**
 * Independent OAuth issuer configuration. No secret values belong in Git.
 * All operator identity checks are based on GitHub numeric user IDs.
 */
export interface AuthEnv {
  OAUTH_KV?: KVNamespace;
  ISSUER?: string;
  MCP_SERVER_URL?: string;
  AUTH_ENABLED?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  OPERATOR_GITHUB_USER_ID?: string;
}

function safeUrl(raw: string, isResource: boolean): boolean {
  try {
    const url = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const secure = url.protocol === "https:" || (url.protocol === "http:" && loopback);
    if (!secure || url.username || url.password || url.search || url.hash) return false;
    return isResource ? url.pathname === "/mcp" : url.pathname === "/";
  } catch {
    return false;
  }
}

export function githubCallbackUrl(issuer: string): string {
  return new URL("oauth/github/callback", issuer).href;
}

export type ConfiguredAuthEnv = AuthEnv & {
  OAUTH_KV: KVNamespace;
  ISSUER: string;
  MCP_SERVER_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  OPERATOR_GITHUB_USER_ID: string;
};

export function isAuthProviderConfigured(env: AuthEnv): env is ConfiguredAuthEnv {
  return env.AUTH_ENABLED === "true" &&
    typeof env.ISSUER === "string" &&
    typeof env.MCP_SERVER_URL === "string" &&
    safeUrl(env.ISSUER, false) &&
    safeUrl(env.MCP_SERVER_URL, true) &&
    typeof env.OAUTH_KV?.get === "function" &&
    typeof env.OAUTH_KV?.put === "function" &&
    typeof env.OAUTH_KV?.delete === "function" &&
    typeof env.OAUTH_KV?.list === "function" &&
    typeof env.GITHUB_CLIENT_ID === "string" &&
    /^[A-Za-z0-9_.-]{8,128}$/.test(env.GITHUB_CLIENT_ID) &&
    typeof env.GITHUB_CLIENT_SECRET === "string" &&
    env.GITHUB_CLIENT_SECRET.length >= 20 &&
    typeof env.OPERATOR_GITHUB_USER_ID === "string" &&
    /^[1-9][0-9]{0,18}$/.test(env.OPERATOR_GITHUB_USER_ID);
}
