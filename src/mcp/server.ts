import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

/**
 * No provider token is accepted as a tool argument.
 * An authenticated MCP connection is not a connected Meta account.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "meta-master-worker-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "meta_connection_status",
    {
      description: "Explain whether a Meta account is connected, without contacting Meta.",
    },
    async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          connected: false,
          phase: "M1",
          message: "Meta OAuth linking and Page access are not yet enabled.",
        }),
      }],
    }),
  );
  return server;
}

/** SDK v2 stateless handler: a new server is constructed per request. */
export const mcpHandler = createMcpHandler(createServer);
