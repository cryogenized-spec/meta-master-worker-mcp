import { describe, expect, it } from "vitest";
import { MetaConnectionVault, type ConnectionInput } from "../src/storage/meta-vault";
import { encryptMetaToken } from "../src/storage/token-crypto";

class StatementFake {
  constructor(readonly db: D1Fake, readonly sql: string, readonly args: unknown[] = []) {}
  bind(...args: unknown[]): StatementFake {
    return new StatementFake(this.db, this.sql, args);
  }
  async first<T>(): Promise<T | null> {
    this.db.called.push(this);
    return this.db.nextRow as T | null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    this.db.called.push(this);
    return { results: this.db.rows as T[] };
  }
}

class D1Fake {
  called: StatementFake[] = [];
  nextRow: unknown = null;
  rows: unknown[] = [];
  prepare(sql: string) {
    return new StatementFake(this, sql);
  }
  async batch(statements: StatementFake[]): Promise<Array<{ meta: { changes: number } }>> {
    this.called.push(...statements);
    return statements.map((_, i) => ({ meta: { changes: i === 1 ? 1 : 0 } }));
  }
}

function key(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function record(): ConnectionInput {
  return {
    connectionId: crypto.randomUUID(),
    operatorId: "github:123456",
    platform: "facebook",
    externalAccountId: "987654321",
    accessToken: "fixture-NOT-A-REAL-META-TOKEN",
    grantedScopes: ["pages_show_list"],
    expiresAt: 1900000000,
  };
}

describe("M1.2c encrypted connection vault", () => {
  it("refuses missing database or secret bindings", () => {
    expect(() => new MetaConnectionVault({})).toThrow("meta_vault_not_configured");
    expect(() => new MetaConnectionVault({ META_DB: new D1Fake() as unknown as D1Database }))
      .toThrow("meta_vault_not_configured");
  });

  it("only sends encrypted token bytes as a bound D1 parameter", async () => {
    const db = new D1Fake();
    const vault = new MetaConnectionVault({
      META_DB: db as unknown as D1Database, META_TOKEN_ENCRYPTION_KEY: key(),
    });
    const input = record();
    const summary = await vault.create(input);
    expect(summary).not.toHaveProperty("accessToken");
    expect(summary).not.toHaveProperty("tokenCiphertext");
    const insert = db.called[0];
    expect(insert.sql).toContain("INSERT INTO meta_connections");
    expect(insert.sql).not.toContain(input.accessToken);
    expect(JSON.stringify(insert.args)).not.toContain(input.accessToken);
    expect(String(insert.args[4])).toMatch(/^v1\./);
    expect(db.called[1].sql).toContain("INSERT INTO connection_audit");
  });

  it("decrypts only a matching operator, connection and platform", async () => {
    const db = new D1Fake();
    const secret = key();
    const input = record();
    const cipher = await encryptMetaToken(input.accessToken, secret, {
      operatorId: input.operatorId, connectionId: input.connectionId, platform: input.platform,
    });
    db.nextRow = { connection_id: input.connectionId, operator_id: input.operatorId,
      platform: input.platform, token_ciphertext: cipher, expires_at: input.expiresAt };
    const vault = new MetaConnectionVault({
      META_DB: db as unknown as D1Database, META_TOKEN_ENCRYPTION_KEY: secret,
    });
    expect(await vault.readToken(input.operatorId, input.connectionId)).toBe(input.accessToken);
    expect(db.called[0].sql).toContain("operator_id = ?");
    await expect(vault.readToken("github:different", input.connectionId))
      .rejects.toThrow("token_decryption_failed");
    expect(await vault.readToken(input.operatorId, input.connectionId, input.expiresAt)).toBeNull();
  });

  it("lists metadata but never retrieves token_ciphertext", async () => {
    const db = new D1Fake();
    db.rows = [{ connection_id: "id", platform: "facebook", external_account_id: "account",
      granted_scopes_json: '["pages_show_list"]', expires_at: null }];
    const vault = new MetaConnectionVault({
      META_DB: db as unknown as D1Database, META_TOKEN_ENCRYPTION_KEY: key(),
    });
    const result = await vault.list("github:123456");
    expect(result[0]).toMatchObject({ connectionId: "id", grantedScopes: ["pages_show_list"] });
    expect(JSON.stringify(result)).not.toContain("token_ciphertext");
    expect(db.called[0].sql).not.toContain("token_ciphertext");
  });

  it("restricts disconnect and audit mutations to the same operator", async () => {
    const db = new D1Fake();
    const vault = new MetaConnectionVault({
      META_DB: db as unknown as D1Database, META_TOKEN_ENCRYPTION_KEY: key(),
    });
    expect(await vault.disconnect("github:123456", crypto.randomUUID())).toBe(true);
    expect(db.called[0].sql).toContain("operator_id = ?");
    expect(db.called[1].sql).toContain("operator_id = ?");
    expect(db.called[1].sql).toContain("DELETE FROM meta_connections");
  });

  it("rejects malformed scopes, duplicate scopes, and invalid IDs", async () => {
    const vault = new MetaConnectionVault({
      META_DB: new D1Fake() as unknown as D1Database, META_TOKEN_ENCRYPTION_KEY: key(),
    });
    await expect(vault.create({ ...record(), grantedScopes: ["pages_show_list", "pages_show_list"] }))
      .rejects.toThrow("invalid_vault_input");
    await expect(vault.create({ ...record(), operatorId: "bad operator" }))
      .rejects.toThrow("invalid_vault_identity");
    await expect(vault.create({ ...record(), externalAccountId: "x'); DROP TABLE users" }))
      .rejects.toThrow("invalid_vault_input");
  });
});
