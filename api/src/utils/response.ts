import { STATUS_CODES } from "node:http";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Send successful response (200 OK)
export const ok = <T>(c: Context, data: T, extras: { message?: string; count?: number } = {}) =>
  c.json({ success: true as const, data, ...extras }, 200);

// Send created response (201 Created)
export const created = <T>(c: Context, data: T, message?: string) =>
  c.json({ success: true as const, data, message }, 201);

// Send error response. `error` defaults to the standard reason phrase for the status.
export const fail = <S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  message?: string,
  options: { error?: string; details?: unknown[] } = {},
) =>
  c.json(
    {
      success: false as const,
      error: options.error ?? STATUS_CODES[status] ?? "Error",
      message,
      details: options.details,
    },
    status,
  );

/** "careersUrl" -> "careers URL", "quietHours.start" -> "quiet hours start". */
const fieldName = (path: readonly PropertyKey[]) =>
  path
    .filter((p): p is string => typeof p === "string")
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\burl\b/g, "URL");

/**
 * A readable validation message naming the fields: "careers URL: Invalid URL;
 * tier: Invalid option". The issues themselves still go in `details`.
 */
export const validationMessage = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) => {
  const parts = issues.slice(0, 3).map((i) => {
    const field = fieldName(i.path);
    return field ? `${field}: ${i.message}` : i.message;
  });
  const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
  return parts.length > 0 ? `${parts.join("; ")}${more}` : "Request validation failed";
};
