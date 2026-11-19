/** Bump whenever matching or normalization code changes; forces unconditional refetches. */
export const FILTER_VERSION = 13;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SCHEDULER_TICK_MS = 5 * MINUTE;
export const SCHEDULER_FIRST_TICK_MS = 10_000;
export const DUE_TOLERANCE_MS = 60_000;

export const DAY_MS = DAY;
/**
 * Cleanup deletes new/hidden jobs this long past the store window ("Keep jobs
 * posted within"). Retention must exceed the window, or a deleted job that is
 * still listed would be re-inserted on the next poll.
 */
export const RETENTION_MARGIN_DAYS = 15;
/**
 * Explicit entry-level roles on company boards ("Software Engineer, New Grad")
 * are stored up to this old, whatever the store window: firms post them months
 * ahead and keep them open (HRT's 2027 Grads role was 4 months old in Nov 2026).
 */
export const ENTRY_LEVEL_STORE_DAYS = 180;
/**
 * When every board of one ATS fails in a poll (at least this many, all with
 * network errors, 5xx or 429), the ATS is down: no board's health changes.
 */
export const SOURCE_OUTAGE_MIN_TARGETS = 3;
export const CLEANUP_INTERVAL_MS = DAY;

export const POLL_BUDGET_MS = 5 * MINUTE;
/**
 * Polling is stalled when no poll has finished for this many poll intervals
 * (counting from boot, so a fresh process gets time for its first poll).
 */
export const STALE_POLL_INTERVALS = 3;

export const HTTP_TIMEOUT_MS = 15_000;
/** A whole ATS board: big ones (Anduril's is ~2.6 MB) take 20-30 s to serve. */
export const BOARD_TIMEOUT_MS = 60_000;
export const HTTP_MAX_RETRY_AFTER_MS = 30_000;
export const HTTP_MAX_BYTES = 50 * 1024 * 1024;
export const USER_AGENT = "jobvr (personal job alerts)";

/** More than this share of a non-empty response failing validation is a fetch failure. */
export const INVALID_ITEM_THRESHOLD = 0.5;

export const FUZZY_TITLE_THRESHOLD = 0.85;
export const FAILURES_BEFORE_REVIEW = 3;

export const ANNUALIZE = { hour: 2080, week: 52, month: 12, year: 1 } as const;

export const TIMEZONE = "America/New_York";

export const TIERS = ["S", "A", "Mid", "Startup", "Corporate"] as const;
export const TIER_FILTERS = [...TIERS, "Unlisted"] as const;

/**
 * Where a company's tier came from: the seed list, the AI rater, a person
 * (never overwritten), or nobody yet (`pending`: the AI rates it when it can).
 */
export const TIER_SOURCES = ["seed", "auto", "manual", "pending"] as const;

export const JOB_STATES = ["new", "saved", "hidden", "applied"] as const;
export const COMPANY_STATUSES = ["ok", "needs_review", "manual_only"] as const;
export const SUGGESTION_STATES = ["open", "dismissed", "added"] as const;

export type Tier = (typeof TIERS)[number];
export type TierFilter = (typeof TIER_FILTERS)[number];
export type TierSource = (typeof TIER_SOURCES)[number];
export type JobState = (typeof JOB_STATES)[number];
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

/** Locks for runPoll / runNotify (pg advisory lock keys). */
export const POLL_LOCK_KEY = 74_201;
export const NOTIFY_LOCK_KEY = 74_202;
