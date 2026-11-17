import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { CLEANUP_INTERVAL_MS, NOTIFY_LOCK_KEY } from "./constants";
import type { Database } from "./db/client";
import { jobs } from "./db/schema";
import { HttpError } from "./http";
import { withAdvisoryLock } from "./lock";
import { formatDuration, type Logger, silentLogger } from "./logger";
import { isFreshMatch, type JobRecord, kindLookup, loadJobViews } from "./repos/jobs";
import { getSettingsState, setSettingsTimestamp } from "./repos/settings";
import { inQuietHours, isDue } from "./schedule";
import { retentionMs, type Settings } from "./settings";
import type { Registry } from "./sources/types";

export interface PushMessage {
  title: string;
  body: string;
  clickUrl?: string;
}

/** Push port (ntfy today). */
export interface Notifier {
  send(message: PushMessage): Promise<void>;
}

/** ntfy.sh (or self-hosted) topic; the topic URL is the secret. */
export const createNtfyNotifier = (
  topicUrl: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Notifier => ({
  async send(message) {
    const res = await (deps.fetch ?? fetch)(topicUrl, {
      method: "POST",
      body: message.body,
      headers: {
        Title: message.title,
        Tags: "briefcase",
        ...(message.clickUrl && { Click: message.clickUrl }),
      },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
    });
    // The topic URL is the secret, so it's never part of the error
    if (!res.ok) throw new HttpError(`ntfy responded ${res.status}`, res.status);
  },
});

/** Jobs that would be pushed right now (pushable rule). */
export const selectPushable = async (
  database: Database,
  registry: Registry,
  settings: Settings,
  now: Date,
): Promise<JobRecord[]> => {
  const candidates = await loadJobViews(
    database.db,
    and(
      isNull(jobs.notifiedAt),
      eq(jobs.baseline, false),
      inArray(jobs.state, ["new", "saved"]),
      isNull(jobs.closedAt),
      gte(jobs.effectiveAt, new Date(now.getTime() - settings.maxJobAgeHours * 3_600_000)),
    ),
  );
  const kindOf = kindLookup(registry);
  return candidates.filter((j) => isFreshMatch(j, settings, kindOf, now));
};

export const pushBody = (count: number) => `${count} new job${count === 1 ? "" : "s"}`;

export interface RunNotifyOptions {
  database: Database;
  registry: Registry;
  /** Null when NTFY_URL is unset: nothing is sent or marked. */
  notifier: Notifier | null;
  publicUrl?: string;
  /** Skip the due check and quiet hours (manual `pnpm notify`). */
  force?: boolean;
  /** Select only; never send or mark. */
  dryRun?: boolean;
  now?: () => Date;
  logger?: Logger;
}

export type NotifySummary =
  | { sent: false; reason: "locked" | "not_due" | "quiet_hours" | "nothing_new" | "no_notifier" }
  | { sent: false; reason: "dry_run" | "failed"; jobs: JobRecord[] }
  | { sent: true; jobs: JobRecord[] };

/** Warn about a missing NTFY_URL once per process, not every tick. */
let warnedNoNotifier = false;

/** "fetch failed (ECONNREFUSED)" rather than a stack: push failures are expected now and then. */
const pushError = (err: unknown) => {
  if (!(err instanceof Error)) return { error: String(err) };
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return {
    error: err.message,
    ...(err instanceof HttpError && err.status !== undefined && { status: err.status }),
    ...(cause && { cause }),
  };
};

export const runNotify = async (options: RunNotifyOptions): Promise<NotifySummary> => {
  const clock = options.now ?? (() => new Date());
  const log = (options.logger ?? silentLogger).child({ module: "notify" });
  const { database } = options;

  const locked = await withAdvisoryLock(
    database.pool,
    NOTIFY_LOCK_KEY,
    async (): Promise<NotifySummary> => {
      const now = clock();
      const state = await getSettingsState(database.db);
      const s = state.settings;
      if (!options.force) {
        if (!isDue(state.lastPushAt, s.pushEveryMinutes * 60_000, now)) {
          log.debug({ lastPushAt: state.lastPushAt }, "push not due yet");
          return { sent: false, reason: "not_due" };
        }
        if (inQuietHours(now, s.quietHours)) {
          log.debug(
            s.quietHours,
            `quiet hours (${s.quietHours.start}-${s.quietHours.end} ET); new jobs wait for the first push after`,
          );
          return { sent: false, reason: "quiet_hours" };
        }
      }
      const selected = await selectPushable(database, options.registry, s, now);
      if (options.dryRun) return { sent: false, reason: "dry_run", jobs: selected };
      if (selected.length === 0) {
        log.debug({}, "nothing new to push");
        return { sent: false, reason: "nothing_new" };
      }
      if (!options.notifier) {
        if (!warnedNoNotifier) {
          log.warn(
            { pending: selected.length },
            `NTFY_URL is not set, so ${selected.length} pushable jobs aren't pushed (warned once)`,
          );
          warnedNoNotifier = true;
        }
        return { sent: false, reason: "no_notifier" };
      }
      const started = performance.now();
      try {
        await options.notifier.send({
          title: "jobvr",
          body: pushBody(selected.length),
          clickUrl: options.publicUrl,
        });
      } catch (err) {
        log.error(
          { pending: selected.length, ...pushError(err) },
          `push of ${selected.length} jobs failed; retrying next tick`,
        );
        return { sent: false, reason: "failed", jobs: selected };
      }
      await database.db.transaction(async (tx) => {
        await tx
          .update(jobs)
          .set({ notifiedAt: now })
          .where(
            inArray(
              jobs.id,
              selected.map((j) => j.id),
            ),
          );
        await setSettingsTimestamp(tx, "lastPushAt", now);
      });
      log.info(
        { count: selected.length, jobIds: selected.map((j) => j.id) },
        `push sent: ${pushBody(selected.length)} · ${formatDuration(performance.now() - started)}`,
      );
      return { sent: true, jobs: selected };
    },
  );
  if (!locked.acquired) log.info({}, "push skipped: another notify run holds the lock");
  return locked.acquired ? locked.value : { sent: false, reason: "locked" };
};

/** Daily retention: drops new/hidden jobs past the store window + margin (sources cascade). */
export const runCleanup = async (options: {
  database: Database;
  force?: boolean;
  now?: () => Date;
  logger?: Logger;
}): Promise<{ ran: boolean; deleted: number }> => {
  const now = (options.now ?? (() => new Date()))();
  const { db } = options.database;
  const state = await getSettingsState(db);
  if (!options.force && !isDue(state.lastCleanupAt, CLEANUP_INTERVAL_MS, now)) {
    return { ran: false, deleted: 0 };
  }
  await setSettingsTimestamp(db, "lastCleanupAt", now);
  const cutoff = new Date(now.getTime() - retentionMs(state.settings));
  const deleted = await db
    .delete(jobs)
    .where(and(inArray(jobs.state, ["new", "hidden"]), lt(jobs.effectiveAt, cutoff)))
    .returning({ id: jobs.id });
  const days = Math.round(retentionMs(state.settings) / 86_400_000);
  (options.logger ?? silentLogger)
    .child({ module: "cleanup" })
    .info(
      { deleted: deleted.length, cutoff },
      `cleanup deleted ${deleted.length} new/hidden jobs older than ${days} days`,
    );
  return { ran: true, deleted: deleted.length };
};
