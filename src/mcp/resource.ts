import {
  OAuthResourceServer,
  insufficientScope,
} from "@cloudflare/workers-oauth-provider";
import { mcpHandler } from "./server";
import {
  isResourceConfigured,
  type AuthProps,
  type ResourceEnv,
} from "./config";

function unavailable(): Response {
  return new Response(JSON.stringify({
    error: "mcp_not_configured",
    message: "The authenticated MCP transport is not configured.",
  }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * The OAuth Provider validates bearer token audience, issues WWW-Authenticate
 * challenges, and publishes protected resource metadata. It does NOT enforce
 * advertised requiredScopes: we check scope before invoking any MCP tool.
 */
export async function handleMcpResource(
  request: Request,
  env: ResourceEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (!isResourceConfigured(env) || !ctx) return unavailable();

  const resource = new OAuthResourceServer<ResourceEnv, AuthProps>({
    resourceMetadata: {
      resource: env.MCP_SERVER_URL,
      authorization_servers: [env.AUTH_SERVER_URL],
    },
    requiredScopes: ["mcp:read"],
    validateToken: (bindings) => bindings.AUTH_SERVER!.validateToken,
    handler: {
      fetch(req, bindings, authContext) {
        if (!authContext.auth.scope.includes("mcp:read")) {
          return insufficientScope(authContext.auth, ["mcp:read"]);
        }
        return mcpHandler(req, bindings, authContext);
      },
    },
  });

  return resource.fetch(request, env, ctx);
}
