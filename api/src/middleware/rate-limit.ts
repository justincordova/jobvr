import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { env } from "@/config/env";
import { HTTP_STATUS, RATE_LIMIT_SKIP_PATHS } from "@/constants";
import { fail } from "@/utils/response";

/**
 * Identify the client for rate limiting.
 *
 * With TRUST_PROXY=true the key is the LAST X-Forwarded-For entry, which is the
 * address appended by a single trusted reverse proxy. Earlier entries are
 * client-controlled and can be spoofed. Otherwise the socket address is used.
 */
export const clientKey = (c: Context): string => {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No Node socket (e.g. app.request() in tests).
    return "unknown";
  }
};

/**
 * In-memory rate limiter. Each instance keeps its own counters, so swap in a
 * shared store (e.g. Redis) when running more than one replica.
 */
export const rateLimit = ({
  limit = env.RATE_LIMIT_MAX,
  windowMs = env.RATE_LIMIT_WINDOW,
}: {
  limit?: number;
  windowMs?: number;
} = {}) =>
  rateLimiter({
    limit,
    windowMs,
    standardHeaders: "draft-7",
    keyGenerator: clientKey,
    skip: (c) => RATE_LIMIT_SKIP_PATHS.includes(c.req.path),
    handler: (c) =>
      fail(c, HTTP_STATUS.TOO_MANY_REQUESTS, "Too many requests, please try again later"),
  });
