import pino from "pino";
import { env } from "@/config/env";

/**
 * Root Pino logger. Production writes structured JSON to stdout (every field
 * kept for `docker compose logs | jq`); development pretty-prints one line per
 * event, with the component first:
 *
 *   22:14:34.621 INFO: http · GET /api/jobs 200 · 23 ms
 *   22:20:06.004 INFO: poll · poll finished in 4.3 s · 64 targets: 64 unchanged · ...
 *
 * Request-scoped child loggers come from the hono-pino middleware; domain code
 * gets child loggers tagged with `module`. Silent in tests.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  // One app, one container: pid/hostname say nothing. Levels and times readable
  // as-is in `docker compose logs` ("level":"warn", ISO time)
  base: null,
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            translateTime: "SYS:HH:MM:ss.l",
            // Shown in the message instead (or noise in development)
            ignore:
              "pid,hostname,app,module,reqId,req,res,responseTime,target,env,port,scheduler,signal",
            messageFormat:
              "{if module}{module} · {end}{msg}{if responseTime} · {responseTime} ms{end}",
            singleLine: true,
          },
        }
      : undefined,
});
