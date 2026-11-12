import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import { isAuthProviderConfigured, type AuthEnv } from "./config";
import { authServiceUnavailable, consentUnavailable } from "./deny";

/**
 * Completely independent OAuth issuer Worker. There is currently NO user
 * identity provider, consent UI or completeAuthorization() call.
 *
 * Even a valid client + PKCE request cannot create a grant: /authorize is
 * always denied. The OAuth library may only expose metadata and validate
 * tokens after all required bindings are supplied.
 */
function newProvider(env: AuthEnv & { OAUTH_KV: KVNamespace; ISSUER: string; MCP_SERVER_URL: string }) {
  return new OAuthAuthorizationServer<AuthEnv>({
    issuer: env.ISSUER,
    resources: [env.MCP_SERVER_URL],
    scopesSupported: ["mcp:read"], // no write scopes until approval policy exists
    clientIdMetadataDocumentEnabled: true,
    // No DCR endpoint. Older clients require deliberate review before support.
  });
}

export default class AuthServer extends WorkerEntrypoint<AuthEnv> {
  fetch(request: Request): Response | Promise<Response> {
    if (!isAuthProviderConfigured(this.env)) return authServiceUnavailable();

    if (new URL(request.url).pathname === "/authorize") {
      return consentUnavailable();
    }
    return newProvider(this.env).fetch(request, this.env, this.ctx);
  }

  /** Private service-binding API. Never expose this method over public HTTP. */
  validateToken(resource: string, token: string) {
    if (!isAuthProviderConfigured(this.env)) return Promise.resolve(null);
    if (resource !== this.env.MCP_SERVER_URL) return Promise.resolve(null);
    return newProvider(this.env).validateToken(resource, token, this.env);
  }
}
