import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { pkceChallenge, pkceVerifier } from "../../apps/auth/src/github-identity";

const kv = (env as unknown as { OAUTH_KV: KVNamespace }).OAUTH_KV;

const issuer = "https://auth.example.test/";
const resourceUrl = "https://mcp.example.test/mcp";
const callback = "http://127.0.0.1:8765/oauth/callback";

const provider = new OAuthAuthorizationServer<{ OAUTH_KV: KVNamespace }>({
  issuer,
  resources: [resourceUrl],
  scopesSupported: ["mcp:read"],
  clientIdMetadataDocumentEnabled: false,
});

const browserCookie = (headers: Headers) =>
  headers.getSetCookie().map(v => v.split(";")[0]).join("; ");

describe("M1.2d real OAuth Provider transactions against local KV", () => {
  it("enforces browser-bound consent, one-time handles, PKCE, resource audience and revocation", async () => {
    const env = { OAUTH_KV: kv };
    const oauth = provider.getOAuthApi(env);
    const client = await oauth.createClient({
      clientName: "M1 local integration fixture",
      redirectUris: [callback],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    });
    const verifier = pkceVerifier();
    const challenge = await pkceChallenge(verifier);
    const url = new URL("authorize", issuer);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("scope", "mcp:read");
    url.searchParams.set("state", "fake-client-state");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", resourceUrl);

    const parsed = await oauth.parseAuthRequest(new Request(url));
    const info = await oauth.describeConsent(parsed);
    expect(info.scope).toContain("mcp:read");
    const consent = await oauth.beginConsent(parsed);

    await expect(oauth.approveConsent(
      new Request(url, { method: "POST" }), consent.handle,
      { scope: ["mcp:read"] },
    )).rejects.toThrow();

    const accepted = await oauth.approveConsent(
      new Request(url, { method: "POST", headers: { cookie: browserCookie(consent.headers) } }),
      consent.handle, { scope: ["mcp:read"] },
    );
    await expect(oauth.approveConsent(
      new Request(url, { method: "POST", headers: { cookie: browserCookie(consent.headers) } }),
      consent.handle, { scope: ["mcp:read"] },
    )).rejects.toThrow();

    const upstream = await oauth.beginUpstream(accepted.request, {
      data: { verifier: "fixture-upstream-verifier" },
      headers: accepted.headers,
    });
    const upstreamUrl = new URL("oauth/github/callback", issuer);
    upstreamUrl.searchParams.set("state", upstream.state);
    await expect(oauth.finishUpstream(new Request(upstreamUrl))).rejects.toThrow();

    const finished = await oauth.finishUpstream<{ verifier: string }>(
      new Request(upstreamUrl, { headers: { cookie: browserCookie(upstream.headers) } }),
    );
    expect(finished.data.verifier).toBe("fixture-upstream-verifier");
    await expect(oauth.finishUpstream(
      new Request(upstreamUrl, { headers: { cookie: browserCookie(upstream.headers) } }),
    )).rejects.toThrow();

    // The test alone supplies a known, fixture identity. Production code does
    // not call completeAuthorization until GitHub verification succeeds.
    const grant = await oauth.completeAuthorization({
      request: finished.request,
      userId: "github-100000",
      metadata: {},
      scope: ["mcp:read"],
      props: { userId: "github-100000" },
    });
    const code = new URL(grant.redirectTo).searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.clientId,
      code: code!,
      redirect_uri: callback,
      code_verifier: verifier,
      resource: resourceUrl,
    });
    const tokenResponse = await provider.fetch(new Request(
      new URL("oauth/token", issuer), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      },
    ), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

    expect(tokenResponse.status).toBe(200);
    const result: unknown = await tokenResponse.json();
    expect(result).toHaveProperty("access_token");
    if (!result || typeof result !== "object" || !("access_token" in result)) {
      throw new Error("fixture_auth_token_not_issued");
    }
    const access = result.access_token;
    expect(typeof access).toBe("string");
    expect(await provider.validateToken(resourceUrl, access as string, env)).not.toBeNull();
    await expect(provider.validateToken("https://other.example.test/mcp", access as string, env))
      .rejects.toThrow("resource must name one registered protected resource");

    // Authorization codes must not be redeemed more than once.
    const second = await provider.fetch(new Request(new URL("oauth/token", issuer), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    expect(second.status).toBe(400);

    // Revoke an operator-owned grant using the actual provider and KV store.
    const grants = await oauth.listUserGrants("github-100000");
    expect(grants.items.length).toBe(1);
    await oauth.deleteClient(client.clientId);
    expect(await provider.validateToken(resourceUrl, access as string, env)).toBeNull();
  });
});
