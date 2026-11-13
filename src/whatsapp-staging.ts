import { handleBaileysIngress, type BaileysIngressEnv } from "./modules/whatsapp/bridge-ingress";

/**
 * Free-tier dedicated bridge ingress. Do not deploy the full OAuth/MCP worker
 * under this public staging subdomain. No WhatsApp socket or AI model here.
 *
 * This is purposely a tiny, single-purpose entrypoint: HMAC authentication
 * and encrypted D1 persistence are handled by the SAME W0 modules and tests.
 */
const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
function answer(text: string, status: number, type = "text/plain; charset=utf-8"): Response {
  return new Response(text, { status, headers: { ...responseHeaders, "content-type": type } });
}

export default {
  async fetch(request: Request, env: BaileysIngressEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET") return answer("Method not allowed", 405);
      return answer(JSON.stringify({
        service: "meta-master-whatsapp-staging",
        phase: "synthetic-ingress",
        whatsapp_linked: false,
        agent_enabled: false,
      }), 200, "application/json; charset=utf-8");
    }
    if (url.pathname === "/internal/whatsapp/baileys") {
      return handleBaileysIngress(request, env);
    }
    // No /mcp, official Meta hook, admin controls, media or model endpoints.
    return answer("Not found", 404);
  },
};
