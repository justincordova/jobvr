import { sql } from "drizzle-orm";
import {
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

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    data: jsonb("data").notNull().default({}),
    lastVisitAt: ts("last_visit_at"),
    lastPollAt: ts("last_poll_at"),
    lastPushAt: ts("last_push_at"),
    lastCleanupAt: ts("last_cleanup_at"),
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
    baseline: boolean("baseline").notNull().default(false),
    notifiedAt: ts("notified_at"),
    closedAt: ts("closed_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_effective_at_idx").on(t.effectiveAt.desc()),
    index("jobs_unnotified_idx").on(t.effectiveAt).where(sql`${t.notifiedAt} is null`),
    index("jobs_company_id_idx").on(t.companyId),
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
  },
  (t) => [
    primaryKey({ columns: [t.source, t.sourceJobId] }),
    index("job_sources_job_id_idx").on(t.jobId),
    index("job_sources_url_key_idx").on(t.urlKey),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    status: text("status").notNull().default("applied"),
    appliedAt: ts("applied_at").notNull().defaultNow(),
    notes: text("notes"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("applications_job_id_key").on(t.jobId).where(sql`${t.jobId} is not null`)],
);

export const suggestions = pgTable("suggestions", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  ats: text("ats").notNull(),
  slug: text("slug"),
  listingCount: integer("listing_count").notNull().default(0),
  sampleTitles: text("sample_titles").array().notNull().default(sql`'{}'::text[]`),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  state: text("state").notNull().default("open"),
});

export type CompanyRow = typeof companies.$inferSelect;
export type SourceStateRow = typeof sourceState.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobSourceRow = typeof jobSources.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type SuggestionRow = typeof suggestions.$inferSelect;
