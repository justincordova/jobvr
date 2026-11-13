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
    expect(await res.json()).toEqual({ status: "ok", lastPollAt: null });
  });

  it("returns the 404 envelope for unknown routes", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, error: "Route not found" });
  });

  it("sets security headers and echoes a request ID", async () => {
    const res = await app.request("/health", { headers: { "X-Request-Id": "test-id-123" } });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-request-id")).toBe("test-id-123");
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
        tier: "Startup",
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
      expect.arrayContaining(["/api/jobs", "/api/jobs/{id}", "/api/companies", "/api/settings"]),
    );
  });
});
