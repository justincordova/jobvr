import { testClient } from "hono/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "@/app";
import { setupTestDeps } from "./helpers";

const ctx = setupTestDeps(beforeAll, afterAll);
let client: ReturnType<typeof testClient<ReturnType<typeof createApp>>>;
beforeAll(() => {
  client = testClient(createApp(ctx.deps));
  for (const msg of ["first", "second", "third"]) {
    ctx.deps.activity.write(
      JSON.stringify({ level: "info", time: "2026-11-18T12:00:00.000Z", module: "poll", msg }),
    );
  }
});

describe("GET /api/logs", () => {
  it("returns entries after the cursor and is never cached", async () => {
    const res = await client.api.logs.$get({ query: { after: "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      data: { entries: { msg: string }[]; latestSeq: number; startedAt: string; capacity: number };
    };
    expect(body.data.entries.map((e) => e.msg)).toEqual(["second", "third"]);
    expect(body.data.latestSeq).toBe(3);
    expect(body.data.capacity).toBe(1000);
    expect(Date.parse(body.data.startedAt)).not.toBeNaN();
  });

  it("rejects a bad cursor", async () => {
    const res = await client.api.logs.$get({ query: { after: "-1" } });
    expect(res.status).toBe(400);
  });

  it("is read-only", async () => {
    const res = await createApp(ctx.deps).request("/api/logs", { method: "DELETE" });
    expect(res.status).toBe(405);
  });
});
