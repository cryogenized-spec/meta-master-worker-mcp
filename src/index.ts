import { handleMcpResource, isMcpResourcePath, isResourceConfigured, type ResourceEnv } from "./mcp/resource";

/**
 * M1 resource worker: the MCP SDK is reachable only when the independent
 * OAuth authorization service binding and canonical URLs are configured.
 */
export interface Env extends ResourceEnv {}

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, ...extra },
  });
}

export function handleRequest(request: Request): Response {
  const { pathname } = new URL(request.url);

  if (pathname === "/health") {
    if (request.method !== "GET") {
      return json(
        { error: "method_not_allowed" },
        405,
        { allow: "GET" }
      );
    }
    return json({
      service: "meta-master-worker-mcp",
      status: "ok",
      phase: "M1",
      meta_connected: false,
      mcp_enabled: false,
    });
  }

  if (pathname === "/mcp") {
    return json({
      error: "mcp_not_configured",
      message: "MCP transport remains disabled until authentication and authorisation are implemented.",
    }, 503);
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (isMcpResourcePath(path)) {
      if (isResourceConfigured(env)) return handleMcpResource(request, env, ctx);
      if (path !== "/mcp") return json({ error: "not_found" }, 404);
    }
    return handleRequest(request);
  },
};
