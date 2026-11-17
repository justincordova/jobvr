import { HttpError } from "./http";
import { SchemaDriftError } from "./sources/validate";

/** Minimal pino-compatible logger port (pino satisfies it). */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  /** A logger whose lines carry these fields, e.g. `{ module: "poll" }`. */
  child(bindings: Record<string, unknown>): Logger;
}

const noop = () => {};
export const silentLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => silentLogger,
};

/**
 * Log fields for an error. Expected failures (HTTP status, schema drift) are
 * one line with their status and URL; anything else keeps its stack, since it's
 * a bug worth reading in full.
 */
export const errorFields = (err: unknown): Record<string, unknown> => {
  if (err instanceof HttpError) {
    return { error: err.message, ...(err.status !== undefined && { status: err.status }) };
  }
  if (err instanceof SchemaDriftError) return { error: err.message };
  if (err instanceof Error && err.name === "AbortError") return { error: "aborted" };
  return { err };
};

/** Short "312 ms" / "6.1 s" / "5 min" for log messages. */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Number((ms / 60_000).toFixed(1))} min`;
};

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const formatValue = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return /[\s"=]/.test(v) ? JSON.stringify(v) : v;
  return JSON.stringify(v) ?? String(v);
};

const time = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  /** ANSI colors; defaults to whether stdout is a terminal. */
  color?: boolean;
  /** Fields left out of the line (e.g. internal ids the message already names). */
  hide?: readonly string[];
  /** Where lines go (tests capture them). */
  write?: (line: string, level: LogLevel) => void;
  now?: () => Date;
}

/**
 * Human-readable logger for the CLI scripts, in the same shape as the server's
 * dev output:
 *
 *   14:02:11.204 INFO  poll · Ramp (Ashby) · +2 new · 1 closed  listings=120
 *
 * Extra fields follow as key=value; an `err` prints its stack on the lines below.
 */
export const createConsoleLogger = (
  options: ConsoleLoggerOptions = {},
  bindings: Record<string, unknown> = {},
): Logger => {
  const min = LOG_LEVELS.indexOf(options.level ?? "info");
  const color = options.color ?? Boolean(process.stdout.isTTY);
  const write =
    options.write ??
    ((line: string, level: LogLevel) =>
      (level === "warn" || level === "error" ? process.stderr : process.stdout).write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const log = (level: LogLevel) => (obj: object, msg?: string) => {
    if (LOG_LEVELS.indexOf(level) < min) return;
    const { module, err, ...fields } = { ...bindings, ...obj } as Record<string, unknown>;
    const label = level.toUpperCase().padEnd(5);
    const head = color
      ? `${DIM}${time(now())}${RESET} ${COLORS[level]}${label}${RESET}`
      : `${time(now())} ${label}`;
    const extras = Object.entries(fields)
      .filter(([k, v]) => v !== undefined && !options.hide?.includes(k))
      .map(([k, v]) => `${k}=${formatValue(v)}`)
      .join(" ");
    let line = `${head} ${module ? `${module} · ` : ""}${msg ?? ""}`;
    if (extras) line += color ? `  ${DIM}${extras}${RESET}` : `  ${extras}`;
    if (err !== undefined) {
      const stack = err instanceof Error ? (err.stack ?? err.message) : formatValue(err);
      line += `\n${stack.replace(/^/gm, "    ")}`;
    }
    write(line, level);
  };

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (more) => createConsoleLogger(options, { ...bindings, ...more }),
  };
};

/** LOG_LEVEL from the environment, if it's one the console logger knows. */
export const envLogLevel = (fallback: LogLevel): LogLevel => {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw ?? "") ? (raw as LogLevel) : fallback;
};
