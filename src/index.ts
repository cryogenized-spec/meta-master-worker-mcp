import { isMcpResourcePath, isResourceConfigured, type ResourceEnv } from "./mcp/config";
import type { WhatsAppWebhookEnv } from "./modules/whatsapp/webhook";

/**
 * M1 resource worker: the MCP SDK is reachable only when the independent
 * OAuth authorization service binding and canonical URLs are configured.
 */
export interface Env extends ResourceEnv, WhatsAppWebhookEnv {}

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
    if (path === "/internal/whatsapp/baileys") {
      const { handleBaileysIngress } = await import("./modules/whatsapp/bridge-ingress");
      return handleBaileysIngress(request, env);
    }
    if (path === "/webhooks/whatsapp") {
      const [{ handleWhatsAppWebhook }, { storeWhatsAppEvents }] = await Promise.all([
        import("./modules/whatsapp/webhook"),
        import("./modules/whatsapp/storage"),
      ]);
      return handleWhatsAppWebhook(request, env, storeWhatsAppEvents);
    }
    if (isMcpResourcePath(path)) {
      if (isResourceConfigured(env)) {
        const { handleMcpResource } = await import("./mcp/resource");
        return handleMcpResource(request, env, ctx);
      }
      if (path !== "/mcp") return json({ error: "not_found" }, 404);
    }
    return handleRequest(request);
  },
};
