import { createHash } from "node:crypto";
import { gte, inArray } from "drizzle-orm";
import {
  FILTER_VERSION,
  POLL_BUDGET_MS,
  POLL_LOCK_KEY,
  STORE_WINDOW_MS,
  type TierFilter,
} from "../constants";
import type { Database } from "../db/client";
import { type CompanyRow, companies, jobSources, jobs, sourceState } from "../db/schema";
import type { HttpClient } from "../http";
import { withAdvisoryLock } from "../lock";
import { type Logger, silentLogger } from "../logger";
import { companyStateKey } from "../repos/companies";
import { getSettingsState, setSettingsTimestamp } from "../repos/settings";
import { isDue } from "../schedule";
import type { Settings } from "../settings";
import { getAdapter } from "../sources/registry";
import type { FetchResult, Registry } from "../sources/types";
import { processTarget, recordFailure, type Target, type TargetStats } from "./process";
import { indexCompanies } from "./resolve";
import { type JobMap, WorkingSet } from "./store";

export interface RunPollOptions {
  database: Database;
  registry: Registry;
  http: HttpClient;
  /** Skip the due check (manual `pnpm poll`). */
  force?: boolean;
  now?: () => Date;
  logger?: Logger;
  budgetMs?: number;
}

export type TargetOutcome = { key: string; label: string } & (
  | { status: "ok" | "not_modified"; stats: TargetStats }
  | { status: "failed"; error: string }
  | { status: "skipped" }
);

const targetLabel = (t: Target) =>
  t.kind === "company" ? `${t.company.name} (${t.adapter.label})` : t.adapter.label;

export type PollSummary =
  | { ran: false; reason: "locked" | "not_due" }
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
      }),
    )
    .digest("hex");

export const pollTargets = (
  registry: Registry,
  settings: Settings,
  rows: readonly CompanyRow[],
): Target[] => {
  const enabled = new Set(settings.enabledSources);
  const tiers = new Set<TierFilter>(settings.tiersToTrack);
  const targets: Target[] = [];
  for (const company of rows) {
    const adapter = getAdapter(registry, company.ats);
    if (adapter?.kind !== "ats") continue;
    if (!company.track || !company.slug || company.status === "manual_only") continue;
    if (!tiers.has(company.tier as TierFilter) || !enabled.has(adapter.id)) continue;
    targets.push({ kind: "company", key: companyStateKey(company.id), adapter, company });
  }
  for (const adapter of registry) {
    if (adapter.kind === "aggregator" && enabled.has(adapter.id)) {
      targets.push({ kind: "aggregator", key: adapter.id, adapter });
    }
  }
  return targets;
};

type Fetched = { result: FetchResult } | { error: string } | { skipped: true };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Parallel fetch with per-source concurrency and one overall time budget. */
const fetchAll = async (
  targets: readonly Target[],
  etagFor: (t: Target) => string | null,
  http: HttpClient,
  budgetMs: number,
): Promise<Map<string, Fetched>> => {
  const out = new Map<string, Fetched>();
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(new Error("Poll fetch budget exceeded")), budgetMs);
  const bySource = new Map<string, Target[]>();
  for (const t of targets) {
    const list = bySource.get(t.adapter.id) ?? [];
    list.push(t);
    bySource.set(t.adapter.id, list);
  }
  const workers: Promise<void>[] = [];
  for (const queue of bySource.values()) {
    const concurrency = Math.max(1, queue[0]?.adapter.concurrency ?? 1);
    for (let i = 0; i < concurrency; i++) {
      workers.push(
        (async () => {
          for (let t = queue.shift(); t; t = queue.shift()) {
            if (budget.signal.aborted) {
              out.set(t.key, { skipped: true });
              continue;
            }
            try {
              const result = await t.adapter.fetch({
                slug: t.kind === "company" ? (t.company.slug ?? undefined) : undefined,
                companyName: t.kind === "company" ? t.company.name : undefined,
                etag: etagFor(t),
                signal: budget.signal,
                http,
              });
              out.set(t.key, { result });
            } catch (err) {
              out.set(t.key, {
                error: budget.signal.aborted ? "Poll fetch budget exceeded" : errorMessage(err),
              });
            }
          }
        })(),
      );
    }
  }
  await Promise.all(workers);
  clearTimeout(timer);
  return out;
};

const loadWindow = async (database: Database, now: Date): Promise<JobMap> => {
  const { db } = database;
  const since = new Date(now.getTime() - STORE_WINDOW_MS);
  const jobRows = await db.select().from(jobs).where(gte(jobs.effectiveAt, since));
  const map: JobMap = new Map(jobRows.map((j) => [j.id, { job: j, sources: [] }]));
  const ids = [...map.keys()];
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    const rows = await db.select().from(jobSources).where(inArray(jobSources.jobId, chunk));
    for (const r of rows) map.get(r.jobId)?.sources.push(r);
  }
  return map;
};

export const runPoll = async (options: RunPollOptions): Promise<PollSummary> => {
  const { database, registry, http } = options;
  const clock = options.now ?? (() => new Date());
  const log = options.logger ?? silentLogger;

  const locked = await withAdvisoryLock(database.pool, POLL_LOCK_KEY, async () => {
    const { db } = database;
    const startedAt = clock();
    const state = await getSettingsState(db);
    const settings = state.settings;
    if (!options.force && !isDue(state.lastPollAt, settings.pollEveryMinutes * 60_000, startedAt)) {
      return { ran: false, reason: "not_due" } as const;
    }
    await setSettingsTimestamp(db, "lastPollAt", startedAt);

    const companyRows = await db.select().from(companies);
    const companyIndex = indexCompanies(companyRows);
    const states = new Map((await db.select().from(sourceState)).map((s) => [s.key, s]));
    let window = await loadWindow(database, startedAt);

    const targets = pollTargets(registry, settings, companyRows);
    const hash = filtersHash(settings);
    const etagFor = (t: Target) => {
      const s = states.get(t.key);
      if (!s) return null;
      const slug = t.kind === "company" ? t.company.slug : null;
      return s.slug === slug && s.filtersHash === hash ? s.etag : null;
    };

    log.info({ targets: targets.length }, "poll started");
    const fetched = await fetchAll(targets, etagFor, http, options.budgetMs ?? POLL_BUDGET_MS);

    // ATS targets first so their data is in place before aggregators merge into it
    const ordered = [
      ...targets.filter((t) => t.kind === "company"),
      ...targets.filter((t) => t.kind === "aggregator"),
    ];
    const outcomes: TargetOutcome[] = [];
    for (const target of ordered) {
      const f = fetched.get(target.key) ?? { skipped: true as const };
      if ("skipped" in f) {
        outcomes.push({ key: target.key, label: targetLabel(target), status: "skipped" });
        continue;
      }
      const now = clock();
      let error = "error" in f ? f.error : null;
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
            }),
          );
          window = ws.commit();
          outcomes.push({
            key: target.key,
            label: targetLabel(target),
            status: f.result.status,
            stats,
          });
          continue;
        } catch (err) {
          error = errorMessage(err);
          log.error({ err, target: target.key }, "poll target processing failed");
        }
      }
      const message = error ?? "unknown error";
      log.warn({ target: target.key, error: message }, "poll target failed");
      await db
        .transaction((tx) => recordFailure(tx, target, message, now))
        .catch((err) => log.error({ err, target: target.key }, "failed to record poll failure"));
      outcomes.push({
        key: target.key,
        label: targetLabel(target),
        status: "failed",
        error: message,
      });
    }

    const failed = outcomes.filter((o) => o.status === "failed").length;
    log.info({ targets: outcomes.length, failed }, "poll finished");
    return { ran: true, startedAt, targets: outcomes } as const;
  });

  return locked.acquired ? locked.value : { ran: false, reason: "locked" };
};
