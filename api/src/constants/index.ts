export const NOT_FOUND_MESSAGE = "The requested endpoint does not exist";

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const BODY_LIMIT_BYTES = 1024 * 1024;

/** Paths excluded from rate limiting (monitoring and API docs). */
export const RATE_LIMIT_SKIP_PATHS = ["/health", "/openapi.json", "/reference", "/docs"];
