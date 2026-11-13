/** Bump whenever matching or normalization code changes; forces unconditional refetches. */
export const FILTER_VERSION = 1;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SCHEDULER_TICK_MS = 5 * MINUTE;
export const SCHEDULER_FIRST_TICK_MS = 10_000;
export const DUE_TOLERANCE_MS = 60_000;

/** Max effective age stored by the poller; also the in-memory dedupe window. */
export const STORE_WINDOW_MS = 7 * DAY;
/** new/hidden jobs older than this are deleted by cleanup. */
export const RETENTION_MS = 30 * DAY;
export const CLEANUP_INTERVAL_MS = DAY;

export const POLL_BUDGET_MS = 5 * MINUTE;

export const HTTP_TIMEOUT_MS = 15_000;
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

export const JOB_STATES = ["new", "saved", "hidden", "applied"] as const;
export const COMPANY_STATUSES = ["ok", "needs_review", "manual_only"] as const;
export const SUGGESTION_STATES = ["open", "dismissed", "added"] as const;

export type Tier = (typeof TIERS)[number];
export type TierFilter = (typeof TIER_FILTERS)[number];
export type JobState = (typeof JOB_STATES)[number];
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

/** Locks for runPoll / runNotify (pg advisory lock keys). */
export const POLL_LOCK_KEY = 74_201;
export const NOTIFY_LOCK_KEY = 74_202;
