import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  authorizationErrorRedirect,
} from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import { isAuthProviderConfigured, githubCallbackUrl, type AuthEnv, type ConfiguredAuthEnv } from "./config";
import { authServiceUnavailable, consentUnavailable } from "./deny";
import { consentPage } from "./consent-page";
import { githubAuthorizeUrl, pkceChallenge, pkceVerifier, verifyGitHubOperator } from "./github-identity";

/**
 * Separate OAuth authorisation server.
 * We do not create a grant until BOTH explicit browser-bound MCP client
 * consent AND a verified, allowlisted GitHub user ID are present.
 */
function newProvider(env: ConfiguredAuthEnv) {
  return new OAuthAuthorizationServer<AuthEnv>({
    issuer: env.ISSUER,
    resources: [env.MCP_SERVER_URL],
    scopesSupported: ["mcp:read"],
    clientIdMetadataDocumentEnabled: true,
    // Dynamic registration and write scopes are intentionally not enabled.
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) {
    return Response.redirect(error.redirectTo, 302);
  }
  if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
    return new Response("The authorisation request was invalid or expired.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // Do not send raw exception strings or upstream identity responses to callers.
  return new Response("The authorisation service is unavailable.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function redirectFrom(headers: Headers, destination: string): Response {
  headers.set("Location", destination);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}

async function authorize(
  request: Request,
  env: ConfiguredAuthEnv,
  provider: ReturnType<typeof newProvider>,
): Promise<Response> {
  const oauth = provider.getOAuthApi(env);
  if (request.method === "GET") {
    const authRequest = await oauth.parseAuthRequest(request);
    if (authRequest.scope.length !== 1 || authRequest.scope[0] !== "mcp:read") {
      return consentUnavailable();
    }
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    const headers = consent.headers;
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(consentPage(details, consent.handle), { headers });
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  }

  // Reject other content types: only the browser-bound, same-origin form.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return consentUnavailable();
  }
  const form = await request.formData();
  const handle = form.get("handle");
  if (typeof handle !== "string" || handle.length > 1024) return consentUnavailable();
  const decision = form.get("decision");
  if (decision !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const scope = form.getAll("scope");
  if (scope.length !== 1 || scope[0] !== "mcp:read") return consentUnavailable();
  const approved = await oauth.approveConsent(request, handle, { scope: ["mcp:read"] });
  const verifier = pkceVerifier();
  const upstream = await oauth.beginUpstream(approved.request, {
    data: { verifier },
    headers: approved.headers,
  });
  const uri = githubAuthorizeUrl({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: githubCallbackUrl(env.ISSUER),
    allowedUserId: env.OPERATOR_GITHUB_USER_ID,
  }, upstream.state, await pkceChallenge(verifier));
  return redirectFrom(upstream.headers, uri);
}

async function callback(
  request: Request,
  env: ConfiguredAuthEnv,
  provider: ReturnType<typeof newProvider>,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET" } });
  }
  const oauth = provider.getOAuthApi(env);
  // finishUpstream verifies state, original browser and one-time callback.
  const finished = await oauth.finishUpstream<{ verifier: string }>(request);
  const original = finished.request;
  const headers = finished.headers;
  const query = new URL(request.url).searchParams;

  if (query.has("error")) {
    return redirectFrom(headers, authorizationErrorRedirect(original, "access_denied"));
  }

  const operatorId = await verifyGitHubOperator(
    query.get("code"),
    finished.data.verifier,
    {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      callbackUrl: githubCallbackUrl(env.ISSUER),
      allowedUserId: env.OPERATOR_GITHUB_USER_ID,
    },
  );
  if (!operatorId) {
    return redirectFrom(headers, authorizationErrorRedirect(original, "access_denied"));
  }

  const userId = "github:" + operatorId;
  const result = await oauth.completeAuthorization({
    request: original,
    userId,
    metadata: {},
    scope: ["mcp:read"],
    props: { userId },
  });
  return redirectFrom(headers, result.redirectTo);
}

export default class AuthServer extends WorkerEntrypoint<AuthEnv> {
  async fetch(request: Request): Promise<Response> {
    if (!isAuthProviderConfigured(this.env)) return authServiceUnavailable();
    if (new URL(request.url).origin !== new URL(this.env.ISSUER).origin) {
      return authServiceUnavailable();
    }
    const pathname = new URL(request.url).pathname;
    const provider = newProvider(this.env);

    try {
      if (pathname === "/authorize") return await authorize(request, this.env, provider);
      if (pathname === "/oauth/github/callback") return await callback(request, this.env, provider);
      return await provider.fetch(request, this.env, this.ctx);
    } catch (error) {
      return errorResponse(error);
    }
  }

  /** Private service-binding validation; never make this an HTTP endpoint. */
  validateToken(resource: string, token: string) {
    if (!isAuthProviderConfigured(this.env)) return Promise.resolve(null);
    if (resource !== this.env.MCP_SERVER_URL) return Promise.resolve(null);
    return newProvider(this.env).validateToken(resource, token, this.env);
  }
}
