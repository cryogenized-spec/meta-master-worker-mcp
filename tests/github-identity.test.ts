import { describe, expect, it, vi } from "vitest";
import {
  githubAuthorizeUrl,
  pkceChallenge,
  pkceVerifier,
  verifyGitHubOperator,
  type GitHubLoginConfig,
} from "../apps/auth/src/github-identity";

const config: GitHubLoginConfig = {
  clientId: "Ov23liFixture12345678",
  clientSecret: "not-a-real-client-secret",
  callbackUrl: "https://auth.example.org/oauth/github/callback",
  allowedUserId: "123456",
};

function mockResponses(userId: unknown): typeof fetch {
  return vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "fixture-github-access-token" }))
    .mockResolvedValueOnce(Response.json({ id: userId, login: "not-trusted" })) as unknown as typeof fetch;
}

describe("GitHub identity and PKCE", () => {
  it("creates unique RFC7636 PKCE S256 challenges", async () => {
    const first = pkceVerifier();
    const second = pkceVerifier();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(first).not.toBe(second);
    expect(await pkceChallenge(first)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await pkceChallenge(first)).not.toBe(await pkceChallenge(second));
  });

  it("never includes the GitHub client secret in the authorization URL", async () => {
    const state = "opaqueStateMustHaveAtLeast32Characters____";
    const url = new URL(githubAuthorizeUrl(config, state, await pkceChallenge(pkceVerifier())));
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
    expect(url.href).not.toContain(config.clientSecret);
    expect(() => githubAuthorizeUrl(config, "short", "invalid")).toThrow();
  });

  it("allows only the stable numeric GitHub user ID and never exposes the token", async () => {
    const fetcher = mockResponses(123456);
    const operatorId = await verifyGitHubOperator("validCode123", pkceVerifier(), config, fetcher);
    expect(operatorId).toBe("123456");
    const calls = (fetcher as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("https://github.com/login/oauth/access_token");
    expect(calls[1][0]).toBe("https://api.github.com/user");
    expect(calls[0][1].body).toContain("code_verifier=");
    expect(JSON.stringify(operatorId)).not.toContain("fixture-github-access-token");
  });

  it("rejects a different numeric identity even when the username looks right", async () => {
    expect(await verifyGitHubOperator("code123", pkceVerifier(), config, mockResponses(555555))).toBeNull();
    expect(await verifyGitHubOperator("code123", pkceVerifier(), config, mockResponses("123456"))).toBeNull();
  });

  it("rejects malformed codes, GitHub API failures and unexpected JSON", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await verifyGitHubOperator("../invalid", pkceVerifier(), config, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    const unavailable = vi.fn().mockResolvedValue(new Response(null, { status: 401 })) as unknown as typeof fetch;
    expect(await verifyGitHubOperator("code123", pkceVerifier(), config, unavailable)).toBeNull();
    const noToken = vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant" })) as unknown as typeof fetch;
    expect(await verifyGitHubOperator("code123", pkceVerifier(), config, noToken)).toBeNull();
  });
});
