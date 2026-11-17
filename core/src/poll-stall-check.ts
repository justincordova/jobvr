import { DAY_MS, STALE_POLL_INTERVALS } from "./constants";
import type { Database } from "./db/client";
import { formatDuration, type Logger, silentLogger } from "./logger";

const HOUR_MS = 3_600_000;
const describe = (ms: number) =>
  ms >= 2 * HOUR_MS ? `${Math.round(ms / HOUR_MS)} hours` : formatDuration(ms);

import type { Notifier } from "./notify";
import { getSettingsState, setSettingsTimestamp } from "./repos/settings";
import { inQuietHours } from "./schedule";

/**
 * How long polling has been stalled, or null when it's fine: no poll finished
 * within STALE_POLL_INTERVALS poll intervals of now, counting from `bootedAt`
 * when that's later (a fresh process gets time for its first poll).
 */
export const pollStalledFor = (
  lastPollOkAt: Date | null,
  bootedAt: Date,
  pollEveryMinutes: number,
  now: Date,
): number | null => {
  const since = Math.max(lastPollOkAt?.getTime() ?? 0, bootedAt.getTime());
  const staleMs = STALE_POLL_INTERVALS * pollEveryMinutes * 60_000;
  if (now.getTime() - since <= staleMs) return null;
  return now.getTime() - (lastPollOkAt?.getTime() ?? bootedAt.getTime());
};

/**
 * Pushes a "polling stalled" alert (outside quiet hours, once a day while it
 * lasts): a poll that keeps crashing otherwise only shows as a quiet feed.
 */
export const runPollStallCheck = async (options: {
  database: Database;
  notifier: Notifier | null;
  bootedAt: Date;
  now?: () => Date;
  logger?: Logger;
}): Promise<{ stalledMs: number | null; alerted: boolean }> => {
  const now = (options.now ?? (() => new Date()))();
  const log = (options.logger ?? silentLogger).child({ module: "poll-check" });
  const { db } = options.database;
  const state = await getSettingsState(db);
  const stalledMs = pollStalledFor(
    state.lastPollOkAt,
    options.bootedAt,
    state.settings.pollEveryMinutes,
    now,
  );
  if (stalledMs === null) return { stalledMs, alerted: false };
  const last = state.lastPollOkAt?.toISOString() ?? "never";
  const problem = `no poll has finished for ${describe(stalledMs)}`;
  const { pollStallAlertAt: alertAt } = state;
  if (alertAt && now.getTime() - alertAt.getTime() < DAY_MS) {
    log.debug({ lastPollOkAt: last }, `polling stalled, already reported: ${problem}`);
    return { stalledMs, alerted: false };
  }
  if (inQuietHours(now, state.settings.quietHours)) {
    log.debug({ lastPollOkAt: last }, `polling stalled (${problem}); pushing after quiet hours`);
    return { stalledMs, alerted: false };
  }
  log.warn(
    { lastPollOkAt: last, lastPollStartedAt: state.lastPollAt?.toISOString() ?? null },
    `polling stalled: ${problem}; check the poll errors in docker compose logs app`,
  );
  if (!options.notifier) {
    await setSettingsTimestamp(db, "pollStallAlertAt", now);
    return { stalledMs, alerted: false };
  }
  try {
    await options.notifier.send({
      title: "jobvr polling stalled",
      body: `No poll has finished for ${describe(stalledMs)}. On the PC: docker compose logs app`,
    });
  } catch (err) {
    log.warn({ err }, "polling-stalled push failed; retrying next tick");
    return { stalledMs, alerted: false };
  }
  await setSettingsTimestamp(db, "pollStallAlertAt", now);
  return { stalledMs, alerted: true };
};
