import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import type { PinoLogger } from "hono-pino";
import { HTTP_STATUS } from "@/constants";
import { fail } from "@/utils/response";

export interface AppBindings {
  Variables: RequestIdVariables & {
    logger: PinoLogger;
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
        return fail(c, HTTP_STATUS.BAD_REQUEST, "Request validation failed", {
          error: "Validation Error",
          details: result.error.issues,
        });
      }
    },
  });

export type AppRouter = ReturnType<typeof createRouter>;
