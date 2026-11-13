import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { CLEANUP_INTERVAL_MS, NOTIFY_LOCK_KEY, RETENTION_MS } from "./constants";
import type { Database } from "./db/client";
import { jobs } from "./db/schema";
import { withAdvisoryLock } from "./lock";
import { type Logger, silentLogger } from "./logger";
import { isFreshMatch, type JobRecord, kindLookup, loadJobViews } from "./repos/jobs";
import { getSettingsState, setSettingsTimestamp } from "./repos/settings";
import { inQuietHours, isDue } from "./schedule";
import type { Settings } from "./settings";
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
    if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
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

export const runNotify = async (options: RunNotifyOptions): Promise<NotifySummary> => {
  const clock = options.now ?? (() => new Date());
  const log = options.logger ?? silentLogger;
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
          return { sent: false, reason: "not_due" };
        }
        if (inQuietHours(now, s.quietHours)) return { sent: false, reason: "quiet_hours" };
      }
      const selected = await selectPushable(database, options.registry, s, now);
      if (options.dryRun) return { sent: false, reason: "dry_run", jobs: selected };
      if (selected.length === 0) return { sent: false, reason: "nothing_new" };
      if (!options.notifier) {
        log.warn({ pending: selected.length }, "NTFY_URL is not set; skipping push");
        return { sent: false, reason: "no_notifier" };
      }
      try {
        await options.notifier.send({
          title: "jobvr",
          body: pushBody(selected.length),
          clickUrl: options.publicUrl,
        });
      } catch (err) {
        log.error({ err }, "push failed; will retry next tick");
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
      log.info({ count: selected.length }, "push sent");
      return { sent: true, jobs: selected };
    },
  );
  return locked.acquired ? locked.value : { sent: false, reason: "locked" };
};

/** Daily retention: drops new/hidden jobs older than 30 days (sources cascade). */
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
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const deleted = await db
    .delete(jobs)
    .where(and(inArray(jobs.state, ["new", "hidden"]), lt(jobs.effectiveAt, cutoff)))
    .returning({ id: jobs.id });
  options.logger?.info({ deleted: deleted.length }, "cleanup finished");
  return { ran: true, deleted: deleted.length };
};
