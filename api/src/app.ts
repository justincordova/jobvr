import { HTTPException } from "hono/http-exception";
import { methodNotAllowed } from "hono/method-not-allowed";
import { requestId } from "hono/request-id";
import { pinoLogger } from "hono-pino";
import { env } from "@/config/env";
import { HTTP_STATUS, NOT_FOUND_MESSAGE } from "@/constants";
import { createRouter } from "@/lib/create-app";
import { logger } from "@/lib/logger";
import { configureOpenAPI } from "@/lib/openapi";
import { rateLimit } from "@/middleware/rate-limit";
import { requestGuards, securityHeaders } from "@/middleware/security";
import exampleRouter from "@/modules/example";
import { fail } from "@/utils/response";
import pkg from "../package.json" with { type: "json" };

/**
 * Build and configure the Hono application.
 *
 * Returns a fresh instance on every call (own rate-limit store, own routes) so
 * tests stay isolated. `src/index.ts` passes `app.fetch` to the Node server.
 */
export const createApp = () => {
  const app = createRouter();

  const docsEnabled = env.NODE_ENV !== "production";

  // Middleware order matters: request ID first so every log line carries it;
  // security headers + CORS before rate limiting so 429s are readable by allowed
  // origins; rate limiting before any body is read so rejected clients are cheap.
  app.use(requestId());
  app.use(
    pinoLogger({
      pino: logger,
      http: {
        // Bind the request ID to the request-scoped logger so every line carries it,
        // and disable hono-pino's own reqId so it is not written twice.
        onReqBindings: (c) => ({
          reqId: c.var.requestId,
          req: { method: c.req.method, path: c.req.path },
        }),
        reqId: false,
        referRequestIdKey: "_unused",
        onResBindings: (c) => ({ res: { status: c.res.status } }),
        // Health probes are logged at trace so they don't flood the logs
        onResLevel: (c) => {
          if (c.req.path === "/health") return "trace";
          if (c.res.status >= 500) return "error";
          if (c.res.status >= 400) return "warn";
          return "info";
        },
      },
    }),
  );
  app.use(...securityHeaders());
  app.use(rateLimit());
  app.use(...requestGuards());
  // 405 + Allow header when the path exists but the method does not
  app.use(
    methodNotAllowed({
      app,
      onMethodNotAllowed: (c, methods) => {
        c.header("Allow", methods.join(", "));
        return fail(c, HTTP_STATUS.METHOD_NOT_ALLOWED, `${c.req.method} is not supported here`);
      },
    }),
  );

  // Global error handler
  app.onError((err, c) => {
    const log = c.var.logger ?? logger;

    if (err instanceof HTTPException) {
      if (err.res) return err.getResponse();
      log[err.status >= 500 ? "error" : "warn"]({ err }, "HTTP exception");
      return fail(c, err.status, err.message);
    }

    log.error({ err }, "Unhandled error occurred");
    const message = env.NODE_ENV === "production" ? "Something went wrong on our end" : err.message;
    return fail(c, HTTP_STATUS.INTERNAL_SERVER_ERROR, message);
  });

  // 404 handler
  app.notFound((c) =>
    fail(c, HTTP_STATUS.NOT_FOUND, NOT_FOUND_MESSAGE, { error: "Route not found" }),
  );

  if (docsEnabled) {
    configureOpenAPI(app);
  }

  // Routes are chained so AppType captures them for the RPC client
  return app
    .get("/", (c) =>
      c.json({
        message: `${env.APP_NAME} Server`,
        version: pkg.version,
        endpoints: {
          health: "/health",
          ...(docsEnabled && { docs: "/reference" }),
          api: "/api/example",
        },
      }),
    )
    .get("/health", (c) => c.json({ status: "ok" as const }))
    .route("/api/example", exampleRouter);
};

export type AppType = ReturnType<typeof createApp>;
