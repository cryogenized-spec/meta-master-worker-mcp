import { decryptMetaToken, encryptMetaToken, type TokenContext } from "./token-crypto";

export type MetaPlatform = TokenContext["platform"];

export interface MetaVaultEnv {
  /** Private Cloudflare D1 binding. Not provisioned in the public repository. */
  META_DB?: D1Database;
  /** 32-byte URL-safe base64 key set as a Cloudflare Worker secret. */
  META_TOKEN_ENCRYPTION_KEY?: string;
}

interface ConfiguredVault {
  db: D1Database;
  key: string;
}

export interface ConnectionInput {
  connectionId: string;
  operatorId: string;
  platform: MetaPlatform;
  externalAccountId: string;
  accessToken: string;
  grantedScopes: string[];
  expiresAt: number | null;
}

export interface ConnectionSummary {
  connectionId: string;
  platform: MetaPlatform;
  externalAccountId: string;
  grantedScopes: string[];
  expiresAt: number | null;
}

interface VaultRow {
  connection_id: string;
  operator_id: string;
  platform: MetaPlatform;
  external_account_id: string;
  token_ciphertext: string;
  granted_scopes_json: string;
  expires_at: number | null;
}

function asConfigured(env: MetaVaultEnv): ConfiguredVault {
  if (typeof env.META_DB?.prepare !== "function" || typeof env.META_DB?.batch !== "function" ||
    typeof env.META_TOKEN_ENCRYPTION_KEY !== "string" || !env.META_TOKEN_ENCRYPTION_KEY) {
    throw new Error("meta_vault_not_configured");
  }
  return { db: env.META_DB, key: env.META_TOKEN_ENCRYPTION_KEY };
}

function validId(id: string): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(id);
}

function checkIdentity(operatorId: string, connectionId: string): void {
  if (!validId(operatorId) || !validId(connectionId)) throw new Error("invalid_vault_identity");
}

function checkInput(input: ConnectionInput): void {
  checkIdentity(input.operatorId, input.connectionId);
  if (!validId(input.externalAccountId) || !input.accessToken || input.accessToken.length > 8192) {
    throw new Error("invalid_vault_input");
  }
  const allowedPlatforms: MetaPlatform[] = ["facebook", "instagram", "threads", "messenger", "whatsapp", "ads"];
  if (!allowedPlatforms.includes(input.platform) ||
    !Array.isArray(input.grantedScopes) || input.grantedScopes.length > 64 ||
    input.grantedScopes.some(s => typeof s !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(s)) ||
    new Set(input.grantedScopes).size !== input.grantedScopes.length ||
    (input.expiresAt !== null && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0))) {
    throw new Error("invalid_vault_input");
  }
}

function parseSummary(row: VaultRow): ConnectionSummary {
  const scopes: unknown = JSON.parse(row.granted_scopes_json);
  if (!Array.isArray(scopes) || scopes.some(s => typeof s !== "string")) {
    throw new Error("invalid_vault_record");
  }
  return {
    connectionId: row.connection_id,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    grantedScopes: scopes,
    expiresAt: row.expires_at,
  };
}

/** Internal storage service. Never expose raw token credentials in MCP tool output. */
export class MetaConnectionVault {
  private readonly db: D1Database;
  private readonly key: string;

  constructor(env: MetaVaultEnv) {
    const configured = asConfigured(env);
    this.db = configured.db;
    this.key = configured.key;
  }

  /** Insert only; a repeated connectionId fails rather than replacing another operator's token. */
  async create(input: ConnectionInput, nowSeconds = Math.floor(Date.now() / 1000)): Promise<ConnectionSummary> {
    checkInput(input);
    const tokenCiphertext = await encryptMetaToken(input.accessToken, this.key, {
      operatorId: input.operatorId,
      connectionId: input.connectionId,
      platform: input.platform,
    });

    // D1 batches execute transactionally. Audit and new connection commit together.
    await this.db.batch([
      this.db.prepare(
        "INSERT INTO meta_connections (connection_id,operator_id,platform,external_account_id,token_ciphertext,granted_scopes_json,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(input.connectionId, input.operatorId, input.platform, input.externalAccountId,
        tokenCiphertext, JSON.stringify(input.grantedScopes), input.expiresAt, nowSeconds, nowSeconds),
      this.db.prepare(
        "INSERT INTO connection_audit (id,operator_id,connection_id,event_type,occurred_at) VALUES (?,?,?,'connected',?)"
      ).bind(crypto.randomUUID(), input.operatorId, input.connectionId, nowSeconds),
    ]);

    return {
      connectionId: input.connectionId,
      platform: input.platform,
      externalAccountId: input.externalAccountId,
      grantedScopes: [...input.grantedScopes],
      expiresAt: input.expiresAt,
    };
  }

  /** The plaintext token is for server-internal Meta API use only, never diagnostics. */
  async readToken(
    operatorId: string,
    connectionId: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<string | null> {
    checkIdentity(operatorId, connectionId);
    const row = await this.db.prepare(
      "SELECT * FROM meta_connections WHERE connection_id = ? AND operator_id = ? LIMIT 1"
    ).bind(connectionId, operatorId).first<VaultRow>();
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at <= nowSeconds) return null;
    return decryptMetaToken(row.token_ciphertext, this.key, {
      operatorId, connectionId, platform: row.platform,
    });
  }

  /** Metadata only. A diagnostic tool must never accidentally retrieve ciphertext or token. */
  async list(operatorId: string): Promise<ConnectionSummary[]> {
    if (!validId(operatorId)) throw new Error("invalid_vault_identity");
    const results = await this.db.prepare(
      "SELECT connection_id,operator_id,platform,external_account_id,granted_scopes_json,expires_at FROM meta_connections WHERE operator_id = ? ORDER BY created_at DESC"
    ).bind(operatorId).all<VaultRow>();
    return results.results.map(parseSummary);
  }

  /**
   * Local disconnect only: provider-side revocation is a separate future feature.
   * SQL records an audit event only for an owned row, and deletes it in one D1 batch.
   */
  async disconnect(operatorId: string, connectionId: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
    checkIdentity(operatorId, connectionId);
    const result = await this.db.batch([
      this.db.prepare(
        "INSERT INTO connection_audit (id,operator_id,connection_id,event_type,occurred_at) SELECT ?,operator_id,connection_id,'disconnected',? FROM meta_connections WHERE connection_id = ? AND operator_id = ?"
      ).bind(crypto.randomUUID(), nowSeconds, connectionId, operatorId),
      this.db.prepare(
        "DELETE FROM meta_connections WHERE connection_id = ? AND operator_id = ?"
      ).bind(connectionId, operatorId),
    ]);
    return (result[1].meta.changes ?? 0) > 0;
  }
}
