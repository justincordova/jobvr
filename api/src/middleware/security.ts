import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { env } from "@/config/env";
import { BODY_LIMIT_BYTES, HTTP_STATUS } from "@/constants";
import { fail } from "@/utils/response";

/**
 * Response headers: secure headers and CORS. Applied before rate limiting so
 * every response (including 429s) is readable by allowed browser origins.
 */
export const securityHeaders = (): MiddlewareHandler[] => [
  secureHeaders(),
  cors({
    // Explicit allowlist in every environment (credentials + reflected origins is unsafe)
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
  }),
];

/**
 * Request guards: compression, request timeout, and body size limit. The body
 * limit runs inside the timeout so slow uploads are bounded by it.
 */
export const requestGuards = (): MiddlewareHandler[] => [
  compress(),
  // Responds 503 once the deadline passes. The handler is not cancelled and
  // keeps running in the background, so long-running work should check its own deadline.
  timeout(
    env.REQUEST_TIMEOUT_MS,
    () => new HTTPException(HTTP_STATUS.SERVICE_UNAVAILABLE, { message: "Request timed out" }),
  ),
  bodyLimit({
    maxSize: BODY_LIMIT_BYTES,
    onError: (c) =>
      fail(
        c,
        HTTP_STATUS.PAYLOAD_TOO_LARGE,
        `Request body exceeds the ${BODY_LIMIT_BYTES / 1024 / 1024}MB limit`,
      ),
  }),
];
