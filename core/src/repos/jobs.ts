import { and, desc, eq, gt, gte, inArray, isNull, type SQL } from "drizzle-orm";
import type { JobState, TierFilter } from "../constants";
import type { DbOrTx } from "../db/client";
import { applications, companies, type JobRow, jobSources, jobs } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { isVisible, matchedLocationLabels, type SourceKind } from "../matching";
import { startOfEasternDay } from "../schedule";
import type { Settings } from "../settings";
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
}

export interface JobSourceView {
  source: string;
  url: string;
  title: string;
  category: string | null;
  removedAt: Date | null;
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
  baseline: boolean;
  closedAt: Date | null;
  notifiedAt: Date | null;
  sources: JobSourceView[];
}

export type JobWithFlags = JobRecord & { isNew: boolean };

export interface JobList {
  jobs: JobWithFlags[];
  lastVisitAt: Date | null;
  newSinceLastVisit: number;
}

export const MAX_JOBS = 500;
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
    .orderBy(desc(jobs.effectiveAt));
  if (rows.length === 0) return [];
  const sourcesByJob = new Map<string, JobSourceView[]>();
  const ids = rows.map((r) => r.job.id);
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    const srcRows = await db.select().from(jobSources).where(inArray(jobSources.jobId, chunk));
    for (const s of srcRows) {
      const list = sourcesByJob.get(s.jobId) ?? [];
      list.push({
        source: s.source,
        url: s.url,
        title: s.title,
        category: s.category,
        removedAt: s.removedAt,
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

export const listJobs = async (
  db: DbOrTx,
  registry: Registry,
  query: JobQuery,
  now: Date,
): Promise<JobList> => {
  const { settings: s, lastVisitAt } = await getSettingsState(db);
  const kindOf = kindLookup(registry);
  const view = query.view ?? "feed";
  const age = query.age ?? (view === "feed" ? "3d" : "all");
  const tiers = query.tier ?? (view === "feed" ? s.tiersToTrack : undefined);
  const applyV = view === "feed" || view === "hidden";

  const conds: SQL[] = [inArray(jobs.state, VIEW_STATES[view])];
  const cutoff = ageCutoff(age, now);
  if (cutoff) conds.push(gte(jobs.effectiveAt, cutoff));
  if (applyV) conds.push(isNull(jobs.closedAt));

  const isNew = (j: JobRecord) =>
    lastVisitAt !== null && j.firstSeenAt > lastVisitAt && isFreshMatch(j, s, kindOf, now);

  const all = await loadJobViews(db, and(...conds));
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

  return {
    jobs: filtered.slice(0, MAX_JOBS).map((j) => ({ ...j, isNew: isNew(j) })),
    lastVisitAt,
    newSinceLastVisit,
  };
};

export const markVisit = (db: DbOrTx, now: Date): Promise<void> =>
  setSettingsTimestamp(db, "lastVisitAt", now);

export const setJobState = async (
  db: DbOrTx,
  id: string,
  state: "new" | "saved" | "hidden",
  now: Date,
): Promise<void> => {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select({ state: jobs.state })
      .from(jobs)
      .where(eq(jobs.id, id))
      .for("update");
    if (!job) throw new NotFoundError("Job not found");
    if (job.state === "applied")
      throw new ConflictError("Job is already applied; delete its application first");
    await tx.update(jobs).set({ state, updatedAt: now }).where(eq(jobs.id, id));
  });
};

/** Creates an application snapshot and marks the job applied, atomically. */
export const applyToJob = async (db: DbOrTx, id: string, now: Date) =>
  db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
    if (!job) throw new NotFoundError("Job not found");
    const [existing] = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.jobId, id));
    if (existing) throw new ConflictError("An application already exists for this job");
    const [app] = await tx
      .insert(applications)
      .values({
        jobId: id,
        companyName: job.companyName,
        title: job.title,
        url: job.url,
        status: "applied",
        appliedAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.update(jobs).set({ state: "applied", updatedAt: now }).where(eq(jobs.id, id));
    if (!app) throw new Error("insert returned no row");
    return app;
  });
