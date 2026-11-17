import { existsSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  ConflictError,
  getSettingsState,
  InvalidError,
  NotFoundError,
  pollStalledFor,
} from "@jobvr/core";
import { HTTPException } from "hono/http-exception";
import { methodNotAllowed } from "hono/method-not-allowed";
import { requestId } from "hono/request-id";
import { pinoLogger } from "hono-pino";
import { ZodError } from "zod";
import { env } from "@/config/env";
import { HTTP_STATUS, NOT_FOUND_MESSAGE } from "@/constants";
import { type AppDeps, createRouter } from "@/lib/create-app";
import { logger } from "@/lib/logger";
import { configureOpenAPI } from "@/lib/openapi";
import { auth } from "@/middleware/auth";
import { rateLimit } from "@/middleware/rate-limit";
import { crossSiteGuard, requestGuards, securityHeaders } from "@/middleware/security";
import companiesRouter from "@/modules/companies";
import jobsRouter from "@/modules/jobs";
import settingsRouter from "@/modules/settings";
import suggestionsRouter from "@/modules/suggestions";
import { fail, validationMessage } from "@/utils/response";
import pkg from "../package.json" with { type: "json" };

export interface AppOptions {
  /** Built SPA to serve (skipped when missing, e.g. in tests). */
  webDistDir?: string;
  /** The scheduler runs in this process: /health then also reports a stalled poll. */
  schedulerEnabled?: boolean;
}

/** /health turns 503 when the last poll is older than this many poll intervals. */

/**
 * Build and configure the Hono application.
 *
 * Returns a fresh instance on every call (own rate-limit store, own routes) so
 * tests stay isolated. `src/index.ts` passes `app.fetch` to the Node server.
 */
export const createApp = (deps: AppDeps, options: AppOptions = {}) => {
  const bootedAt = deps.now();
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
          module: "http",
          reqId: c.var.requestId,
          req: { method: c.req.method, path: c.req.path },
        }),
        // One readable line per request ("GET /api/jobs 200 · 23 ms")
        onResMessage: (c) => `${c.req.method} ${c.req.path} ${c.res.status}`,
        reqId: false,
        referRequestIdKey: "_unused",
        onResBindings: (c) => ({ res: { status: c.res.status } }),
        // Health probes and static assets are logged at trace so they don't flood the logs
        onResLevel: (c) => {
          if (c.req.path === "/health" || !c.req.path.startsWith("/api")) return "trace";
          if (c.res.status >= 500) return "error";
          if (c.res.status >= 400) return "warn";
          // Open tabs refetch every 2 min; only writes (your actions) are worth info
          return c.req.method === "GET" || c.req.method === "HEAD" ? "debug" : "info";
        },
      },
    }),
  );
  app.use(...securityHeaders());
  app.use("/api/*", rateLimit());
  app.use("/api/*", crossSiteGuard());
  app.use(...requestGuards());
  app.use("/api/*", auth());
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });
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

  // Global error handler: domain errors map to their HTTP statuses
  app.onError((err, c) => {
    const log = c.var.logger ?? logger;

    if (err instanceof NotFoundError) return fail(c, HTTP_STATUS.NOT_FOUND, err.message);
    if (err instanceof ConflictError) return fail(c, HTTP_STATUS.CONFLICT, err.message);
    if (err instanceof InvalidError) return fail(c, HTTP_STATUS.BAD_REQUEST, err.message);
    if (err instanceof ZodError) {
      return fail(c, HTTP_STATUS.BAD_REQUEST, validationMessage(err.issues), {
        error: "Validation Error",
        details: err.issues,
      });
    }
    if (err instanceof HTTPException) {
      if (err.res) return err.getResponse();
      log[err.status >= 500 ? "error" : "warn"](
        { err },
        `${c.req.method} ${c.req.path}: ${err.status} ${err.message}`,
      );
      return fail(c, err.status, err.message);
    }

    log.error({ err }, `${c.req.method} ${c.req.path}: unhandled error`);
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
  const routes = app
    .get("/health", async (c) => {
      try {
        const state = await getSettingsState(deps.database.db);
        const lastPollAt = state.lastPollAt?.toISOString() ?? null;
        const lastPollOkAt = state.lastPollOkAt?.toISOString() ?? null;
        if (options.schedulerEnabled) {
          // A poll that starts and then crashes every time is stalled too
          const stalled = pollStalledFor(
            state.lastPollOkAt,
            bootedAt,
            state.settings.pollEveryMinutes,
            deps.now(),
          );
          if (stalled !== null) {
            return c.json({ status: "stale" as const, lastPollAt, lastPollOkAt }, 503);
          }
        }
        return c.json({ status: "ok" as const, lastPollAt, lastPollOkAt }, 200);
      } catch (err) {
        (c.var.logger ?? logger).error({ err }, "health check could not read the database");
        return c.json(
          { status: "unavailable" as const, lastPollAt: null, lastPollOkAt: null },
          503,
        );
      }
    })
    .route("/api/jobs", jobsRouter)
    .route("/api/companies", companiesRouter)
    .route("/api/suggestions", suggestionsRouter)
    .route("/api/settings", settingsRouter);

  const webDist = options.webDistDir ? path.resolve(options.webDistDir) : null;
  if (webDist && existsSync(path.join(webDist, "index.html"))) {
    // Hashed assets never change; the shell and service worker must revalidate
    app.use("*", async (c, next) => {
      await next();
      const { path: p } = c.req;
      if (!c.res.ok || p.startsWith("/api/") || p === "/health") return;
      c.header(
        "Cache-Control",
        p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      );
    });
    app.get("*", serveStatic({ root: path.relative(process.cwd(), webDist) || "." }));
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith("/api/") || c.req.path === "/api") return next();
      // A hashed file from an older build: a 404, never index.html cached for a year
      if (c.req.path.startsWith("/assets/")) return next();
      c.header("Cache-Control", "no-cache");
      return serveStatic({
        root: path.relative(process.cwd(), webDist) || ".",
        path: "index.html",
      })(c, next);
    });
  } else {
    app.get("/", (c) =>
      c.json({
        message: `${env.APP_NAME} Server`,
        version: pkg.version,
        endpoints: { health: "/health", ...(docsEnabled && { docs: "/reference" }), api: "/api" },
      }),
    );
  }

  return routes;
};

export type AppType = ReturnType<typeof createApp>;
