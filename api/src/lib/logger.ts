import pino from "pino";
import { env } from "@/config/env";
import { createActivityLog, secretsFromEnv } from "@/lib/activity-log";

/**
 * The last lines at info and above, scrubbed of secrets, for the web app's
 * Logs page (GET /api/logs). Fed by the root logger below.
 */
export const activityLog = createActivityLog({ secrets: secretsFromEnv(env) });

// "silent" isn't a stream level; the logger itself is silent then
const stdoutLevel = env.LOG_LEVEL === "silent" ? "fatal" : env.LOG_LEVEL;

/**
 * Root Pino logger. Production writes structured JSON to stdout (every field
 * kept for `docker compose logs | jq`); development pretty-prints one line per
 * event, with the component first:
 *
 *   22:14:34.621 INFO: http · GET /api/jobs 200 · 23 ms
 *   22:20:06.004 INFO: poll · poll finished in 4.3 s · 64 targets: 64 unchanged · ...
 *
 * Every line at info and above is also copied into `activityLog`. Request-scoped
 * child loggers come from the hono-pino middleware; domain code gets child
 * loggers tagged with `module`. Silent in tests.
 */
export const logger = pino(
  {
    level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
    // One app, one container: pid/hostname say nothing. Levels and times readable
    // as-is in `docker compose logs` ("level":"warn", ISO time)
    base: null,
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    {
      level: stdoutLevel,
      stream:
        env.NODE_ENV === "development"
          ? pino.transport({
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
            })
          : pino.destination({ dest: 1, sync: true }),
    },
    { level: "info", stream: activityLog },
  ]),
);
