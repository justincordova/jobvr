import { z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { env } from "@/config/env";
import type { AppRouter } from "@/lib/create-app";
import { isoNullable, json } from "@/lib/routes";
import pkg from "../../package.json" with { type: "json" };

/**
 * Serve the OpenAPI document and the Scalar API reference. Only registered
 * outside production so the API schema is not published by default.
 */
export const configureOpenAPI = (app: AppRouter): void => {
  // /health is a plain route (it answers before the API is up); described here by hand
  const Health = z
    .object({
      status: z.enum(["ok", "stale", "unavailable"]),
      lastPollAt: isoNullable,
      lastPollOkAt: isoNullable,
    })
    .openapi("Health");
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/health",
    tags: ["health"],
    summary: "Liveness: 503 when the database is down or polls have stalled",
    responses: {
      200: json(Health, "Healthy"),
      503: json(Health, "Database unreachable, or no poll finished for 3 intervals"),
    },
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: env.APP_NAME, version: pkg.version, license: { name: "MIT" } },
    servers: [{ url: "/" }],
  });

  app.get("/reference", Scalar({ url: "/openapi.json", pageTitle: `${env.APP_NAME} API` }));
  app.get("/docs", (c) => c.redirect("/reference"));
};
