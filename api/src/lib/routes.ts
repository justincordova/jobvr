import { z } from "@hono/zod-openapi";

export const json = <T>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

export const ErrorResponse = z
  .object({
    success: z.literal(false),
    error: z.string(),
    message: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .openapi("ErrorResponse");

/** `{ success: true, data }` envelope. */
export const envelope = <T extends z.ZodType>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    message: z.string().optional(),
    count: z.number().int().optional(),
  });

export const NullResponse = envelope(z.null());

export const validationError = json(ErrorResponse, "Request validation failed");
export const notFound = json(ErrorResponse, "Not found");
export const conflict = json(ErrorResponse, "Conflict");

/** Errors any route can return (rate limit, timeout, unexpected failure). */
export const commonErrors = {
  429: json(ErrorResponse, "Too many requests"),
  500: json(ErrorResponse, "Internal server error"),
  503: json(ErrorResponse, "Request timed out"),
};

/** Errors for routes that change data: the cross-site guard refuses foreign pages. */
export const writeErrors = {
  403: json(ErrorResponse, "Cross-site request refused"),
};

/** Additional errors for routes that accept a JSON body. */
export const bodyErrors = {
  413: json(ErrorResponse, "Request body too large"),
};

/** Nullable ISO timestamp. */
export const isoNullable = z.iso.datetime().nullable();

export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Comma-separated query list → trimmed, non-empty strings. */
export const csv = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(item).optional());
