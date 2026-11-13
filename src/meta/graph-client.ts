/**
 * Read-only Meta Graph API client. Do not expose arbitrary URL, Graph endpoint
 * or access token parameters to MCP clients. No writes or automatic redirects.
 */
export const META_GRAPH_VERSION = "v27.0" as const;
const ORIGIN = "https://graph.facebook.com";
const BODY_LIMIT = 512 * 1024;

export type GraphFailure = "invalid_input" | "invalid_token" | "permission_denied" |
  "rate_limited" | "provider_unavailable" | "unexpected_response";

export class GraphApiError extends Error {
  constructor(readonly kind: GraphFailure, readonly status = 0) {
    super(kind);
    this.name = "GraphApiError";
  }
}

export interface DiscoveredPage {
  id: string;
  name: string;
  tasks: string[];
}
export interface DiscoveredPages {
  pages: DiscoveredPage[];
  nextCursor: string | null;
}
export interface GraphClientOptions {
  fetcher?: typeof fetch;
  pause?: (ms: number) => Promise<void>;
  /** Cloudflare Worker secret, never sourced from tool input. */
  appSecret?: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function providerCode(data: unknown): number | null {
  if (!object(data) || !object(data.error)) return null;
  return typeof data.error.code === "number" && Number.isInteger(data.error.code)
    ? data.error.code : null;
}
function classify(status: number, code: number | null): GraphFailure {
  if ([190, 102].includes(code ?? -1) || status === 401) return "invalid_token";
  if ([200, 10, 283].includes(code ?? -1) || status === 403) return "permission_denied";
  if (status === 429 || [4, 17, 32, 613, 80001, 80002].includes(code ?? -1)) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "unexpected_response";
}

/** Cap response sizes even when Content-Length is missing or dishonest. */
async function limitedJson(response: Response): Promise<unknown> {
  const reported = Number(response.headers.get("content-length") ?? "0");
  if (reported > BODY_LIMIT || !response.body) {
    throw new GraphApiError("unexpected_response", response.status);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > BODY_LIMIT) {
        await reader.cancel();
        throw new GraphApiError("unexpected_response", response.status);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(count);
  let offset = 0;
  for (const part of chunks) {
    all.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)) as unknown;
  } catch {
    throw new GraphApiError("unexpected_response", response.status);
  }
}

function pageList(data: unknown): DiscoveredPages {
  if (!object(data) || !Array.isArray(data.data) || data.data.length > 50) {
    throw new GraphApiError("unexpected_response");
  }
  const pages: DiscoveredPage[] = [];
  for (const item of data.data) {
    if (!object(item) || typeof item.id !== "string" ||
        !/^[0-9]{1,30}$/.test(item.id) || typeof item.name !== "string" ||
        !item.name || item.name.length > 250) {
      throw new GraphApiError("unexpected_response");
    }
    const rawTasks = item.tasks;
    const tasks: string[] = Array.isArray(rawTasks) && rawTasks.length <= 32 &&
      rawTasks.every(x => typeof x === "string" && x.length <= 60)
      ? rawTasks as string[] : [];
    // Never expose returned Page access_token or paging.next (which may
    // contain an embedded access_token URL).
    pages.push({ id: item.id, name: item.name, tasks });
  }
  let nextCursor: string | null = null;
  if (object(data.paging) && object(data.paging.cursors) &&
      typeof data.paging.cursors.after === "string" &&
      /^[A-Za-z0-9+/_=.-]{1,512}$/.test(data.paging.cursors.after)) {
    nextCursor = data.paging.cursors.after;
  }
  return { pages, nextCursor };
}

async function appSecretProof(token: string, secret: string): Promise<string> {
  if (!secret) throw new GraphApiError("invalid_input");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(token)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export class MetaGraphClient {
  private fetcher: typeof fetch;
  private pause: (ms: number) => Promise<void>;
  private appSecret?: string;
  constructor(options: GraphClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.pause = options.pause ?? (ms => new Promise(done => setTimeout(done, ms)));
    this.appSecret = options.appSecret;
  }

  async listPages(accessToken: string, after?: string): Promise<DiscoveredPages> {
    if (!accessToken || accessToken.length > 8192 || /\s/.test(accessToken) ||
        (after !== undefined && !/^[A-Za-z0-9+/_=.-]{1,512}$/.test(after))) {
      throw new GraphApiError("invalid_input");
    }
    const url = new URL("/" + META_GRAPH_VERSION + "/me/accounts", ORIGIN);
    url.searchParams.set("fields", "id,name,tasks");
    url.searchParams.set("limit", "25");
    if (after) url.searchParams.set("after", after);
    if (this.appSecret !== undefined) {
      url.searchParams.set("appsecret_proof", await appSecretProof(accessToken, this.appSecret));
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          headers: { authorization: "Bearer " + accessToken, accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        if (attempt < 2) { await this.pause(150 * (attempt + 1)); continue; }
        throw new GraphApiError("provider_unavailable");
      }
      const result = await limitedJson(response);
      const code = providerCode(result);
      if (response.ok && code === null) return pageList(result);
      const kind = classify(response.status, code);
      if ((kind === "rate_limited" || kind === "provider_unavailable") && attempt < 2) {
        await this.pause(150 * (attempt + 1));
        continue;
      }
      // Do not echo provider errors, tokens, trace IDs or response messages.
      throw new GraphApiError(kind, response.status);
    }
    throw new GraphApiError("provider_unavailable");
  }
}
