import { describe, expect, it, vi } from "vitest";
import {
  META_GRAPH_VERSION, GraphApiError, MetaGraphClient,
} from "../src/meta/graph-client";

const secretToken = "fixture-private-user-token";
const getUrl = (source: RequestInfo | URL): URL => new URL(String(source));
const fetchMock = (callback: (url: URL, init?: RequestInit) => Response | Promise<Response>) =>
  (async (url: RequestInfo | URL, init?: RequestInit) =>
    callback(getUrl(url), init)) as typeof fetch;

describe("M1.3 read-only Graph API client", () => {
  it("pins the current version, never places access tokens in URL, and strips Page tokens", async () => {
    const captured: Array<{ url: URL; init?: RequestInit }> = [];
    const client = new MetaGraphClient({
      fetcher: fetchMock((url, init) => {
        captured.push({ url, init });
        return Response.json({
          data: [{
            id: "1234567", name: "Demo Page",
            tasks: ["CREATE_CONTENT", "MODERATE"],
            access_token: "RAW-PAGE-TOKEN-MUST-NOT-LEAK",
          }],
          paging: {
            next: "https://graph.facebook.com/anything?access_token=ALSO_SECRET",
            cursors: { after: "valid_cursor=123" },
          },
        });
      }),
    });
    const result = await client.listPages(secretToken);
    expect(META_GRAPH_VERSION).toBe("v27.0");
    expect(captured[0].url.origin).toBe("https://graph.facebook.com");
    expect(captured[0].url.pathname).toBe("/v27.0/me/accounts");
    expect(captured[0].url.searchParams.get("fields")).toBe("id,name,tasks");
    expect(captured[0].url.searchParams.get("limit")).toBe("25");
    expect(captured[0].url.href).not.toContain(secretToken);
    expect(captured[0].init?.method).toBe("GET");
    expect(captured[0].init?.redirect).toBe("error");
    const headers = new Headers(captured[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer " + secretToken);
    expect(result).toEqual({
      pages: [{ id: "1234567", name: "Demo Page", tasks: ["CREATE_CONTENT", "MODERATE"] }],
      nextCursor: "valid_cursor=123",
    });
    expect(JSON.stringify(result)).not.toContain("RAW-PAGE-TOKEN-MUST-NOT-LEAK");
    expect(JSON.stringify(result)).not.toContain("ALSO_SECRET");
  });

  it("encodes cursors as parameters and never follows provider paging.next", async () => {
    const urls: string[] = [];
    const client = new MetaGraphClient({
      fetcher: fetchMock(url => {
        urls.push(url.href);
        return Response.json({ data: [], paging: { next: "https://evil.invalid/a?access_token=x" } });
      }),
    });
    expect(await client.listPages(secretToken, "AB+/==")).toEqual({ pages: [], nextCursor: null });
    expect(new URL(urls[0]).searchParams.get("after")).toBe("AB+/==");
    expect(urls[0]).not.toContain("evil.invalid");
  });

  it("rejects illegal input without making a network request", async () => {
    const spy = vi.fn(async () => Response.json({ data: [] }));
    const client = new MetaGraphClient({ fetcher: spy as typeof fetch });
    await expect(client.listPages("bad token\n")).rejects.toMatchObject({ kind: "invalid_input" });
    await expect(client.listPages(secretToken, "https://evil.invalid/")).rejects.toMatchObject({ kind: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not echo Meta error bodies or retry permanent permission errors", async () => {
    const calls = vi.fn(async () => Response.json({
      error: { code: 200, message: "Token secret provider-sensitive-data" },
    }, { status: 400 }));
    const client = new MetaGraphClient({ fetcher: calls as typeof fetch });
    let thrown: unknown;
    try {
      await client.listPages(secretToken);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).toMatchObject({ kind: "permission_denied", status: 400 });
    expect(JSON.stringify(thrown)).not.toContain("provider-sensitive-data");
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("classifies expired tokens and retries Meta rate limiting on GET only", async () => {
    const attempts: number[] = [];
    let count = 0;
    const client = new MetaGraphClient({
      pause: async ms => { attempts.push(ms); },
      fetcher: fetchMock(() => {
        count++;
        return count <= 2
          ? Response.json({ error: { code: 613, message: "retry" } }, { status: 400 })
          : Response.json({ data: [{ id: "999", name: "Restored", tasks: [] }] });
      }),
    });
    expect((await client.listPages(secretToken)).pages[0].name).toBe("Restored");
    expect(count).toBe(3);
    expect(attempts).toEqual([150, 300]);

    const invalid = new MetaGraphClient({
      fetcher: fetchMock(() => Response.json({ error: { code: 190 } }, { status: 400 })),
    });
    await expect(invalid.listPages(secretToken)).rejects.toMatchObject({ kind: "invalid_token" });
  });

  it("rejects oversized, malformed and secret-bearing responses", async () => {
    const huge = new MetaGraphClient({
      fetcher: fetchMock(() => new Response("x".repeat(512 * 1024 + 1))),
    });
    await expect(huge.listPages(secretToken)).rejects.toMatchObject({ kind: "unexpected_response" });

    const malformed = new MetaGraphClient({
      fetcher: fetchMock(() => Response.json({ data: [{ id: "/bad", name: "Oops" }] })),
    });
    await expect(malformed.listPages(secretToken)).rejects.toMatchObject({ kind: "unexpected_response" });
  });

  it("computes appsecret_proof without exposing app secret or token as URL params", async () => {
    const observed: URL[] = [];
    const client = new MetaGraphClient({
      appSecret: "fixture-app-secret",
      fetcher: fetchMock(url => {
        observed.push(url);
        return Response.json({ data: [] });
      }),
    });
    await client.listPages(secretToken);
    expect(observed[0].searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
    expect(observed[0].href).not.toContain(secretToken);
    expect(observed[0].href).not.toContain("fixture-app-secret");
  });

  it("treats network and upstream failures as a bounded, non-sensitive error", async () => {
    let calls = 0;
    const client = new MetaGraphClient({
      pause: async () => undefined,
      fetcher: fetchMock(() => {
        calls++;
        throw new Error("token=" + secretToken);
      }),
    });
    await expect(client.listPages(secretToken)).rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(calls).toBe(3);
  });
});
