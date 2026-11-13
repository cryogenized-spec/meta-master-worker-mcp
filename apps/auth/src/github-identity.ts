/**
 * GitHub is an upstream identity provider ONLY. Its token is never put into
 * MCP props, D1 or returned to the requesting client.
 */
export interface GitHubLoginConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  allowedUserId: string;
}

export function pkceVerifier(): string {
  // 64 random bytes -> 86 URL-safe characters (RFC 7636 length: 43–128).
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return toBase64Url(bytes);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export function githubAuthorizeUrl(config: GitHubLoginConfig, state: string, challenge: string): string {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(state)) throw new Error("invalid_state");
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error("invalid_pkce_challenge");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  // No scope requested. Only identity via GET /user is necessary.
  url.searchParams.set("scope", "");
  return url.href;
}

function validCode(code: string | null): code is string {
  return !!code && code.length <= 512 && /^[A-Za-z0-9_-]+$/.test(code);
}

function validGitHubUserId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Exchange a *single-use* GitHub code with PKCE, then verify /user identity.
 * Secret values, upstream token and raw error bodies must never be logged.
 * Calls are directed only to fixed GitHub hosts.
 */
export async function verifyGitHubOperator(
  code: string | null,
  verifier: string,
  config: GitHubLoginConfig,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!validCode(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return null;

  try {
    const exchange = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
        code_verifier: verifier,
      }).toString(),
      redirect: "error",
    });

    if (!exchange.ok) return null;
    const tokenResult: unknown = await exchange.json();
    if (!tokenResult || typeof tokenResult !== "object" || !("access_token" in tokenResult)) return null;
    const token = tokenResult.access_token;
    if (typeof token !== "string" || token.length < 10 || token.length > 4096) return null;

    const identity = await fetcher("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + token,
        "user-agent": "meta-master-worker-mcp",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
    });
    if (!identity.ok) return null;
    const profile: unknown = await identity.json();
    if (!profile || typeof profile !== "object" || !("id" in profile)) return null;
    if (!validGitHubUserId(profile.id)) return null;
    const candidateId = String(profile.id);
    // Login names are mutable; GitHub's numeric user ID is stable.
    return candidateId === config.allowedUserId ? candidateId : null;
  } catch {
    return null;
  }
}
