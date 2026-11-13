import { describe, expect, it, vi } from "vitest";
import { MetaPageDiscovery } from "../src/meta/page-discovery";
import type { ConnectionSummary } from "../src/storage/meta-vault";

const connection: ConnectionSummary = {
  connectionId: "conn-123",
  platform: "facebook",
  externalAccountId: "123456",
  grantedScopes: ["pages_show_list"],
  expiresAt: null,
};

function setup(data: ConnectionSummary[] = [connection], token: string | null = "private-user-token") {
  const list = vi.fn(async (_operator: string) => data);
  const readToken = vi.fn(async (_operator: string, _connection: string) => token);
  const listPages = vi.fn(async (_token: string, _after?: string) => ({
    pages: [{ id: "123456", name: "Authorised Page", tasks: ["MODERATE"] }],
    nextCursor: null as string | null,
  }));
  const service = new MetaPageDiscovery({ list, readToken }, { listPages });
  return { service, list, readToken, listPages };
}

describe("M1.3 operator-scoped Page discovery service", () => {
  it("uses only an authenticated operator's connection and secret for Graph calls", async () => {
    const ctx = setup();
    const result = await ctx.service.listPages("github-123456", "conn-123", "CURSOR");
    expect(result.pages[0].name).toBe("Authorised Page");
    expect(ctx.list).toHaveBeenCalledWith("github-123456");
    expect(ctx.readToken).toHaveBeenCalledWith("github-123456", "conn-123", expect.any(Number));
    expect(ctx.listPages).toHaveBeenCalledWith("private-user-token", "CURSOR");
    expect(JSON.stringify(result)).not.toContain("private-user-token");
  });

  it("rejects unknown, foreign and non-Facebook connections without decrypting", async () => {
    for (const c of [
      setup([]),
      setup([{ ...connection, connectionId: "different" }]),
      setup([{ ...connection, platform: "instagram" }]),
    ]) {
      await expect(c.service.listPages("github-123456", "conn-123"))
        .rejects.toMatchObject({ kind: "connection_not_found" });
      expect(c.readToken).not.toHaveBeenCalled();
      expect(c.listPages).not.toHaveBeenCalled();
    }
  });

  it("rejects insufficient scopes before retrieving the token", async () => {
    const ctx = setup([{ ...connection, grantedScopes: ["pages_read_engagement"] }]);
    await expect(ctx.service.listPages("github-123456", "conn-123"))
      .rejects.toMatchObject({ kind: "missing_scope" });
    expect(ctx.readToken).not.toHaveBeenCalled();
  });

  it("rejects expired grants and unavailable tokens before sending Graph requests", async () => {
    const expired = setup([{ ...connection, expiresAt: 1000 }]);
    await expect(expired.service.listPages("github-123456", "conn-123", undefined, 1000))
      .rejects.toMatchObject({ kind: "expired_connection" });
    expect(expired.readToken).not.toHaveBeenCalled();
    const missing = setup([connection], null);
    await expect(missing.service.listPages("github-123456", "conn-123"))
      .rejects.toMatchObject({ kind: "connection_not_found" });
    expect(missing.listPages).not.toHaveBeenCalled();
  });

  it("rejects arbitrary or malformed identities", async () => {
    const ctx = setup();
    await expect(ctx.service.listPages("user-controlled", "conn-123"))
      .rejects.toMatchObject({ kind: "invalid_identity" });
    await expect(ctx.service.listPages("github-123456", "../../etc"))
      .rejects.toMatchObject({ kind: "invalid_identity" });
    expect(ctx.list).not.toHaveBeenCalled();
  });
});
