import { OpenAPIHono } from "@hono/zod-openapi";
import type { Database, Registry } from "@jobvr/core";
import type { RequestIdVariables } from "hono/request-id";
import type { PinoLogger } from "hono-pino";
import { HTTP_STATUS } from "@/constants";
import type { ActivityLog } from "@/lib/activity-log";
import { fail, validationMessage } from "@/utils/response";

/** Runtime dependencies injected into every request (so tests can swap them). */
export interface AppDeps {
  database: Database;
  registry: Registry;
  now: () => Date;
  /** Recent log lines for GET /api/logs. */
  activity: ActivityLog;
}

export interface AppBindings {
  Variables: RequestIdVariables & {
    logger: PinoLogger;
    deps: AppDeps;
  };
}

/**
 * Create an OpenAPI-aware router. Every router (the root app and each module)
 * must come from here so failed request validation is reshaped into the
 * standard error envelope instead of Zod's default response.
 */
export const createRouter = () =>
  new OpenAPIHono<AppBindings>({
    strict: false,
    defaultHook: (result, c) => {
      if (!result.success) {
        return fail(c, HTTP_STATUS.BAD_REQUEST, validationMessage(result.error.issues), {
          error: "Validation Error",
          details: result.error.issues,
        });
      }
    },
  });

export type AppRouter = ReturnType<typeof createRouter>;
