import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createDatabase, runMigrations } from "@jobvr/core";
import { adapters } from "@jobvr/poller";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

// Must stay below the orchestrator's kill timeout (Docker/compose default: 10s)
const SHUTDOWN_TIMEOUT_MS = 8_000;

const database = createDatabase(env.DATABASE_URL);
await runMigrations(database.db, env.MIGRATIONS_DIR);
logger.info("database migrated");

const app = createApp(
  { database, registry: adapters, now: () => new Date() },
  { webDistDir: env.WEB_DIST_DIR },
);

// Plain HTTP/1.1 server (no `createServer` override), so it is a node:http Server.
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  logger.info(`${env.APP_NAME} listening on http://${info.address}:${info.port}`);
}) as Server;

const exit = (code: number): never => {
  logger.flush();
  process.exit(code);
};

server.on("error", (err) => {
  logger.fatal({ err }, "Failed to start server");
  exit(1);
});

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Hard stop if in-flight requests (or anything else) outlive the grace period
  setTimeout(() => {
    logger.warn("Shutdown timeout reached, forcing exit");
    server.closeAllConnections();
    exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // Stop accepting connections and close idle keep-alive sockets; the callback
  // fires once in-flight requests finish
  server.close((err) => {
    if (err) logger.error({ err }, "Error during shutdown");
    void database.close().finally(() => exit(err ? 1 : 0));
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  exit(1);
});
