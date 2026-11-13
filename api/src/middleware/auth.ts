import type { MiddlewareHandler } from "hono";
import { env } from "@/config/env";

/**
 * Auth port. With AUTH_MODE=none the tailnet is the auth boundary and every
 * request passes; a Cognito JWT check slots in here on AWS.
 */
export const auth = (): MiddlewareHandler => {
  switch (env.AUTH_MODE) {
    case "none":
      return async (_c, next) => {
        await next();
      };
  }
};
