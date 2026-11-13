import pino from "pino";
import { env } from "@/config/env";

/**
 * Root Pino logger. Writes structured JSON to stdout in production, pretty
 * output in development (pino-pretty, a dev dependency), and nothing in test.
 * Request-scoped child loggers are created by the hono-pino middleware.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
});
