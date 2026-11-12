/**
 * M0 worker shell. There are no Meta API operations or MCP tools yet.
 * /mcp stays unavailable until client authentication and authorisation exist.
 */
export interface Env {
  // Future secrets are server-side Cloudflare bindings, never public vars.
}

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
      phase: "M0",
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
  async fetch(request: Request, _env: Env): Promise<Response> {
    return handleRequest(request);
  },
};
