import {
  OAuthResourceServer,
  insufficientScope,
  type AuthorizationServerBinding,
} from "@cloudflare/workers-oauth-provider";
import { mcpHandler } from "./server";

export type AuthProps = { userId: string };

export interface ResourceEnv {
  /** Private Cloudflare Service Binding to the separately deployed auth worker. */
  AUTH_SERVER?: AuthorizationServerBinding<AuthProps>;
  /** Canonical URL of this exact /mcp resource, used as OAuth audience. */
  MCP_SERVER_URL?: string;
  /** Canonical OAuth issuer URL of the auth worker. */
  AUTH_SERVER_URL?: string;
}

export function isMcpResourcePath(path: string): boolean {
  return path === "/mcp" ||
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp";
}

function publicUrl(raw: string, resource: boolean): boolean {
  try {
    const url = new URL(raw);
    const loopback = url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    return (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      url.username === "" && url.password === "" &&
      url.search === "" && url.hash === "" &&
      (!resource || url.pathname === "/mcp");
  } catch {
    return false;
  }
}

export function isResourceConfigured(
  env: ResourceEnv,
): env is ResourceEnv & {
  AUTH_SERVER: AuthorizationServerBinding<AuthProps>;
  MCP_SERVER_URL: string;
  AUTH_SERVER_URL: string;
} {
  return (
    typeof env.AUTH_SERVER?.validateToken === "function" &&
    typeof env.MCP_SERVER_URL === "string" &&
    typeof env.AUTH_SERVER_URL === "string" &&
    publicUrl(env.MCP_SERVER_URL, true) &&
    publicUrl(env.AUTH_SERVER_URL, false)
  );
}

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
 * The official OAuth provider owns token audience validation, challenge headers,
 * and OAuth protected-resource metadata. requiredScopes only advertises
 * scopes: we check ctx.auth.scope explicitly before invoking MCP.
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
      fetch(request, env, authContext) {
        if (!authContext.auth.scope.includes("mcp:read")) {
          return insufficientScope(authContext.auth, ["mcp:read"]);
        }
        return mcpHandler(request, env, authContext);
      },
    },
  });

  return resource.fetch(request, env, ctx);
}
