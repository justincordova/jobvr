import { and, asc, desc, eq, gt, gte, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { JobState, TierFilter } from "../constants";
import type { DbOrTx } from "../db/client";
import { companies, type JobRow, jobSources, jobs } from "../db/schema";
import { NotFoundError } from "../errors";
import { type KeyLine, keyLines } from "../key-lines";
import {
  isEntryLevelTitle,
  isVisible,
  matchedLocationLabels,
  passesLocationRule,
  type SourceKind,
} from "../matching";
import { normalizeCompanyName, tokenize } from "../normalize";
import { byRank, rankScore } from "../rank";
import { startOfEasternDay } from "../schedule";
import { REMOTE_US_LABEL, type Settings } from "../settings";
import { getAdapter } from "../sources/registry";
import type { Registry } from "../sources/types";
import { getSettingsState, setSettingsTimestamp } from "./settings";

export const JOB_VIEWS = ["feed", "saved", "applied", "hidden"] as const;
export const JOB_AGES = ["1h", "today", "3d", "all"] as const;
export type JobViewName = (typeof JOB_VIEWS)[number];
export type JobAge = (typeof JOB_AGES)[number];

export interface JobQuery {
  view?: JobViewName;
  age?: JobAge;
  location?: string[];
  /** Company ids and/or "unlisted". */
  company?: string[];
  tier?: TierFilter[];
  source?: string[];
  /** "entry": only entry-level jobs (see `entryLevel`). */
  level?: "entry";
  /**
   * "best" (see `rankScore`; the feed's default), "applied" (latest applied
   * first; the applied view's default) or "newest" (the other views' default).
   */
  sort?: JobSort;
  /** Text search: every word must appear in the title, company or locations. */
  q?: string;
  /** Rows to return (default 500, at most MAX_JOBS_LIMIT); `total` says how many matched. */
  limit?: number;
}

export const JOB_SORTS = ["best", "newest", "applied"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export interface JobSourceView {
  source: string;
  url: string;
  title: string;
  category: string | null;
  removedAt: Date | null;
  requiredYears: number | null;
}

export interface JobRecord {
  id: string;
  title: string;
  companyId: string | null;
  companyName: string;
  tier: TierFilter;
  locations: string[];
  url: string;
  primarySource: string;
  firstSeenAt: Date;
  effectiveAt: Date;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  state: JobState;
  appliedAt: Date | null;
  baseline: boolean;
  closedAt: Date | null;
  notifiedAt: Date | null;
  sources: JobSourceView[];
}

/**
 * `entryLevel`: the title says so, or SimplifyJobs (a new-grad-only list) lists it.
 * `matchedLocations`: the location strings that match an enabled location, so
 * the feed can show "King of Prussia, PA" before "Farmington Hills, MI".
 */
export type JobWithFlags = JobRecord & {
  isNew: boolean;
  entryLevel: boolean;
  matchedLocations: string[];
  /** Other postings of the same role (see `collapseReposts`), newest first. */
  duplicateIds: string[];
  /** "Best first" points (see `rankScore`). */
  score: number;
};

/**
 * Same company, same title, same locations: a company posting one role
 * several times (H2O.ai's three "Software Engineer" listings). Distinct
 * postings stay separate in the database; the feed shows one row.
 */
const repostKey = (j: JobRecord) =>
  [
    j.companyId ?? normalizeCompanyName(j.companyName),
    tokenize(j.title).join(" "),
    j.locations
      .map((l) => tokenize(l).join(" "))
      .sort()
      .join("|"),
  ].join("\u0000");

/** Keeps the first (newest) job of each repost group and lists the others on it. */
export const collapseReposts = <T extends JobRecord>(
  list: readonly T[],
): (T & { duplicateIds: string[] })[] => {
  const groups = new Map<string, T & { duplicateIds: string[] }>();
  for (const j of list) {
    const key = repostKey(j);
    const first = groups.get(key);
    if (first) first.duplicateIds.push(j.id);
    else groups.set(key, { ...j, duplicateIds: [] });
  }
  return [...groups.values()];
};

export interface JobList {
  jobs: JobWithFlags[];
  /** Rows matching the view and filters (after collapsing reposts), before `limit`. */
  total: number;
  lastVisitAt: Date | null;
  newSinceLastVisit: number;
}

export const MAX_JOBS = 500;
export const MAX_JOBS_LIMIT = 5000;

/** Words of a search, matched as word prefixes ("back" finds "Backend"). */
const searchWords = (q: string | undefined) => (q ? tokenize(q) : []);
const matchesSearch = (j: JobRecord, words: readonly string[]) => {
  if (words.length === 0) return true;
  const haystack = tokenize([j.title, j.companyName, ...j.locations].join(" "));
  return words.every((w) => haystack.some((t) => t.startsWith(w)));
};
const HOUR = 3_600_000;

export const kindLookup =
  (registry: Registry) =>
  (source: string): SourceKind | undefined =>
    getAdapter(registry, source)?.kind;

/** Loads jobs (with sources and company tier) matching SQL conditions. */
export const loadJobViews = async (db: DbOrTx, where: SQL | undefined): Promise<JobRecord[]> => {
  const rows = await db
    .select({ job: jobs, tier: companies.tier })
    .from(jobs)
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(where)
    .orderBy(desc(jobs.effectiveAt), asc(jobs.id));
  if (rows.length === 0) return [];
  const sourcesByJob = new Map<string, JobSourceView[]>();
  const ids = rows.map((r) => r.job.id);
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    // Never the description: up to 20k chars per row, and only the detail panel shows it
    const srcRows = await db
      .select({
        jobId: jobSources.jobId,
        source: jobSources.source,
        url: jobSources.url,
        title: jobSources.title,
        category: jobSources.category,
        removedAt: jobSources.removedAt,
        requiredYears: jobSources.requiredYears,
      })
      .from(jobSources)
      .where(inArray(jobSources.jobId, chunk));
    for (const s of srcRows) {
      const list = sourcesByJob.get(s.jobId) ?? [];
      list.push({
        source: s.source,
        url: s.url,
        title: s.title,
        category: s.category,
        removedAt: s.removedAt,
        requiredYears: s.requiredYears,
      });
      sourcesByJob.set(s.jobId, list);
    }
  }
  return rows.map(({ job, tier }) =>
    toView(job, (tier as TierFilter | null) ?? "Unlisted", sourcesByJob.get(job.id) ?? []),
  );
};

const toView = (job: JobRow, tier: TierFilter, sources: JobSourceView[]): JobRecord => ({
  id: job.id,
  title: job.title,
  companyId: job.companyId,
  companyName: job.companyName,
  tier,
  locations: job.locations,
  url: job.url,
  primarySource: job.primarySource,
  firstSeenAt: job.firstSeenAt,
  effectiveAt: job.effectiveAt,
  salaryMinUsd: job.salaryMinUsd,
  salaryMaxUsd: job.salaryMaxUsd,
  state: job.state as JobState,
  appliedAt: job.appliedAt,
  baseline: job.baseline,
  closedAt: job.closedAt,
  notifiedAt: job.notifiedAt,
  sources,
});

/**
 * The pushable rule without `notified_at`: non-baseline, new/saved, tracked
 * tier, within max age, visible. Shared by pushes and "new since last visit".
 */
export const isFreshMatch = (
  job: JobRecord,
  s: Settings,
  kindOf: (source: string) => SourceKind | undefined,
  now: Date,
): boolean =>
  !job.baseline &&
  (job.state === "new" || job.state === "saved") &&
  s.tiersToTrack.includes(job.tier) &&
  now.getTime() - job.effectiveAt.getTime() <= s.maxJobAgeHours * HOUR &&
  isVisible(job, s, kindOf);

const ageCutoff = (age: JobAge, now: Date): Date | null => {
  switch (age) {
    case "1h":
      return new Date(now.getTime() - HOUR);
    case "today":
      return startOfEasternDay(now);
    case "3d":
      return new Date(now.getTime() - 72 * HOUR);
    case "all":
      return null;
  }
};

const VIEW_STATES: Record<JobViewName, JobState[]> = {
  feed: ["new", "saved"],
  saved: ["saved"],
  applied: ["applied"],
  hidden: ["hidden"],
};

/** "Best first" points for a stored job (see `rankScore`). */
export const scoreJob = (
  j: JobRecord,
  s: Settings,
  kindOf: (source: string) => SourceKind | undefined,
  now: Date,
): number => {
  const years = j.sources
    .map((src) => src.requiredYears)
    .filter((y): y is number => y !== null && y !== undefined);
  return rankScore(
    {
      effectiveAt: j.effectiveAt,
      tier: j.tier,
      entryTitle: isEntryLevelTitle(j.title, s),
      onNewGradList: j.sources.some((src) => kindOf(src.source) === "aggregator"),
      requiredYears: years.length > 0 ? Math.min(...years) : null,
      namedPlace: matchedLocationLabels(j.locations, s).some((l) => l !== REMOTE_US_LABEL),
    },
    now,
  );
};

export const defaultJobSort = (view: JobViewName): JobSort =>
  view === "feed" ? "best" : view === "applied" ? "applied" : "newest";

export const listJobs = async (
  db: DbOrTx,
  registry: Registry,
  query: JobQuery,
  now: Date,
): Promise<JobList> => {
  const { settings: s, lastVisitAt } = await getSettingsState(db);
  const kindOf = kindLookup(registry);
  const view = query.view ?? "feed";
  const age = query.age ?? "all";
  const tiers = query.tier ?? (view === "feed" ? s.tiersToTrack : undefined);
  const applyV = view === "feed" || view === "hidden";

  const conds: SQL[] = [inArray(jobs.state, VIEW_STATES[view])];
  const cutoff = ageCutoff(age, now);
  if (cutoff) conds.push(gte(jobs.effectiveAt, cutoff));
  if (applyV) conds.push(isNull(jobs.closedAt));

  const entryLevel = (j: JobRecord) =>
    isEntryLevelTitle(j.title, s) || j.sources.some((src) => kindOf(src.source) === "aggregator");
  const isNew = (j: JobRecord) =>
    lastVisitAt !== null && j.firstSeenAt > lastVisitAt && isFreshMatch(j, s, kindOf, now);

  const all = await loadJobViews(db, and(...conds));
  const words = searchWords(query.q);
  const filtered = all.filter((j) => {
    if (applyV && !isVisible(j, s, kindOf)) return false;
    if (tiers && !tiers.includes(j.tier)) return false;
    if (query.location?.length) {
      const labels = matchedLocationLabels(j.locations, s);
      if (!query.location.some((l) => labels.includes(l))) return false;
    }
    if (query.company?.length) {
      const key = j.companyId ?? "unlisted";
      if (!query.company.includes(key)) return false;
    }
    if (query.source?.length && !j.sources.some((src) => query.source?.includes(src.source))) {
      return false;
    }
    if (query.level === "entry" && !entryLevel(j)) return false;
    if (!matchesSearch(j, words)) return false;
    return true;
  });

  let newSinceLastVisit = 0;
  if (lastVisitAt) {
    const candidates = await loadJobViews(
      db,
      and(
        inArray(jobs.state, ["new", "saved"]),
        eq(jobs.baseline, false),
        isNull(jobs.closedAt),
        gt(jobs.firstSeenAt, lastVisitAt),
        gte(jobs.effectiveAt, new Date(now.getTime() - s.maxJobAgeHours * HOUR)),
      ),
    );
    newSinceLastVisit = candidates.filter(isNew).length;
  }

  const sort = query.sort ?? defaultJobSort(view);
  const scored = collapseReposts(filtered).map((j) => ({
    ...j,
    score: scoreJob(j, s, kindOf, now),
  }));
  // Already newest first from the query
  if (sort === "best") scored.sort(byRank);
  // Stable, so equal (or missing) dates stay newest first
  else if (sort === "applied") {
    scored.sort((a, b) => (b.appliedAt?.getTime() ?? 0) - (a.appliedAt?.getTime() ?? 0));
  }

  return {
    total: scored.length,
    jobs: scored.slice(0, Math.min(query.limit ?? MAX_JOBS, MAX_JOBS_LIMIT)).map((j) => ({
      ...j,
      isNew: isNew(j),
      entryLevel: entryLevel(j),
      matchedLocations: j.locations.filter((l) => passesLocationRule([l], s)),
    })),
    lastVisitAt,
    newSinceLastVisit,
  };
};

export const markVisit = (db: DbOrTx, now: Date): Promise<void> =>
  setSettingsTimestamp(db, "lastVisitAt", now);

/**
 * Moves a job between new / saved / hidden / applied. Marking applied stamps
 * `applied_at` (kept if it already is applied); any other state clears it.
 */
export const setJobState = async (
  db: DbOrTx,
  id: string,
  state: JobState,
  now: Date,
): Promise<void> => {
  const appliedAt = state === "applied" ? sql`coalesce(${jobs.appliedAt}, ${now})` : null;
  const [row] = await db
    .update(jobs)
    .set({ state, appliedAt, updatedAt: now })
    .where(eq(jobs.id, id))
    .returning({ id: jobs.id });
  if (!row) throw new NotFoundError("Job not found");
};

export interface JobDetails {
  id: string;
  /** The source the description came from (null when none has one). */
  source: string | null;
  description: string | null;
  keyLines: KeyLine[];
}

/**
 * The description for the detail panel: the primary source's, else the
 * longest any source has (SimplifyJobs has none). Kept out of `listJobs`, so
 * the feed never loads description text.
 */
export const getJobDetails = async (db: DbOrTx, id: string): Promise<JobDetails> => {
  const [job] = await db
    .select({ primarySource: jobs.primarySource })
    .from(jobs)
    .where(eq(jobs.id, id));
  if (!job) throw new NotFoundError("Job not found");
  const rows = await db
    .select({ source: jobSources.source, description: jobSources.description })
    .from(jobSources)
    .where(eq(jobSources.jobId, id));
  const withText = rows.filter((r) => r.description);
  const pick =
    withText.find((r) => r.source === job.primarySource) ??
    withText.sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0];
  const description = pick?.description ?? null;
  return { id, source: pick?.source ?? null, description, keyLines: keyLines(description) };
};
