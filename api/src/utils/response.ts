import { STATUS_CODES } from "node:http";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Standard API response format
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  count?: number;
  details?: unknown[];
}

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
