import type { MetaConnectionVault, ConnectionSummary } from "../storage/meta-vault";
import type { MetaGraphClient, DiscoveredPages } from "./graph-client";

export type PageDiscoveryFailure =
  | "invalid_identity"
  | "connection_not_found"
  | "missing_scope"
  | "expired_connection";

export class PageDiscoveryError extends Error {
  constructor(readonly kind: PageDiscoveryFailure) {
    super(kind);
    this.name = "PageDiscoveryError";
  }
}

type ScopedVault = Pick<MetaConnectionVault, "list" | "readToken">;
type ReadonlyGraph = Pick<MetaGraphClient, "listPages">;

/**
 * Internal orchestration, NOT an MCP tool.
 *
 * The operatorId must originate from the verified OAuth auth context, never
 * an arbitrary caller-supplied field. The requested connection must belong
 * to that operator, represent a Facebook user grant and include the exact
 * pages_show_list scope. No token is returned or logged.
 */
export class MetaPageDiscovery {
  constructor(
    private readonly vault: ScopedVault,
    private readonly graph: ReadonlyGraph,
  ) {}

  async listPages(
    operatorId: string,
    connectionId: string,
    after?: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<DiscoveredPages> {
    if (!/^github-[1-9][0-9]{0,18}$/.test(operatorId) ||
        !/^[A-Za-z0-9:_-]{1,128}$/.test(connectionId)) {
      throw new PageDiscoveryError("invalid_identity");
    }
    const connections: ConnectionSummary[] = await this.vault.list(operatorId);
    const selected = connections.find(c => c.connectionId === connectionId && c.platform === "facebook");
    if (!selected) throw new PageDiscoveryError("connection_not_found");
    if (!selected.grantedScopes.includes("pages_show_list")) {
      throw new PageDiscoveryError("missing_scope");
    }
    if (selected.expiresAt !== null && selected.expiresAt <= nowSeconds) {
      throw new PageDiscoveryError("expired_connection");
    }
    const token = await this.vault.readToken(operatorId, connectionId, nowSeconds);
    if (token === null) throw new PageDiscoveryError("connection_not_found");
    return this.graph.listPages(token, after);
  }
}
