import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createDatabase, formatDuration, runMigrations } from "@jobvr/core";
import { adapters } from "@jobvr/poller";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { startScheduler } from "@/scheduler";

// Must stay below the orchestrator's kill timeout (Docker/compose default: 10s)
const SHUTDOWN_TIMEOUT_MS = 8_000;
// In development, tsx restarts the server before the old one has released the port
const DEV_PORT_RETRY_MS = 250;
const DEV_PORT_RETRIES = 20;

const log = logger.child({ module: "server" });

/** "127.0.0.1:5432/jobvr": where the database is, never the password. */
const describeDb = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
};

// Pushes link to PUBLIC_URL: a localhost one opens nothing on the phone
if (
  env.SCHEDULER_ENABLED &&
  env.NTFY_URL &&
  /^(localhost|127\.|\[::1\])/.test(new URL(env.PUBLIC_URL).host)
) {
  log.warn(
    { publicUrl: env.PUBLIC_URL },
    `PUBLIC_URL is ${env.PUBLIC_URL}: tapping a push on the phone won't open jobvr; set it to https://jobvr.<tailnet>.ts.net`,
  );
}

const database = createDatabase(env.DATABASE_URL);
const migrateStarted = performance.now();
await runMigrations(database.db, env.MIGRATIONS_DIR);
log.info(
  {},
  `database ready (${describeDb(env.DATABASE_URL)}, migrations applied in ${formatDuration(performance.now() - migrateStarted)})`,
);

const app = createApp(
  { database, registry: adapters, now: () => new Date() },
  { webDistDir: env.WEB_DIST_DIR, schedulerEnabled: env.SCHEDULER_ENABLED },
);

const scheduler = env.SCHEDULER_ENABLED
  ? startScheduler({
      database,
      registry: adapters,
      ntfyUrl: env.NTFY_URL,
      publicUrl: env.PUBLIC_URL,
      logger,
    })
  : null;

// Plain HTTP/1.1 server (no `createServer` override), so it is a node:http Server.
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  const sources = adapters.map((a) => a.id).join(", ");
  log.info(
    { env: env.NODE_ENV, port: info.port, scheduler: Boolean(scheduler) },
    `${env.APP_NAME} listening on http://${info.address}:${info.port} · ${env.NODE_ENV} · scheduler ${scheduler ? "on" : "off (SCHEDULER_ENABLED=false)"} · sources: ${sources}`,
  );
}) as Server;

const exit = (code: number): never => {
  logger.flush();
  process.exit(code);
};

let portRetries = 0;
server.on("error", (err: NodeJS.ErrnoException) => {
  if (
    err.code === "EADDRINUSE" &&
    env.NODE_ENV === "development" &&
    portRetries < DEV_PORT_RETRIES
  ) {
    if (portRetries === 0) {
      log.warn(
        { port: env.PORT },
        `port ${env.PORT} is busy (previous dev server still stopping?); retrying`,
      );
    }
    portRetries++;
    setTimeout(() => server.listen(env.PORT, env.HOST), DEV_PORT_RETRY_MS);
    return;
  }
  const hint = err.code === "EADDRINUSE" ? ` (port ${env.PORT} is in use by another process)` : "";
  log.fatal({ err }, `server failed to start${hint}`);
  exit(1);
});

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, `${signal} received, shutting down`);

  // Hard stop if in-flight requests (or anything else) outlive the grace period
  setTimeout(() => {
    log.warn({}, `shutdown took over ${formatDuration(SHUTDOWN_TIMEOUT_MS)}; forcing exit`);
    server.closeAllConnections();
    exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // Stop accepting connections and close idle keep-alive sockets; the callback
  // fires once in-flight requests finish
  // The running tick (if any) stops fetching and finishes what it's writing first
  const closed = new Promise<Error | undefined>((resolve) => server.close(resolve));
  void Promise.all([closed, scheduler?.stop()]).then(async ([err]) => {
    if (err) log.error({ err }, "error while closing the server");
    await database.close().catch(() => {});
    exit(err ? 1 : 0);
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason }, "unhandled promise rejection");
  exit(1);
});

process.on("uncaughtException", (err) => {
  log.fatal({ err }, "uncaught exception");
  exit(1);
});
