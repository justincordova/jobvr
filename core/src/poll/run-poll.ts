import { createHash } from "node:crypto";
import { getTableColumns, gte, inArray, sql } from "drizzle-orm";
import {
  FILTER_VERSION,
  POLL_BUDGET_MS,
  POLL_LOCK_KEY,
  SOURCE_OUTAGE_MIN_TARGETS,
  type TierFilter,
} from "../constants";
import type { Database } from "../db/client";
import { type CompanyRow, companies, jobSources, jobs, sourceState } from "../db/schema";
import type { HttpClient } from "../http";
import { withAdvisoryLock } from "../lock";
import { errorFields, formatDuration, type Logger, silentLogger } from "../logger";
import { passesPollFilter } from "../matching";
import { companyStateKey } from "../repos/companies";
import { getSettingsState, recordSourceOutages, setSettingsTimestamp } from "../repos/settings";
import { isDue } from "../schedule";
import { maxStoreWindowMs, type Settings } from "../settings";
import { getAdapter } from "../sources/registry";
import type { FetchResult, Registry } from "../sources/types";
import { processTarget, recordFailure, type Target, type TargetStats } from "./process";
import { indexCompanies } from "./resolve";
import { type JobMap, type MemJob, WorkingSet } from "./store";

export interface RunPollOptions {
  database: Database;
  registry: Registry;
  http: HttpClient;
  /** Skip the due check (manual `pnpm poll`). */
  force?: boolean;
  now?: () => Date;
  logger?: Logger;
  budgetMs?: number;
  /** Aborting (shutdown) stops fetching; nothing fetched is written and the next poll redoes it. */
  signal?: AbortSignal;
  /** The order each source's boards are fetched in: shuffled each poll by default (tests fix it). */
  order?: <T>(list: readonly T[]) => T[];
}

export type TargetOutcome = { key: string; label: string } & (
  | {
      status: "ok" | "not_modified";
      stats: TargetStats;
      durationMs: number;
      /** Listings in the response (null when not modified). */
      listings: number | null;
      /** Job detail requests made (Greenhouse). */
      details: number;
    }
  | { status: "failed"; error: string; failures: number | null }
  | { status: "skipped" }
);

/** Counters worth a field: zeros and false flags only repeat what the message says. */
const nonZero = (counts: Record<string, number | boolean>) =>
  Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== 0 && v !== false));

/**
 * Expected to pass on its own: network errors, timeouts, 5xx, 429. Not 404s,
 * and not a board answering with something unreadable (HTML, a changed schema).
 */
const transient = (f: Fetched): f is Extract<Fetched, { error: string }> => {
  if (!("error" in f)) return false;
  // Not requested after the breaker tripped: counts with the failures that tripped it
  if (f.notFetched) return true;
  const status = f.fields.status;
  if (typeof status === "number") return status >= 500 || status === 429;
  return /^(Network error|Timed out)/.test(f.error);
};

/** Fisher-Yates: a different order each poll, so the same boards don't always go first. */
const shuffled = <T>(list: readonly T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

/**
 * ATS sources that look down this poll: no board answered and at least
 * SOURCE_OUTAGE_MIN_TARGETS failed transiently (or weren't tried after the
 * circuit breaker tripped). A 404 doesn't rule an outage out; it still counts
 * against its own board. Returns the transient count and a sample error.
 */
const sourcesDown = (
  targets: readonly Target[],
  fetched: ReadonlyMap<string, Fetched>,
): Map<string, { count: number; error: string }> => {
  const bySource = new Map<string, Fetched[]>();
  for (const t of targets) {
    if (t.kind !== "company") continue;
    const f = fetched.get(t.key);
    if (!f) continue;
    bySource.set(t.adapter.id, [...(bySource.get(t.adapter.id) ?? []), f]);
  }
  const down = new Map<string, { count: number; error: string }>();
  for (const [source, list] of bySource) {
    if (list.some((f) => "result" in f)) continue;
    const failed = list.filter(transient);
    if (failed.length < SOURCE_OUTAGE_MIN_TARGETS) continue;
    const first = failed[0];
    down.set(source, { count: failed.length, error: first && "error" in first ? first.error : "" });
  }
  return down;
};

const changed = (s: TargetStats) => s.inserted + s.closed + s.reopened > 0;

/** One line per target: info when something changed, debug otherwise. */
const logTarget = (log: Logger, o: TargetOutcome) => {
  if (o.status !== "ok" && o.status !== "not_modified") return;
  const { stats } = o;
  const fields = {
    target: o.key,
    durationMs: Math.round(o.durationMs),
    ...(o.listings !== null && { listings: o.listings }),
    ...nonZero({ ...stats, details: o.details }),
  };
  if (stats.abandoned) {
    log.info(fields, `${o.label} · skipped: its ATS or slug changed during the poll`);
    return;
  }
  if (o.status === "not_modified") {
    log.debug(fields, `${o.label} · not modified · ${formatDuration(o.durationMs)}`);
    return;
  }
  const parts = [
    `${o.listings} listings`,
    stats.inserted > 0 &&
      `+${stats.inserted} new${stats.baseline ? " (baseline, not pushed)" : ""}`,
    stats.merged > 0 && `${stats.merged} refreshed`,
    stats.closed > 0 && `${stats.closed} closed`,
    stats.reopened > 0 && `${stats.reopened} reopened`,
    stats.skippedOld > 0 && `${stats.skippedOld} already seen`,
    stats.invalid > 0 && `${stats.invalid} invalid${stats.closuresHeld ? " (closures held)" : ""}`,
    o.details > 0 && `${o.details} details`,
    formatDuration(o.durationMs),
  ].filter(Boolean);
  log[changed(stats) || stats.closuresHeld ? "info" : "debug"](
    fields,
    `${o.label} · ${parts.join(" · ")}`,
  );
};

export interface PollTotals {
  targets: number;
  unchanged: number;
  updated: number;
  failed: number;
  skipped: number;
  inserted: number;
  merged: number;
  closed: number;
  reopened: number;
  details: number;
}

const summarize = (outcomes: readonly TargetOutcome[]): PollTotals => {
  const t: PollTotals = {
    targets: outcomes.length,
    unchanged: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    inserted: 0,
    merged: 0,
    closed: 0,
    reopened: 0,
    details: 0,
  };
  for (const o of outcomes) {
    if (o.status === "failed") t.failed++;
    else if (o.status === "skipped") t.skipped++;
    else {
      if (changed(o.stats)) t.updated++;
      else t.unchanged++;
      t.inserted += o.stats.inserted;
      t.merged += o.stats.merged;
      t.closed += o.stats.closed;
      t.reopened += o.stats.reopened;
      t.details += o.details;
    }
  }
  return t;
};

const describeSummary = (t: PollTotals) => {
  const status = [
    `${t.unchanged} unchanged`,
    t.updated > 0 && `${t.updated} updated`,
    t.failed > 0 && `${t.failed} failed`,
    t.skipped > 0 && `${t.skipped} skipped`,
  ].filter(Boolean);
  const jobs = [
    `+${t.inserted} new`,
    `${t.merged} refreshed`,
    `${t.closed} closed`,
    t.reopened > 0 && `${t.reopened} reopened`,
    t.details > 0 && `${t.details} details`,
  ].filter(Boolean);
  return `${t.targets} targets: ${status.join(", ")} · ${jobs.join(", ")}`;
};

const targetLabel = (t: Target) =>
  t.kind === "company" ? `${t.company.name} (${t.adapter.label})` : t.adapter.label;

export type PollSummary =
  | { ran: false; reason: "locked" | "not_due" | "aborted" }
  | { ran: true; startedAt: Date; targets: TargetOutcome[] };

/** Hash of everything that decides what a fetch stores; a change bypasses ETags. */
export const filtersHash = (s: Settings): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        v: FILTER_VERSION,
        locations: s.locations,
        role: s.roleKeywords,
        level: s.levelKeywords,
        exclude: s.excludeKeywords,
        categories: s.simplifyCategories,
        applyLevel: s.applyLevelToSimplify,
        requireLevel: s.requireLevelOnBoards,
        window: s.storeWindowDays,
      }),
    )
    .digest("hex");

export const pollTargets = (
  registry: Registry,
  settings: Settings,
  rows: readonly CompanyRow[],
): Target[] => {
  const disabled = new Set(settings.disabledSources);
  const tiers = new Set<TierFilter>(settings.tiersToTrack);
  const targets: Target[] = [];
  for (const company of rows) {
    const adapter = getAdapter(registry, company.ats);
    if (adapter?.kind !== "ats") continue;
    if (!company.track || !company.slug || company.status === "manual_only") continue;
    if (!tiers.has(company.tier as TierFilter) || disabled.has(adapter.id)) continue;
    targets.push({ kind: "company", key: companyStateKey(company.id), adapter, company });
  }
  for (const adapter of registry) {
    if (adapter.kind === "aggregator" && !disabled.has(adapter.id)) {
      targets.push({ kind: "aggregator", key: adapter.id, adapter });
    }
  }
  return targets;
};

type Fetched =
  | { result: FetchResult; ms: number; details: number }
  | {
      error: string;
      fields: Record<string, unknown>;
      ms: number;
      /** Never requested: the circuit breaker had tripped for its source. */
      notFetched?: true;
    }
  | { skipped: true };

/**
 * Adds detail (description, pay) to an ok result's listings. `fetched`: how
 * many detail requests it made; `incomplete`: some matching listing is still
 * unchecked (a request failed or the budget ran out).
 */
type Enrich = (
  target: Target,
  result: FetchResult,
  signal: AbortSignal,
) => Promise<{ fetched: number; incomplete: boolean }>;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Parallel fetch with per-source concurrency and one overall time budget. */
const fetchAll = async (
  targets: readonly Target[],
  etagFor: (t: Target) => string | null,
  http: HttpClient,
  budgetMs: number,
  enrich: Enrich,
  stop?: AbortSignal,
  order: <T>(list: readonly T[]) => T[] = shuffled,
): Promise<Map<string, Fetched>> => {
  const out = new Map<string, Fetched>();
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(new Error("Poll fetch budget exceeded")), budgetMs);
  const onStop = () => budget.abort(new Error("Shutting down"));
  // A stop that came before this point fires no event
  if (stop?.aborted) onStop();
  else stop?.addEventListener("abort", onStop, { once: true });
  const bySource = new Map<string, Target[]>();
  for (const t of targets) {
    const list = bySource.get(t.adapter.id) ?? [];
    list.push(t);
    bySource.set(t.adapter.id, list);
  }
  const workers: Promise<void>[] = [];
  for (const all of bySource.values()) {
    // A few broken boards at the front would trip the circuit breaker every poll
    const queue = order(all);
    const concurrency = Math.max(1, queue[0]?.adapter.concurrency ?? 1);
    // Circuit breaker: the source's first boards all failing transiently means it's down
    let failedInARow = 0;
    let anyOk = false;
    for (let i = 0; i < concurrency; i++) {
      workers.push(
        (async () => {
          for (let t = queue.shift(); t; t = queue.shift()) {
            if (budget.signal.aborted) {
              out.set(t.key, { skipped: true });
              continue;
            }
            if (!anyOk && failedInARow >= SOURCE_OUTAGE_MIN_TARGETS) {
              out.set(t.key, {
                error: `not fetched: ${t.adapter.label}'s first ${failedInARow} boards all failed`,
                fields: {},
                ms: 0,
                notFetched: true,
              });
              continue;
            }
            const started = performance.now();
            try {
              const result = await t.adapter.fetch({
                slug: t.kind === "company" ? (t.company.slug ?? undefined) : undefined,
                companyName: t.kind === "company" ? t.company.name : undefined,
                etag: etagFor(t),
                signal: budget.signal,
                http,
              });
              const { fetched, incomplete } = await enrich(t, result, budget.signal);
              // Without the ETag the next poll gets the full list (not a 304): it retries the
              // detail, or runs the closures held back for listings that failed validation
              const kept =
                result.status === "ok" &&
                (incomplete ||
                  (t.kind === "company" && result.invalidCount > (result.invalidIds?.length ?? 0)))
                  ? { ...result, etag: null }
                  : result;
              out.set(t.key, { result: kept, ms: performance.now() - started, details: fetched });
              anyOk = true;
            } catch (err) {
              // Cut off by the budget or shutdown, like the boards not started: no health change
              if (budget.signal.aborted) {
                out.set(t.key, { skipped: true });
                continue;
              }
              const failed: Fetched = {
                error: errorMessage(err),
                fields: errorFields(err),
                ms: performance.now() - started,
              };
              out.set(t.key, failed);
              if (t.kind === "company" && transient(failed)) failedInARow++;
              else failedInARow = 0;
            }
          }
        })(),
      );
    }
  }
  await Promise.all(workers);
  clearTimeout(timer);
  stop?.removeEventListener("abort", onStop);
  return out;
};

const loadWindow = async (database: Database, now: Date, settings: Settings): Promise<JobMap> => {
  const { db } = database;
  const since = new Date(now.getTime() - maxStoreWindowMs(settings));
  const jobRows = await db.select().from(jobs).where(gte(jobs.effectiveAt, since));
  const map: JobMap = new Map(jobRows.map((j) => [j.id, { job: j, sources: [] }]));
  const ids = [...map.keys()];
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    const { description, ...columns } = getTableColumns(jobSources);
    const rows = await db
      .select({ ...columns, descriptionMd5: sql<string | null>`md5(${description})` })
      .from(jobSources)
      .where(inArray(jobSources.jobId, chunk));
    for (const r of rows) map.get(r.jobId)?.sources.push(r);
  }
  return map;
};

export const runPoll = async (options: RunPollOptions): Promise<PollSummary> => {
  const { database, registry, http } = options;
  const clock = options.now ?? (() => new Date());
  const log = (options.logger ?? silentLogger).child({ module: "poll" });

  const locked = await withAdvisoryLock(
    database.pool,
    POLL_LOCK_KEY,
    async () => {
      const { db } = database;
      const startedAt = clock();
      const state = await getSettingsState(db);
      const settings = state.settings;
      if (
        !options.force &&
        !isDue(state.lastPollAt, settings.pollEveryMinutes * 60_000, startedAt)
      ) {
        log.debug({ lastPollAt: state.lastPollAt }, "poll not due yet");
        return { ran: false, reason: "not_due" } as const;
      }
      const runStarted = performance.now();
      await setSettingsTimestamp(db, "lastPollAt", startedAt);

      const companyRows = await db.select().from(companies);
      const companyIndex = indexCompanies(companyRows);
      const states = new Map((await db.select().from(sourceState)).map((s) => [s.key, s]));
      let window = await loadWindow(database, startedAt, settings);

      const targets = pollTargets(registry, settings, companyRows);
      const hash = filtersHash(settings);
      const etagFor = (t: Target) => {
        const s = states.get(t.key);
        if (!s) return null;
        const slug = t.kind === "company" ? t.company.slug : null;
        return s.slug === slug && s.filtersHash === hash ? s.etag : null;
      };

      // Source rows already checked for experience, so their detail isn't refetched
      const checked = new Map<string, MemJob>();
      for (const m of window.values()) {
        for (const s of m.sources) {
          // Description too: rows from before descriptions were stored get one detail request
          if (s.requiredYears !== null && s.descriptionMd5 !== null) {
            checked.set(`${s.source}:${s.sourceJobId}`, m);
          }
        }
      }
      const enrich: Enrich = async (t, result, signal) => {
        const { adapter } = t;
        const slug = t.kind === "company" ? t.company.slug : null;
        if (result.status !== "ok" || !adapter.fetchDetail || !slug) {
          return { fetched: 0, incomplete: false };
        }
        let fetchedCount = 0;
        let incomplete = false;
        for (const listing of result.jobs) {
          if (listing.description !== undefined) continue;
          if (!passesPollFilter(listing, adapter.kind, settings, startedAt)) continue;
          const known = checked.get(`${listing.source}:${listing.sourceJobId}`);
          if (known) {
            // Keep the pay found by the earlier detail request (the list has none)
            const { salaryMinUsd: min, salaryMaxUsd: max } = known.job;
            if (!listing.salary && (min !== null || max !== null)) {
              listing.salary = {
                currency: "USD",
                interval: "year",
                ...(min !== null && { min }),
                ...(max !== null && { max }),
              };
            }
            continue;
          }
          if (signal.aborted) {
            incomplete = true;
            break;
          }
          try {
            const detail = await adapter.fetchDetail(slug, listing.sourceJobId, { http, signal });
            fetchedCount++;
            if (!detail) continue;
            listing.description = detail.description;
            if (detail.salary && !listing.salary) listing.salary = detail.salary;
          } catch (err) {
            // Left unchecked: retried on the next poll
            incomplete = true;
            log.warn(
              { job: listing.sourceJobId, ...errorFields(err) },
              `${targetLabel(t)} · detail for "${listing.title}" failed; retrying next poll`,
            );
          }
        }
        return { fetched: fetchedCount, incomplete };
      };

      log.debug(
        { targets: targets.length, jobsInWindow: window.size, forced: options.force ?? false },
        `poll started · ${targets.length} targets`,
      );
      const fetched = await fetchAll(
        targets,
        etagFor,
        http,
        options.budgetMs ?? POLL_BUDGET_MS,
        enrich,
        options.signal,
        options.order,
      );
      if (options.signal?.aborted) {
        // Half a poll would mark unfetched boards failed; the next start polls again
        await setSettingsTimestamp(db, "lastPollAt", state.lastPollAt);
        log.info(
          {},
          "poll stopped for shutdown before writing anything; the next start polls again",
        );
        return { ran: false, reason: "aborted" } as const;
      }

      // ATS targets first so their data is in place before aggregators merge into it
      const ordered = [
        ...targets.filter((t) => t.kind === "company"),
        ...targets.filter((t) => t.kind === "aggregator"),
      ];
      const down = sourcesDown(targets, fetched);
      const answered = new Set(
        targets
          .filter((t) => t.kind === "company" && "result" in (fetched.get(t.key) ?? {}))
          .map((t) => t.adapter.id),
      );
      const polled = new Set(targets.filter((t) => t.kind === "company").map((t) => t.adapter.id));
      await recordSourceOutages(db, down, answered, polled, startedAt);
      for (const [source, { count, error }] of down) {
        log.warn(
          { source, boards: count, error },
          `${getAdapter(registry, source)?.label ?? source} looks down: no board answered, ${count} failed (${error}); their health is left alone and the next poll retries`,
        );
      }
      const boards = new Set(
        targets.flatMap((t) => (t.kind === "company" ? [`${t.company.id}|${t.adapter.id}`] : [])),
      );
      const outcomes: TargetOutcome[] = [];
      for (const target of ordered) {
        const label = targetLabel(target);
        const f0 = fetched.get(target.key);
        if (target.kind === "company" && down.has(target.adapter.id) && f0 && transient(f0)) {
          log.debug({ target: target.key }, `${label} failed (source down): ${f0.error}`);
          outcomes.push({
            key: target.key,
            label,
            status: "failed",
            error: f0.error,
            failures: null,
          });
          continue;
        }
        const f = fetched.get(target.key) ?? { skipped: true as const };
        if ("notFetched" in f) {
          // The breaker tripped but a board in flight then answered, so it's no outage;
          // these boards were never asked and their health says nothing about them
          log.warn(
            { target: target.key },
            `${label} · ${f.error}, but another board then answered; its health is left alone and the next poll retries`,
          );
          outcomes.push({ key: target.key, label, status: "skipped" });
          continue;
        }
        if ("skipped" in f) {
          log.warn(
            { target: target.key },
            `${label} · not fetched: the ${formatDuration(options.budgetMs ?? POLL_BUDGET_MS)} poll budget ran out; next poll retries`,
          );
          outcomes.push({ key: target.key, label, status: "skipped" });
          continue;
        }
        const now = clock();
        let error = "error" in f ? f.error : null;
        let fields = "error" in f ? f.fields : {};
        if ("result" in f) {
          const ws = new WorkingSet(window);
          try {
            const stats = await db.transaction((tx) =>
              processTarget({
                tx,
                ws,
                registry,
                settings,
                companies: companyIndex,
                target,
                result: f.result,
                filtersHash: hash,
                now,
                boards,
              }),
            );
            window = ws.commit();
            const outcome: TargetOutcome = {
              key: target.key,
              label,
              status: f.result.status,
              stats,
              durationMs: f.ms,
              listings: f.result.status === "ok" ? f.result.jobs.length : null,
              details: f.details,
            };
            logTarget(log, outcome);
            outcomes.push(outcome);
            continue;
          } catch (err) {
            error = errorMessage(err);
            fields = { err };
            log.error(
              { target: target.key, err },
              `${label} · saving results failed; rolled back, next poll refetches in full`,
            );
          }
        }
        const message = error ?? "unknown error";
        const health = await db
          .transaction((tx) => recordFailure(tx, target, message, now))
          .catch((err) => {
            log.error({ target: target.key, err }, `${label} · could not record the failure`);
            return null;
          });
        const company =
          target.kind === "company"
            ? { company: target.company.name, ats: target.company.ats, slug: target.company.slug }
            : { source: target.adapter.id };
        const inARow = health ? ` (${health.failures} in a row)` : "";
        // The error itself was logged above when processing failed
        log.warn(
          // The message already carries the error text; keep the extra details (status)
          {
            target: target.key,
            ...company,
            ...("err" in fields ? {} : { ...fields, error: undefined }),
          },
          `${label} failed${inARow}: ${message}`,
        );
        if (health?.needsReview) {
          log.warn(
            { target: target.key, ...company },
            `${label} · marked needs review after ${health.failures} failures in a row; check its slug on the Companies page`,
          );
        }
        outcomes.push({
          key: target.key,
          label,
          status: "failed",
          error: message,
          failures: health?.failures ?? null,
        });
      }

      // Boards failing is their own health; the poll itself got through
      await setSettingsTimestamp(db, "lastPollOkAt", clock());
      const summary = summarize(outcomes);
      const ms = performance.now() - runStarted;
      log[summary.failed > 0 ? "warn" : "info"](
        { durationMs: Math.round(ms), targets: summary.targets, ...nonZero({ ...summary }) },
        `poll finished in ${formatDuration(ms)} · ${describeSummary(summary)}`,
      );
      return { ran: true, startedAt, targets: outcomes } as const;
    },
    (err) =>
      log.error(
        { err },
        "lost the poll lock's database connection (Postgres restarted?); this poll's writes will fail and the next poll retries",
      ),
  );

  if (!locked.acquired) log.info({}, "poll skipped: another poll holds the lock");
  return locked.acquired ? locked.value : { ran: false, reason: "locked" };
};
