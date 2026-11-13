import { z } from "zod";

/**
 * Environment variable schema.
 *
 * Parsed once at import time so the process fails fast on invalid config.
 * `.env` is loaded by Node itself (`--env-file-if-exists`) before any module
 * runs, so every value here — including NODE_ENV — is already in process.env.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  APP_NAME: z.string().min(1).default("jobvr"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        // Zod runs refinements even after z.url() fails, so guard with URL.canParse
        z.url().refine((url) => URL.canParse(url) && new URL(url).origin === url, {
          error: "Must be a bare origin like https://example.com (no path or trailing slash)",
        }),
      ),
    ),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(60_000),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_URL: z.string().min(1).default("postgres://jobvr:jobvr@localhost:5432/jobvr"),
  /** Full ntfy topic URL (secret). Pushes are skipped with a warning when unset. */
  NTFY_URL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .pipe(z.url().optional()),
  /** Push click target, e.g. https://jobvr.<tailnet>.ts.net */
  PUBLIC_URL: z.url().default("http://localhost:5173"),
  /** The tailnet is the auth boundary in the MVP. */
  AUTH_MODE: z.enum(["none"]).default("none"),
  SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Built SPA served by the API (relative to the working directory). */
  WEB_DIST_DIR: z.string().min(1).default("../web/dist"),
  /** Drizzle migrations folder (relative to the working directory). */
  MIGRATIONS_DIR: z.string().min(1).default("../core/drizzle"),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env: Env = parsed.data;
