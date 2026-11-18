import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { COMPANY_STATUSES, JOB_STATES, SUGGESTION_STATES, TIER_SOURCES, TIERS } from "../constants";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** `col IN ('a', 'b')` from a constant list, so a hand edit can't store a value the code doesn't know. */
const oneOf = (col: AnyPgColumn, values: readonly string[]) =>
  sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    data: jsonb("data").notNull().default({}),
    lastVisitAt: ts("last_visit_at"),
    /** When the latest poll started (also how "is a poll due" is decided). */
    lastPollAt: ts("last_poll_at"),
    /** When the latest poll finished writing its results (what /health checks). */
    lastPollOkAt: ts("last_poll_ok_at"),
    /** When the app last pushed a "polling stalled" alert (at most one a day). */
    pollStallAlertAt: ts("poll_stall_alert_at"),
    lastPushAt: ts("last_push_at"),
    lastCleanupAt: ts("last_cleanup_at"),
    /** Written by deploy/backup.sh after each pg_dump (the app only reads them). */
    lastBackupAt: ts("last_backup_at"),
    backupError: text("backup_error"),
    backupErrorAt: ts("backup_error_at"),
    /** When the app last pushed a backup alert (at most one a day). */
    backupAlertAt: ts("backup_alert_at"),
    /** ATS sources that look down, by id (see `SourceOutage`); cleared once a board answers. */
    sourceOutages: jsonb("source_outages").notNull().default({}),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    city: text("city"),
    state: text("state"),
    tier: text("tier").notNull(),
    tierSource: text("tier_source").notNull().default("seed"),
    /** One line on why it has this tier (from the AI rater); null otherwise. */
    tierReason: text("tier_reason"),
    /** When the AI rater set the tier. */
    tieredAt: ts("tiered_at"),
    track: boolean("track").notNull().default(false),
    ats: text("ats").notNull(),
    slug: text("slug"),
    careersUrl: text("careers_url"),
    notes: text("notes"),
    status: text("status").notNull().default("ok"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("companies_tier_check", oneOf(t.tier, TIERS)),
    check("companies_status_check", oneOf(t.status, COMPANY_STATUSES)),
    check("companies_tier_source_check", oneOf(t.tierSource, TIER_SOURCES)),
    uniqueIndex("companies_normalized_name_key").on(t.normalizedName),
    uniqueIndex("companies_ats_slug_key")
      .on(t.ats, sql`lower(${t.slug})`)
      .where(sql`${t.slug} is not null`),
  ],
);

export const sourceState = pgTable("source_state", {
  key: text("key").primaryKey(),
  source: text("source").notNull(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  slug: text("slug"),
  etag: text("etag"),
  filtersHash: text("filters_hash"),
  lastAttemptAt: ts("last_attempt_at"),
  lastSuccessAt: ts("last_success_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  baselinedAt: ts("baselined_at"),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    title: text("title").notNull(),
    locations: text("locations").array().notNull().default(sql`'{}'::text[]`),
    url: text("url").notNull(),
    primarySource: text("primary_source").notNull(),
    firstSeenAt: ts("first_seen_at").notNull(),
    effectiveAt: ts("effective_at").notNull(),
    salaryMinUsd: integer("salary_min_usd"),
    salaryMaxUsd: integer("salary_max_usd"),
    state: text("state").notNull().default("new"),
    /** When it was marked applied; null in every other state. */
    appliedAt: ts("applied_at"),
    baseline: boolean("baseline").notNull().default(false),
    notifiedAt: ts("notified_at"),
    closedAt: ts("closed_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_effective_at_idx").on(t.effectiveAt.desc()),
    index("jobs_unnotified_idx").on(t.effectiveAt).where(sql`${t.notifiedAt} is null`),
    index("jobs_company_id_idx").on(t.companyId),
    check("jobs_state_check", oneOf(t.state, JOB_STATES)),
  ],
);

export const jobSources = pgTable(
  "job_sources",
  {
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    urlKey: text("url_key"),
    title: text("title").notNull(),
    category: text("category"),
    postedAt: ts("posted_at").notNull(),
    postedAtPrecision: text("posted_at_precision").notNull(),
    removedAt: ts("removed_at"),
    /** Years of experience the description asks for: null = not checked, 0 = none named. */
    requiredYears: integer("required_years"),
    /** Plain-text description (capped), for the detail panel; null when the source has none. */
    description: text("description"),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.sourceJobId] }),
    index("job_sources_job_id_idx").on(t.jobId),
    index("job_sources_url_key_idx").on(t.urlKey),
    check("job_sources_precision_check", oneOf(t.postedAtPrecision, ["instant", "day"])),
    check("job_sources_years_check", sql`${t.requiredYears} is null or ${t.requiredYears} >= 0`),
  ],
);

export const suggestions = pgTable(
  "suggestions",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    ats: text("ats").notNull(),
    slug: text("slug"),
    /** Sum of `listingCounts`, kept for sorting and the "> 0" filter. */
    listingCount: integer("listing_count").notNull().default(0),
    /** Matching listings per aggregator (`{ simplify: 3, speedyapply: 1 }`), each replaced by its own poll. */
    listingCounts: jsonb("listing_counts").$type<Record<string, number>>().notNull().default({}),
    sampleTitles: text("sample_titles").array().notNull().default(sql`'{}'::text[]`),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    state: text("state").notNull().default("open"),
  },
  (t) => [check("suggestions_state_check", oneOf(t.state, SUGGESTION_STATES))],
);

export type CompanyRow = typeof companies.$inferSelect;
export type SourceStateRow = typeof sourceState.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobSourceRow = typeof jobSources.$inferSelect;
export type SuggestionRow = typeof suggestions.$inferSelect;
