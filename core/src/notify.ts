import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { CLEANUP_INTERVAL_MS, NOTIFY_LOCK_KEY } from "./constants";
import type { Database } from "./db/client";
import { jobs } from "./db/schema";
import { HttpError } from "./http";
import { withAdvisoryLock } from "./lock";
import { formatDuration, type Logger, silentLogger } from "./logger";
import { matchedLocationLabels } from "./matching";
import { byRank } from "./rank";
import {
  collapseReposts,
  isFreshMatch,
  type JobRecord,
  kindLookup,
  loadJobViews,
  scoreJob,
} from "./repos/jobs";
import { getSettingsState, setSettingsTimestamp } from "./repos/settings";
import { inQuietHours, isDue } from "./schedule";
import { retentionMs, type Settings } from "./settings";
import type { Registry } from "./sources/types";

export interface PushMessage {
  title: string;
  body: string;
  clickUrl?: string;
  /** Buttons that open a URL (ntfy shows up to 3). */
  actions?: { label: string; url: string }[];
}

/** Push port (ntfy today). */
export interface Notifier {
  send(message: PushMessage): Promise<void>;
}

/**
 * ntfy.sh (or self-hosted) topic; the topic URL is the secret. Published as
 * JSON to the server root (`{ topic, title, message, ... }`), so titles with
 * "–" or accents never have to fit in an HTTP header.
 */
export const createNtfyNotifier = (
  topicUrl: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Notifier => ({
  async send(message) {
    const url = new URL(topicUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const topic = parts.pop() ?? "";
    url.pathname = `/${parts.join("/")}`;
    const res = await (deps.fetch ?? fetch)(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title: message.title,
        message: message.body,
        tags: ["briefcase"],
        ...(message.clickUrl && { click: message.clickUrl }),
        ...(message.actions?.length && {
          actions: message.actions.map((a) => ({ action: "view", label: a.label, url: a.url })),
        }),
      }),
      // Under the 8 s shutdown grace, so a send is never cut off after ntfy took it
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
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

/** Roles listed in a push body before "+N more". */
const PUSH_LINES = 4;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * The push, readable at a glance: a role posted several times counts once,
 * the best-ranked roles are listed ("Stripe · Software Engineer, New Grad ·
 * NYC"), and tapping opens the feed newest first, where they're on top and
 * highlighted. A single role names its company and gets an "Open posting"
 * button. Job titles and companies are public; nothing personal is sent.
 */
export const buildPush = (
  selected: readonly JobRecord[],
  settings: Settings,
  registry: Registry,
  now: Date,
  publicUrl?: string,
): PushMessage => {
  const kindOf = kindLookup(registry);
  const roles = collapseReposts(
    [...selected].sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime()),
  )
    .map((j) => ({ ...j, score: scoreJob(j, settings, kindOf, now) }))
    .sort(byRank);
  const line = (j: JobRecord, withCompany: boolean) => {
    const places = matchedLocationLabels(j.locations, settings).join(", ");
    return [withCompany && clip(j.companyName, 30), clip(j.title, 70), places]
      .filter(Boolean)
      .join(" · ");
  };
  const clickUrl = publicUrl ? `${publicUrl.replace(/\/$/, "")}/?sort=newest` : undefined;
  const [first] = roles;
  if (roles.length === 1 && first) {
    return {
      title: `New job: ${clip(first.companyName, 40)}`,
      body: line(first, false),
      ...(clickUrl && { clickUrl }),
      actions: [{ label: "Open posting", url: first.url }],
    };
  }
  const shown = roles.slice(0, PUSH_LINES).map((j) => line(j, true));
  const more = roles.length - shown.length;
  return {
    title: pushBody(roles.length),
    body: [...shown, ...(more > 0 ? [`+${more} more`] : [])].join("\n"),
    ...(clickUrl && { clickUrl }),
  };
};

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

const MARK_ATTEMPTS = 3;
const MARK_RETRY_MS = 2000;

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
        await options.notifier.send(
          buildPush(selected, s, options.registry, now, options.publicUrl),
        );
      } catch (err) {
        log.error(
          { pending: selected.length, ...pushError(err) },
          `push of ${selected.length} jobs failed; retrying next tick`,
        );
        return { sent: false, reason: "failed", jobs: selected };
      }
      // The push is out: failing to record it means the next tick pushes the same jobs again
      const markPushed = () =>
        database.db.transaction(async (tx) => {
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
      for (let attempt = 1; ; attempt++) {
        try {
          await markPushed();
          break;
        } catch (err) {
          if (attempt >= MARK_ATTEMPTS) {
            log.error(
              { err, jobIds: selected.map((j) => j.id) },
              `push sent but marking ${selected.length} jobs pushed failed ${attempt} times; the next tick will likely push them again`,
            );
            return { sent: true, jobs: selected };
          }
          log.warn({ err, attempt }, "push sent but marking it failed; retrying in 2 s");
          await new Promise((r) => setTimeout(r, MARK_RETRY_MS));
        }
      }
      log.info(
        { count: selected.length, jobIds: selected.map((j) => j.id) },
        `push sent: ${pushBody(selected.length)} · ${formatDuration(performance.now() - started)}`,
      );
      return { sent: true, jobs: selected };
    },
    (err) =>
      log.error({ err }, "lost the push lock's database connection; the lock is dropped with it"),
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
