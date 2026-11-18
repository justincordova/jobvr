export const ACTIVITY_LEVELS = ["info", "warn", "error", "fatal"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export interface ActivityEntry {
  seq: number;
  time: string;
  level: ActivityLevel;
  module: string | null;
  msg: string;
  error: string | null;
}

export interface ActivityLog {
  /** Takes one serialized pino line (the multistream destination interface). */
  write(line: string): void;
  /** Entries with `seq > after`, oldest first, at most `limit` (the newest ones). */
  list(after: number, limit: number): ActivityEntry[];
  readonly latestSeq: number;
  readonly startedAt: Date;
  readonly capacity: number;
}

export const ACTIVITY_CAPACITY = 1000;
const MAX_TEXT = 2000;
const REDACTED = "[redacted]";
// Shorter values (the dev password "jobvr") would blank ordinary words
const MIN_SECRET_LENGTH = 8;

const PATTERNS: [RegExp, string][] = [
  // scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  [/\btskey-[A-Za-z0-9-]+/g, REDACTED],
  [/\b(ntfy\.sh\/)[^\s"'/?#]+/gi, `$1${REDACTED}`],
];

/** The secret parts of the app's configuration: full NTFY_URL, its topic, the database password. */
export const secretsFromEnv = (env: {
  NTFY_URL?: string;
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
}): string[] => {
  const out: string[] = [];
  if (env.OPENAI_API_KEY) out.push(env.OPENAI_API_KEY);
  if (env.NTFY_URL) {
    out.push(env.NTFY_URL);
    if (URL.canParse(env.NTFY_URL)) out.push(new URL(env.NTFY_URL).pathname.replace(/^\/+/, ""));
  }
  if (env.DATABASE_URL && URL.canParse(env.DATABASE_URL)) {
    const { password } = new URL(env.DATABASE_URL);
    if (password) out.push(password, decodeURIComponent(password));
  }
  return out;
};

/** Replaces known secrets and secret-shaped strings with "[redacted]". */
export const createRedactor = (secrets: readonly string[]) => {
  const exact = [...new Set(secrets.filter((s) => s.length >= MIN_SECRET_LENGTH))].sort(
    (a, b) => b.length - a.length,
  );
  return (text: string): string => {
    let out = text;
    for (const s of exact) out = out.split(s).join(REDACTED);
    for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
    return out;
  };
};

const cap = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

const errorText = (line: Record<string, unknown>): string | null => {
  if (typeof line.error === "string") return line.error;
  const err = line.err;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return null;
};

/**
 * The last `capacity` log lines at info and above, kept in memory for the web
 * app's Logs page. Only the message and the error's message are kept, both
 * scrubbed of secrets; nothing else from the line (no stacks, no request data).
 */
export const createActivityLog = (
  options: { capacity?: number; secrets?: readonly string[]; now?: () => Date } = {},
): ActivityLog => {
  const capacity = options.capacity ?? ACTIVITY_CAPACITY;
  const redact = createRedactor(options.secrets ?? []);
  const startedAt = (options.now ?? (() => new Date()))();
  const entries: ActivityEntry[] = [];
  let seq = 0;

  return {
    write(raw: string) {
      let line: Record<string, unknown>;
      try {
        line = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      const level = line.level;
      if (!ACTIVITY_LEVELS.includes(level as ActivityLevel)) return;
      const error = errorText(line);
      seq += 1;
      entries.push({
        seq,
        time: typeof line.time === "string" ? line.time : new Date().toISOString(),
        level: level as ActivityLevel,
        module: typeof line.module === "string" ? line.module : null,
        msg: cap(redact(typeof line.msg === "string" ? line.msg : "")),
        error: error === null ? null : cap(redact(error)),
      });
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
    },
    list(after, limit) {
      const newer = entries.filter((e) => e.seq > after);
      return newer.slice(Math.max(0, newer.length - limit));
    },
    get latestSeq() {
      return seq;
    },
    startedAt,
    capacity,
  };
};
