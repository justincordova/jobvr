import { describe, expect, it } from "vitest";
import { createHttpClient, HttpError } from "./http";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

const scripted = (...replies: Array<Response | Error>) => {
  const requests: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    requests.push(init);
    const next = replies.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const client = createHttpClient({
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
  return { client, requests, sleeps };
};

describe("http client", () => {
  it("returns JSON and the etag, and sends standard headers", async () => {
    const { client, requests } = scripted(json({ a: 1 }, { headers: { etag: '"abc"' } }));
    const res = await client.getJson("https://x.test/a", { etag: '"old"' });
    expect(res).toEqual({ status: "ok", etag: '"abc"', data: { a: 1 } });
    const headers = requests[0]?.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe('"old"');
    expect(headers["User-Agent"]).toBe("jobvr (personal job alerts)");
    expect(headers["Accept-Encoding"]).toBe("gzip");
  });

  it("maps 304 to not_modified", async () => {
    const { client } = scripted(new Response(null, { status: 304 }));
    expect(await client.getJson("https://x.test/a", { etag: '"e"' })).toEqual({
      status: "not_modified",
    });
  });

  it("retries once on 5xx and network errors with jitter", async () => {
    const a = scripted(new Response("x", { status: 502 }), json([1]));
    expect(await a.client.getJson("https://x.test")).toMatchObject({ status: "ok", data: [1] });
    expect(a.sleeps).toEqual([2000]);

    const b = scripted(new TypeError("fetch failed"), new TypeError("fetch failed"));
    await expect(b.client.getJson("https://x.test")).rejects.toThrow(/Network error/);
    expect(b.requests).toHaveLength(2);
  });

  it("honors Retry-After on 429, capped at 30 s", async () => {
    const { client, sleeps } = scripted(
      new Response("", { status: 429, headers: { "retry-after": "120" } }),
      json({}),
    );
    await client.getJson("https://x.test");
    expect(sleeps).toEqual([30_000]);
  });

  it("does not retry other 4xx", async () => {
    const { client, requests } = scripted(new Response("", { status: 404 }));
    const err = await client.getJson("https://x.test").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(requests).toHaveLength(1);
  });

  it("aborts oversized responses", async () => {
    const client = createHttpClient({
      fetch: (async () => json({ big: "x".repeat(200) })) as unknown as typeof fetch,
      maxBytes: 100,
    });
    await expect(client.getJson("https://x.test")).rejects.toThrow(/exceeds/);
  });
});
