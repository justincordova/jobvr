import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "@/middleware/rate-limit";

const buildApp = (limit: number) =>
  new Hono()
    .use(rateLimit({ limit, windowMs: 60_000 }))
    .get("/", (c) => c.text("ok"))
    .get("/health", (c) => c.text("ok"));

describe("rateLimit", () => {
  it("returns the 429 envelope once the limit is exceeded", async () => {
    const app = buildApp(2);
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);

    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ success: false, error: "Too Many Requests" });
    expect(res.headers.get("ratelimit-policy")).toBe("2;w=60");
  });

  it("does not limit the health check", async () => {
    const app = buildApp(1);
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/health")).status).toBe(200);
    }
  });
});
