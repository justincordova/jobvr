import { Scalar } from "@scalar/hono-api-reference";
import { env } from "@/config/env";
import type { AppRouter } from "@/lib/create-app";
import pkg from "../../package.json" with { type: "json" };

/**
 * Serve the OpenAPI document and the Scalar API reference. Only registered
 * outside production so the API schema is not published by default.
 */
export const configureOpenAPI = (app: AppRouter): void => {
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: env.APP_NAME, version: pkg.version, license: { name: "MIT" } },
    servers: [{ url: "/" }],
  });

  app.get("/reference", Scalar({ url: "/openapi.json", pageTitle: `${env.APP_NAME} API` }));
  app.get("/docs", (c) => c.redirect("/reference"));
};
