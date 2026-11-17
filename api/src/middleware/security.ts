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
/**
 * The web app loads only its own files; job links are plain navigations. Inline
 * styles are allowed (Radix injects a scroll-lock <style>). /reference is left
 * out: the Scalar API docs load from a CDN.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const contentSecurityPolicy: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.path === "/reference" || c.req.path === "/docs") return;
  c.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
};

export const securityHeaders = (): MiddlewareHandler[] => [
  secureHeaders(),
  contentSecurityPolicy,
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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request guard. There's no login (tailnet only), so any page open
 * in the browser could POST to jobvr (add a suggestion, mark a visit). Writes
 * are refused when the browser says another site started them
 * (`Sec-Fetch-Site`), or, for browsers that don't send it, when `Origin` names
 * another host. Allowed origins always pass; requests with neither header
 * (curl, scripts) aren't from a web page and pass too.
 */
export const crossSiteGuard = (): MiddlewareHandler => async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header("origin");
  if (origin && env.ALLOWED_ORIGINS.includes(origin)) return next();
  const site = c.req.header("sec-fetch-site");
  const otherHost = () => {
    if (!origin) return false;
    if (!URL.canParse(origin)) return true; // includes the opaque "null" origin
    return new URL(origin).host !== c.req.header("host");
  };
  const foreign = site ? site === "cross-site" || site === "same-site" : otherHost();
  if (foreign) {
    return fail(c, HTTP_STATUS.FORBIDDEN, "Cross-site requests can't change jobvr data");
  }
  return next();
};
