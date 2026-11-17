import { and, eq, inArray, or, sql } from "drizzle-orm";
import { FAILURES_BEFORE_REVIEW, FUZZY_TITLE_THRESHOLD, type JobState } from "../constants";
import type { Tx } from "../db/client";
import {
  type CompanyRow,
  companies,
  type JobRow,
  type JobSourceRow,
  jobSources,
  jobs,
  sourceState,
} from "../db/schema";
import { requiredYears } from "../experience";
import { adjustedPostedAt, initialEffectiveAt, mergedEffectiveAt } from "../freshness";
import { annualUsd, matchedLocationLabels, passesPollFilter } from "../matching";
import { normalizeCompanyName, titleJaccard } from "../normalize";
import type { Settings } from "../settings";
import { isAts, parseAtsUrl } from "../sources/registry";
import type { FetchResult, Registry, SourceAdapter } from "../sources/types";
import { type CompanyIndex, type PreparedListing, prepareListing, sameCompany } from "./resolve";
import { descriptionMd5, type MemJob, type MemSourceRow, type WorkingSet } from "./store";
import { updateSuggestions } from "./suggestions";

export type Target =
  | { kind: "company"; key: string; adapter: SourceAdapter; company: CompanyRow }
  | { kind: "aggregator"; key: string; adapter: SourceAdapter };

export interface TargetStats {
  inserted: number;
  merged: number;
  skippedOld: number;
  closed: number;
  reopened: number;
  baseline: boolean;
  abandoned: boolean;
}

export interface ProcessContext {
  tx: Tx;
  ws: WorkingSet;
  registry: Registry;
  settings: Settings;
  companies: CompanyIndex;
  target: Target;
  result: FetchResult;
  filtersHash: string;
  now: Date;
}

const emptyStats = (): TargetStats => ({
  inserted: 0,
  merged: 0,
  skippedOld: 0,
  closed: 0,
  reopened: 0,
  baseline: false,
  abandoned: false,
});

const hasAtsRow = (m: MemJob, registry: Registry) =>
  m.sources.some((s) => isAts(registry, s.source));

const jobCompany = (job: JobRow) => ({
  companyId: job.companyId,
  companyNorm: normalizeCompanyName(job.companyName),
});

const listingCompany = (p: PreparedListing) => ({
  companyId: p.company?.id ?? null,
  companyNorm: p.companyNorm,
});

/** ATS postings a job's source rows identify (by source or by URL). */
const atsPostingsOf = (m: MemJob, registry: Registry): Set<string> => {
  const out = new Set<string>();
  for (const s of m.sources) {
    if (isAts(registry, s.source)) out.add(`${s.source}:${s.sourceJobId}`);
    const parsed = parseAtsUrl(registry, s.url);
    if (parsed) out.add(`${parsed.adapter.id}:${parsed.sourceJobId}`);
  }
  return out;
};

const findExact = (p: PreparedListing, ctx: ProcessContext): MemJob | null => {
  const { ws, registry } = ctx;
  const ids = new Set<string>();
  for (const k of p.sourceKeys) {
    const id = ws.jobIdForSource(k.source, k.sourceJobId);
    if (id) ids.add(id);
  }
  if (p.urlKey) {
    for (const id of ws.jobIdsForUrlKey(p.urlKey)) {
      const m = ws.get(id);
      if (m && sameCompany(jobCompany(m.job), listingCompany(p))) ids.add(id);
    }
  }
  if (ws.get(p.canonicalId)) ids.add(p.canonicalId);
  const candidates = [...ids].map((id) => ws.get(id)).filter((m): m is MemJob => Boolean(m));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const canon = Number(b.job.id === p.canonicalId) - Number(a.job.id === p.canonicalId);
    if (canon) return canon;
    const ats = Number(hasAtsRow(b, registry)) - Number(hasAtsRow(a, registry));
    if (ats) return ats;
    return b.job.effectiveAt.getTime() - a.job.effectiveAt.getTime();
  });
  return candidates[0] ?? null;
};

const findFuzzy = (p: PreparedListing, ctx: ProcessContext): MemJob | null => {
  const { ws, registry, settings } = ctx;
  const incomingIsAts = p.adapter.kind === "ats";
  const aggregatorPrefixes = registry
    .filter((a) => a.kind === "aggregator")
    .map((a) => `${a.idPrefix}:`);
  const incomingIsAggregatorOnly =
    !incomingIsAts && aggregatorPrefixes.some((x) => p.canonicalId.startsWith(x));
  if (!incomingIsAts && !incomingIsAggregatorOnly) return null;
  if (p.labels.length === 0) return null;

  const incomingPostings = new Set<string>();
  if (p.atsRef) incomingPostings.add(`${p.atsRef.source}:${p.atsRef.sourceJobId}`);

  let best: { m: MemJob; score: number } | null = null;
  for (const m of ws.values()) {
    const jobHasAts = hasAtsRow(m, registry);
    if (incomingIsAts) {
      if (jobHasAts || !aggregatorPrefixes.some((x) => m.job.id.startsWith(x))) continue;
    } else if (!jobHasAts) {
      continue;
    }
    if (!sameCompany(jobCompany(m.job), listingCompany(p))) continue;
    const score = titleJaccard(p.listing.title, m.job.title);
    if (score < FUZZY_TITLE_THRESHOLD) continue;
    const jobLabels = matchedLocationLabels(m.job.locations, settings);
    if (!p.labels.some((l) => jobLabels.includes(l))) continue;
    // Never merge listings whose URLs identify different ATS postings
    const jobPostings = atsPostingsOf(m, registry);
    if (incomingPostings.size > 0 && jobPostings.size > 0) {
      const overlap = [...incomingPostings].some((x) => jobPostings.has(x));
      if (!overlap) continue;
    }
    if (
      !best ||
      score > best.score ||
      (score === best.score && m.job.effectiveAt > best.m.job.effectiveAt)
    ) {
      best = { m, score };
    }
  }
  return best?.m ?? null;
};

/** Looks for a matching job outside the in-memory window (no age limit). */
const existsInDb = async (p: PreparedListing, ctx: ProcessContext): Promise<boolean> => {
  const { tx } = ctx;
  const [byId] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, p.canonicalId));
  if (byId) return true;
  const keyConds = p.sourceKeys.map((k) =>
    and(eq(jobSources.source, k.source), eq(jobSources.sourceJobId, k.sourceJobId)),
  );
  const [byKey] = await tx
    .select({ id: jobSources.jobId })
    .from(jobSources)
    .where(or(...keyConds))
    .limit(1);
  if (byKey) return true;
  if (!p.urlKey) return false;
  const byUrl = await tx
    .select({ companyId: jobs.companyId, companyName: jobs.companyName })
    .from(jobSources)
    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
    .where(eq(jobSources.urlKey, p.urlKey));
  return byUrl.some((j) =>
    sameCompany(
      { companyId: j.companyId, companyNorm: normalizeCompanyName(j.companyName) },
      listingCompany(p),
    ),
  );
};

/** Long enough for any real posting; a runaway one can't bloat the table. */
const DESCRIPTION_MAX = 20_000;
const storedDescription = (p: PreparedListing): string | null => {
  const text = p.listing.description?.trim();
  return text ? text.slice(0, DESCRIPTION_MAX) : null;
};

/** What's stored for a source row already, so an unchanged description isn't re-read. */
interface KnownRow {
  requiredYears: number | null;
  descriptionMd5: string | null;
}

/**
 * The row to write (`db`; `description` null means "keep the stored one") and
 * its in-memory form. Experience is read from the description only when it's
 * new or changed: 0 when it names no requirement, null when there's none.
 */
const sourceRowFor = (
  p: PreparedListing,
  jobId: string,
  removedAt: Date | null,
  known?: KnownRow,
): { db: JobSourceRow; mem: MemSourceRow } => {
  const description = storedDescription(p);
  const md5 = descriptionMd5(description);
  let years: number | null;
  if (description === null) years = known?.requiredYears ?? null;
  else if (known && known.descriptionMd5 === md5 && known.requiredYears !== null) {
    years = known.requiredYears;
  } else years = requiredYears(p.listing.description ?? "") ?? 0;
  const base = {
    source: p.listing.source,
    sourceJobId: p.listing.sourceJobId,
    jobId,
    url: p.listing.url,
    urlKey: p.urlKey,
    title: p.listing.title,
    category: p.adapter.kind === "aggregator" ? (p.listing.meta?.category ?? null) : null,
    postedAt: p.listing.postedAt,
    postedAtPrecision: p.listing.postedAtPrecision,
    removedAt,
    requiredYears: years,
  };
  return {
    db: { ...base, description },
    mem: { ...base, descriptionMd5: md5 ?? known?.descriptionMd5 ?? null },
  };
};

const upsertSourceRow = (tx: Tx, row: JobSourceRow) =>
  tx
    .insert(jobSources)
    .values(row)
    .onConflictDoUpdate({
      target: [jobSources.source, jobSources.sourceJobId],
      set: {
        jobId: row.jobId,
        url: row.url,
        urlKey: row.urlKey,
        title: row.title,
        category: row.category,
        postedAt: row.postedAt,
        postedAtPrecision: row.postedAtPrecision,
        requiredYears: row.requiredYears,
        // A listing without one (detail not refetched) keeps the stored description
        description: sql`COALESCE(excluded.description, ${jobSources.description})`,
      },
    });

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  return a === b;
};

/** The fields of `next` that differ from `current`. */
const changes = <T extends object>(current: T, next: Partial<T>): Partial<T> => {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (!sameValue(current[key], next[key])) out[key] = next[key];
  }
  return out;
};

/** Marks a moved posting carries, each with the target states it may raise. */
const RAISES: Record<string, JobState[]> = {
  applied: ["new", "hidden", "saved"],
  saved: ["new", "hidden"],
  hidden: ["new"],
};

/**
 * A marked job whose only posting moved to another job would stay forever
 * with no sources (never closed), or, if deleted, lose the mark (a hidden job
 * would reappear). Its mark moves with the posting (applied beats saved beats
 * hidden beats new; never downgraded) and the empty row goes. Guarded in SQL
 * like the delete above.
 */
const carryMark = async (tx: Tx, ws: WorkingSet, fromId: string, toId: string, now: Date) => {
  const removed = await tx.execute<{ state: JobState }>(sql`
    DELETE FROM jobs
    WHERE id = ${fromId} AND state IN ('saved', 'applied', 'hidden')
      AND NOT EXISTS (SELECT 1 FROM job_sources WHERE job_id = ${fromId})
    RETURNING state`);
  const state = removed.rows[0]?.state;
  if (!state) return;
  ws.remove(fromId);
  const lower = RAISES[state] ?? [];
  const raised = await tx
    .update(jobs)
    .set({ state, updatedAt: now })
    .where(and(eq(jobs.id, toId), inArray(jobs.state, lower)))
    .returning({ state: jobs.state });
  if (raised.length > 0) ws.touch(toId).job.state = state;
};

const merge = async (p: PreparedListing, match: MemJob, ctx: ProcessContext) => {
  const { tx, ws, now } = ctx;
  const jobId = match.job.id;
  const { source, sourceJobId } = p.listing;

  // Where the row lives now: in the window (indexed) or, rarely, on an older job
  let removedAt: Date | null = null;
  let known: KnownRow | undefined;
  let outsideJobId: string | undefined;
  let stored: MemSourceRow | undefined;
  const inWindowId = ws.jobIdForSource(source, sourceJobId);
  if (inWindowId) {
    stored = ws
      .get(inWindowId)
      ?.sources.find((s) => s.source === source && s.sourceJobId === sourceJobId);
    removedAt = stored?.removedAt ?? null;
    known = stored;
  } else {
    const [existing] = await tx
      .select({
        jobId: jobSources.jobId,
        removedAt: jobSources.removedAt,
        requiredYears: jobSources.requiredYears,
        descriptionMd5: sql<string | null>`md5(${jobSources.description})`,
      })
      .from(jobSources)
      .where(and(eq(jobSources.source, source), eq(jobSources.sourceJobId, sourceJobId)));
    if (existing) {
      removedAt = existing.removedAt;
      known = existing;
      if (existing.jobId !== jobId) outsideJobId = existing.jobId;
    }
  }

  const row = sourceRowFor(p, jobId, removedAt, known);
  // Most polls change nothing: skip the write (no table bloat, no row locks against Save/Hide)
  if (!stored || Object.keys(changes(stored, row.mem)).length > 0) {
    await upsertSourceRow(tx, row.db);
  }
  const movedFrom = ws.upsertRow(jobId, row.mem) ?? outsideJobId;
  if (movedFrom) {
    // Guarded in SQL: never based on the in-memory state (the user may have just saved it)
    const deleted = await tx.execute(sql`
      DELETE FROM jobs
      WHERE id = ${movedFrom} AND state = 'new'
        AND NOT EXISTS (SELECT 1 FROM job_sources WHERE job_id = ${movedFrom})
      RETURNING id`);
    if (deleted.rows.length > 0) ws.remove(movedFrom);
    else await carryMark(tx, ws, movedFrom, jobId, now);
  }

  const m = ws.touch(jobId);
  const posted = adjustedPostedAt(p.listing.postedAt, p.listing.postedAtPrecision);
  const update: Partial<JobRow> = { effectiveAt: mergedEffectiveAt(m.job.effectiveAt, posted) };
  if (p.adapter.kind === "ats") {
    const salary = annualUsd(p.listing.salary);
    Object.assign(update, {
      title: p.listing.title,
      locations: [...p.listing.locations],
      url: p.listing.url,
      salaryMinUsd: salary.min,
      salaryMaxUsd: salary.max,
      companyId: p.company?.id ?? null,
      companyName: p.company?.name ?? p.listing.companyName,
      primarySource: p.listing.source,
    });
  } else if (!m.job.companyId && p.company) {
    update.companyId = p.company.id;
  }
  const changed = changes(m.job, update);
  if (Object.keys(changed).length === 0) return;
  changed.updatedAt = now;
  Object.assign(m.job, changed);
  await tx.update(jobs).set(changed).where(eq(jobs.id, jobId));
};

const insert = async (p: PreparedListing, ctx: ProcessContext, baseline: boolean) => {
  const { tx, ws, now } = ctx;
  const posted = adjustedPostedAt(p.listing.postedAt, p.listing.postedAtPrecision);
  const salary = annualUsd(p.listing.salary);
  const job: JobRow = {
    id: p.canonicalId,
    companyId: p.company?.id ?? null,
    companyName: p.company?.name ?? p.listing.companyName,
    title: p.listing.title,
    locations: [...p.listing.locations],
    url: p.listing.url,
    primarySource: p.listing.source,
    firstSeenAt: now,
    effectiveAt: initialEffectiveAt(now, posted),
    salaryMinUsd: salary.min,
    salaryMaxUsd: salary.max,
    state: "new",
    baseline,
    notifiedAt: null,
    closedAt: null,
    updatedAt: now,
  };
  const row = sourceRowFor(p, job.id, null);
  await tx.insert(jobs).values(job);
  await tx.insert(jobSources).values(row.db);
  ws.add(job, row.mem);
};

/** Step 8: per-source open/closed status for the target's rows. */
const applyClosures = async (
  ctx: ProcessContext,
  liveKeys: Set<string>,
): Promise<[number, number]> => {
  const { tx, ws, target, now } = ctx;
  const source = target.adapter.id;
  const toRemove: string[] = [];
  const toRevive: string[] = [];
  const affected: string[] = [];
  for (const m of [...ws.values()]) {
    if (target.kind === "company" && m.job.companyId !== target.company.id) continue;
    const rows = m.sources.filter((s) => s.source === source);
    if (rows.length === 0) continue;
    affected.push(m.job.id);
    for (const r of rows) {
      const live = liveKeys.has(r.sourceJobId);
      if (!live && !r.removedAt) toRemove.push(r.sourceJobId);
      if (live && r.removedAt) toRevive.push(r.sourceJobId);
    }
  }
  if (toRemove.length > 0) {
    await tx
      .update(jobSources)
      .set({ removedAt: now })
      .where(and(eq(jobSources.source, source), inArray(jobSources.sourceJobId, toRemove)));
  }
  if (toRevive.length > 0) {
    await tx
      .update(jobSources)
      .set({ removedAt: null })
      .where(and(eq(jobSources.source, source), inArray(jobSources.sourceJobId, toRevive)));
  }
  const removeSet = new Set(toRemove);
  const reviveSet = new Set(toRevive);
  const close: string[] = [];
  const reopen: string[] = [];
  for (const id of affected) {
    const m = ws.touch(id);
    for (const r of m.sources) {
      if (r.source !== source) continue;
      if (removeSet.has(r.sourceJobId)) r.removedAt = now;
      if (reviveSet.has(r.sourceJobId)) r.removedAt = null;
    }
    const anyLive = m.sources.some((r) => !r.removedAt);
    if (!anyLive && !m.job.closedAt) {
      m.job.closedAt = now;
      close.push(id);
    } else if (anyLive && m.job.closedAt) {
      m.job.closedAt = null;
      reopen.push(id);
    }
  }
  if (close.length > 0) await tx.update(jobs).set({ closedAt: now }).where(inArray(jobs.id, close));
  if (reopen.length > 0)
    await tx.update(jobs).set({ closedAt: null }).where(inArray(jobs.id, reopen));
  return [close.length, reopen.length];
};

const stateSlug = (target: Target) => (target.kind === "company" ? target.company.slug : null);

/**
 * Steps 5 to 10 for one target, inside its transaction. Throws to roll back.
 */
export const processTarget = async (ctx: ProcessContext): Promise<TargetStats> => {
  const { tx, target, result, now, registry, settings } = ctx;
  const stats = emptyStats();

  let company: CompanyRow | null = null;
  if (target.kind === "company") {
    [company = null] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, target.company.id))
      .for("update");
    if (!company || company.ats !== target.company.ats || company.slug !== target.company.slug) {
      stats.abandoned = true;
      return stats;
    }
  }

  const [state] = await tx
    .select()
    .from(sourceState)
    .where(eq(sourceState.key, target.key))
    .for("update");
  const slug = stateSlug(target);
  const baselineActive = !state || state.baselinedAt === null || state.slug !== slug;

  if (result.status === "ok") {
    const prepared = result.jobs.map((l) =>
      prepareListing(l, registry, ctx.companies, settings, company),
    );
    const passing = prepared.filter((p) =>
      passesPollFilter(p.listing, p.adapter.kind, settings, now),
    );

    for (const p of passing) {
      const exact = findExact(p, ctx);
      const match = exact ?? findFuzzy(p, ctx);
      if (match) {
        await merge(p, match, ctx);
        stats.merged++;
      } else if (await existsInDb(p, ctx)) {
        stats.skippedOld++;
      } else {
        await insert(p, ctx, baselineActive);
        stats.inserted++;
      }
    }
    stats.baseline = baselineActive;

    const liveKeys = new Set(
      result.jobs
        .filter(
          (l) => target.kind === "company" || (l.meta?.active === true && l.meta?.visible === true),
        )
        .map((l) => l.sourceJobId),
    );
    [stats.closed, stats.reopened] = await applyClosures(ctx, liveKeys);

    if (target.kind === "aggregator" && settings.suggestCompanies) {
      await updateSuggestions(
        tx,
        passing.filter((p) => !p.company),
        registry,
        now,
      );
    }
  }

  // Steps 7 and 10: source state (baseline + health) in the same transaction
  const values = {
    key: target.key,
    source: target.adapter.id,
    companyId: company?.id ?? null,
    slug,
    lastAttemptAt: now,
    lastSuccessAt: now,
    consecutiveFailures: 0,
    lastError: null,
    baselinedAt: baselineActive
      ? result.status === "ok"
        ? now
        : null
      : (state?.baselinedAt ?? now),
    ...(result.status === "ok"
      ? { etag: result.etag, filtersHash: ctx.filtersHash }
      : { etag: state?.etag ?? null, filtersHash: state?.filtersHash ?? null }),
  };
  await tx
    .insert(sourceState)
    .values(values)
    .onConflictDoUpdate({ target: sourceState.key, set: values });
  if (company?.status === "needs_review") {
    await tx
      .update(companies)
      .set({ status: "ok", updatedAt: now })
      .where(eq(companies.id, company.id));
  }
  return stats;
};

/**
 * Failure health, written after the rollback in its own transaction. Skipped
 * when the company was deleted or its ats/slug changed since the run loaded it.
 */
export const recordFailure = async (
  tx: Tx,
  target: Target,
  error: string,
  now: Date,
): Promise<{ failures: number; needsReview: boolean } | null> => {
  let companyId: string | null = null;
  if (target.kind === "company") {
    const [c] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, target.company.id))
      .for("update");
    if (!c || c.ats !== target.company.ats || c.slug !== target.company.slug) return null;
    companyId = c.id;
  }
  const [row] = await tx
    .insert(sourceState)
    .values({
      key: target.key,
      source: target.adapter.id,
      companyId,
      slug: stateSlug(target),
      lastAttemptAt: now,
      consecutiveFailures: 1,
      lastError: error.slice(0, 1000),
    })
    .onConflictDoUpdate({
      target: sourceState.key,
      set: {
        lastAttemptAt: now,
        consecutiveFailures: sql`${sourceState.consecutiveFailures} + 1`,
        lastError: error.slice(0, 1000),
      },
    })
    .returning({ failures: sourceState.consecutiveFailures });
  const failures = row?.failures ?? 1;
  let needsReview = false;
  if (companyId && failures >= FAILURES_BEFORE_REVIEW) {
    // Only reported once: the update matches while the company is still "ok"
    const moved = await tx
      .update(companies)
      .set({ status: "needs_review", updatedAt: now })
      .where(and(eq(companies.id, companyId), eq(companies.status, "ok")))
      .returning({ id: companies.id });
    needsReview = moved.length > 0;
  }
  return { failures, needsReview };
};
