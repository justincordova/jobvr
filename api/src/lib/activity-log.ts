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
// Shorter values would blank parts of ordinary words
const MIN_SECRET_LENGTH = 4;
// Shorter secrets are only redacted as a whole word, so "test" doesn't blank part of "latest"
const MIN_SUBSTRING_SECRET_LENGTH = 12;

/** A secret value, or a pattern and its replacement (for secrets inside a known shape). */
export type Secret = string | [RegExp, string];

const PATTERNS: [RegExp, string][] = [
  // scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  [/\btskey-[A-Za-z0-9-]+/g, REDACTED],
  [/\b(ntfy\.sh\/)[^\s"'/?#]+/gi, `$1${REDACTED}`],
  // OpenAI keys (sk-..., sk-proj-...)
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  // An Authorization header's value, whatever its scheme
  [
    /\b(authorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token|digest)\s+)?)[^\s"',;]+/gi,
    `$1${REDACTED}`,
  ],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (s: string) =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(s)}(?![A-Za-z0-9])`, "g");

/**
 * The secret parts of the app's configuration: the OpenAI key, the full
 * NTFY_URL and its topic path (whatever its length), the database password.
 */
export const secretsFromEnv = (env: {
  NTFY_URL?: string;
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
}): Secret[] => {
  const out: Secret[] = [];
  const key = env.OPENAI_API_KEY?.trim();
  if (key) out.push(key);
  if (env.NTFY_URL) {
    out.push(env.NTFY_URL);
    if (URL.canParse(env.NTFY_URL)) {
      const url = new URL(env.NTFY_URL);
      const topic = url.pathname.replace(/^\/+|\/+$/g, "");
      if (topic) {
        // The topic is the whole secret: anything after the server, and the topic alone
        out.push([new RegExp(`(${escapeRegExp(url.host)}/)[^\\s"'?#]+`, "gi"), `$1${REDACTED}`]);
        out.push(topic.length >= MIN_SECRET_LENGTH ? topic : [wholeWord(topic), REDACTED]);
      }
    }
  }
  if (env.DATABASE_URL && URL.canParse(env.DATABASE_URL)) {
    const { password } = new URL(env.DATABASE_URL);
    if (password) out.push(password, decodeURIComponent(password));
  }
  return out;
};

/**
 * Replaces known secrets and secret-shaped strings with "[redacted]". Known
 * secrets of 4+ characters are always redacted (short ones as whole words).
 */
export const createRedactor = (secrets: readonly Secret[]) => {
  const values = [
    ...new Set(
      secrets.filter((s): s is string => typeof s === "string" && s.length >= MIN_SECRET_LENGTH),
    ),
  ].sort((a, b) => b.length - a.length);
  const replacements: [RegExp | string, string][] = [
    ...values.map((s): [RegExp | string, string] => [
      s.length >= MIN_SUBSTRING_SECRET_LENGTH ? s : wholeWord(s),
      REDACTED,
    ]),
    ...secrets.filter((s): s is [RegExp, string] => typeof s !== "string"),
    ...PATTERNS,
  ];
  return (text: string): string => {
    let out = text;
    for (const [match, replacement] of replacements) {
      out =
        typeof match === "string"
          ? out.split(match).join(replacement)
          : out.replace(match, replacement);
    }
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
  options: { capacity?: number; secrets?: readonly Secret[]; now?: () => Date } = {},
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
