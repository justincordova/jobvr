import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setSettingsTimestamp } from "@jobvr/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "@/app";
import { BODY_LIMIT_BYTES } from "@/constants";
import { setupTestDeps } from "./helpers";

describe("App", () => {
  const ctx = setupTestDeps(beforeAll, afterAll);
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    app = createApp(ctx.deps);
  });

  it("GET / returns API info", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ message: "jobvr Server" });
  });

  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", lastPollAt: null, lastPollOkAt: null });
  });

  it("returns the 404 envelope for unknown routes", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, error: "Route not found" });
  });

  it("GET /health is 503 when the scheduler is on but no poll ran for 3 intervals", async () => {
    let now = new Date("2026-11-17T12:00:00Z");
    const scheduled = createApp({ ...ctx.deps, now: () => now }, { schedulerEnabled: true });
    // Just started: within the grace window
    expect((await scheduled.request("/health")).status).toBe(200);
    now = new Date(now.getTime() + 31 * 60_000);
    const stale = await scheduled.request("/health");
    expect(stale.status).toBe(503);
    expect(await stale.json()).toEqual({ status: "stale", lastPollAt: null, lastPollOkAt: null });
  });

  it("GET /health is 503 when polls start but none finishes", async () => {
    let now = new Date("2026-11-17T12:00:00Z");
    const scheduled = createApp({ ...ctx.deps, now: () => now }, { schedulerEnabled: true });
    now = new Date(now.getTime() + 31 * 60_000);
    // A poll started a minute ago (then crashed); the last one that finished is old
    await setSettingsTimestamp(
      ctx.deps.database.db,
      "lastPollAt",
      new Date(now.getTime() - 60_000),
    );
    const stale = await scheduled.request("/health");
    expect(stale.status).toBe(503);
    await setSettingsTimestamp(ctx.deps.database.db, "lastPollOkAt", now);
    expect((await scheduled.request("/health")).status).toBe(200);
    await setSettingsTimestamp(ctx.deps.database.db, "lastPollAt", null);
    await setSettingsTimestamp(ctx.deps.database.db, "lastPollOkAt", null);
  });

  it("sets security headers and echoes a request ID", async () => {
    const res = await app.request("/health", { headers: { "X-Request-Id": "test-id-123" } });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-request-id")).toBe("test-id-123");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("allows CORS only for configured origins", async () => {
    const allowed = await app.request("/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    const denied = await app.request("/health", { headers: { Origin: "http://evil.test" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps CORS headers on rate-limited responses", async () => {
    const limited = createApp(ctx.deps);
    const init = { headers: { Origin: "http://localhost:5173" } };
    let res = await limited.request("/api/nope", init);
    while (res.status !== 429) {
      res = await limited.request("/api/nope", init);
    }
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("refuses writes started by another site; same-origin, allowed origins and scripts pass", async () => {
    const visit = (headers: Record<string, string>) =>
      app.request("/api/jobs/visit", { method: "POST", headers });
    expect(
      (await visit({ "Sec-Fetch-Site": "cross-site", Origin: "https://evil.test" })).status,
    ).toBe(403);
    // Older browsers: Origin only
    expect((await visit({ Origin: "https://evil.test", Host: "jobvr.ts.net" })).status).toBe(403);
    expect((await visit({ Origin: "null" })).status).toBe(403);
    expect((await visit({ "Sec-Fetch-Site": "same-origin" })).status).toBe(200);
    expect(
      (await visit({ Origin: "http://localhost:5173", "Sec-Fetch-Site": "same-site" })).status,
    ).toBe(200);
    expect((await visit({})).status).toBe(200);
    // Reads aren't affected
    expect(
      (await app.request("/api/settings", { headers: { "Sec-Fetch-Site": "cross-site" } })).status,
    ).toBe(200);
  });

  it("returns 405 with an Allow header for unsupported methods", async () => {
    const res = await app.request("/api/companies/00000000-0000-4000-8000-000000000000", {
      method: "PUT",
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("PATCH");
    expect(await res.json()).toMatchObject({ success: false, error: "Method Not Allowed" });
  });

  it("returns 400 envelope for malformed JSON", async () => {
    const res = await app.request("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Bad Request" });
  });

  it("returns 413 envelope when the body exceeds the limit", async () => {
    const res = await app.request("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "x".repeat(BODY_LIMIT_BYTES + 1),
        tier: "C",
        ats: "lever",
      }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ success: false, error: "Payload Too Large" });
  });

  it("hides internal errors behind the 500 envelope", async () => {
    const failing = createApp(ctx.deps);
    failing.get("/boom", () => {
      throw new Error("kaboom");
    });
    const res = await failing.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: "Internal Server Error" });
  });

  it("serves the OpenAPI document outside production", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/api/jobs",
        "/api/jobs/{id}",
        "/api/companies",
        "/api/settings",
      ]),
    );
    const paths = doc.paths as Record<string, Record<string, { responses: object }>>;
    expect(Object.keys(paths["/api/settings"]?.patch?.responses ?? {})).toContain("403");
    expect(Object.keys(paths["/api/settings"]?.get?.responses ?? {})).not.toContain("403");
  });
});

describe("App serving the web build", () => {
  const ctx = setupTestDeps(beforeAll, afterAll);
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    const dir = mkdtempSync(path.join(tmpdir(), "jobvr-web-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>jobvr</title>");
    writeFileSync(path.join(dir, "assets", "app-abc.js"), "console.log(1)");
    app = createApp(ctx.deps, { webDistDir: dir });
  });

  it("caches hashed assets, revalidates the shell, and 404s a missing asset", async () => {
    const asset = await app.request("/assets/app-abc.js");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const route = await app.request("/companies");
    expect(route.status).toBe(200);
    expect(route.headers.get("cache-control")).toBe("no-cache");
    // An asset from an older build must not become index.html cached for a year
    const gone = await app.request("/assets/app-old.js");
    expect(gone.status).toBe(404);
    expect(gone.headers.get("cache-control") ?? "").not.toContain("immutable");
  });
});
