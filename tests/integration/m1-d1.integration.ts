import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import migrationSql from "../../migrations/0001_meta_connections.sql?raw";
import { MetaConnectionVault } from "../../src/storage/meta-vault";

let db: D1Database;
let vault: MetaConnectionVault;
let kv: KVNamespace;
const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

beforeAll(async () => {
  const bindings = env as unknown as { META_DB: D1Database; OAUTH_KV: KVNamespace };
  db = bindings.META_DB;
  kv = bindings.OAUTH_KV;
  // D1Database.exec splits input on newlines; the migration includes multiline
  // CREATE TABLE statements. Submit each complete statement as a bound batch.
  const statements = migrationSql
    .split(";")
    .map(part => part.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
  vault = new MetaConnectionVault({ META_DB: db, META_TOKEN_ENCRYPTION_KEY: key });
});

describe("M1.2d real workerd-backed D1 and KV integration", () => {
  it("applies the SQL migration in an actual local D1 runtime", async () => {
    const { results } = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('meta_connections','connection_audit') ORDER BY name"
    ).all<{ name: string }>();
    expect(results.map(row => row.name)).toEqual(["connection_audit", "meta_connections"]);
  });

  it("creates encrypted credentials, isolates identities, lists metadata, and disconnects", async () => {
    const connectionId = crypto.randomUUID();
    const owner = "github-123456";
    const token = "dummy-workerd-test-credential-never-a-real-token";
    const summary = await vault.create({
      connectionId, operatorId: owner, platform: "facebook",
      externalAccountId: "page-" + connectionId,
      accessToken: token,
      grantedScopes: ["pages_show_list"],
      expiresAt: null,
    });
    expect(summary).not.toHaveProperty("accessToken");
    expect(await vault.readToken(owner, connectionId)).toBe(token);
    expect(await vault.readToken("github-999999", connectionId)).toBeNull();
    expect((await vault.list("github-999999")).length).toBe(0);
    const list = await vault.list(owner);
    expect(list.find(row => row.connectionId === connectionId)).toMatchObject({
      platform: "facebook", grantedScopes: ["pages_show_list"],
    });
    expect(JSON.stringify(list)).not.toContain(token);

    const raw = await db.prepare(
      "SELECT token_ciphertext FROM meta_connections WHERE connection_id = ?"
    ).bind(connectionId).first<{ token_ciphertext: string }>();
    expect(raw?.token_ciphertext).toMatch(/^v1\./);
    expect(raw?.token_ciphertext).not.toContain(token);
    expect(await vault.disconnect("github-999999", connectionId)).toBe(false);
    expect(await vault.readToken(owner, connectionId)).toBe(token);
    expect(await vault.disconnect(owner, connectionId)).toBe(true);
    expect(await vault.readToken(owner, connectionId)).toBeNull();
    const audit = await db.prepare(
      "SELECT event_type FROM connection_audit WHERE connection_id = ? ORDER BY occurred_at"
    ).bind(connectionId).all<{ event_type: string }>();
    expect(audit.results.map(row => row.event_type).sort()).toEqual(["connected", "disconnected"]);
  });

  it("rejects duplicate connection creation and leaves just one audit entry", async () => {
    const connectionId = crypto.randomUUID();
    const entry = {
      connectionId, operatorId: "github-123456", platform: "facebook" as const,
      externalAccountId: "page-" + connectionId,
      accessToken: "fake-token", grantedScopes: [], expiresAt: null,
    };
    await vault.create(entry);
    await expect(vault.create(entry)).rejects.toThrow();
    const count = await db.prepare(
      "SELECT count(*) AS n FROM connection_audit WHERE connection_id = ? AND event_type = 'connected'"
    ).bind(connectionId).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("enforces token expiration with actual D1 reads", async () => {
    const connectionId = crypto.randomUUID();
    await vault.create({
      connectionId, operatorId: "github-123456", platform: "threads",
      externalAccountId: "account-" + connectionId,
      accessToken: "expired-fake-token", grantedScopes: [], expiresAt: 1000,
    }, 1);
    expect(await vault.readToken("github-123456", connectionId, 1000)).toBeNull();
  });

  it("does not leave a partial connection after a transaction fails", async () => {
    const id = crypto.randomUUID();
    await expect(db.batch([
      db.prepare(
        "INSERT INTO meta_connections (connection_id,operator_id,platform,external_account_id,token_ciphertext,created_at,updated_at) VALUES (?,?,?,?,?,?,?)"
      ).bind(id, "github-123456", "facebook", "rollback-" + id, "fixture-ciphertext", 1, 1),
      db.prepare(
        "INSERT INTO connection_audit (id,operator_id,connection_id,event_type,occurred_at) VALUES (?,?,?,?,?)"
      ).bind(crypto.randomUUID(), "github-123456", id, "forbidden-event", 1),
    ])).rejects.toThrow();
    expect(await db.prepare("SELECT connection_id FROM meta_connections WHERE connection_id=?")
      .bind(id).first()).toBeNull();
  });

  it("uses an actual local Workers KV binding without account secrets", async () => {
    const key = "fixture-" + crypto.randomUUID();
    await kv.put(key, "local-test-only", { expirationTtl: 60 });
    expect(await kv.get(key)).toBe("local-test-only");
    await kv.delete(key);
    expect(await kv.get(key)).toBeNull();
  });
});
