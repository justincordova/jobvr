import { DAY_MS } from "./constants";
import type { Database } from "./db/client";
import { type Logger, silentLogger } from "./logger";
import type { Notifier } from "./notify";
import { type BackupStatus, getSettingsState, setSettingsTimestamp } from "./repos/settings";
import { inQuietHours } from "./schedule";

/** A nightly backup that hasn't succeeded for this long has been missed. */
export const BACKUP_STALE_MS = 26 * 60 * 60_000;
/** At most one backup alert push per day while the problem lasts. */
const ALERT_EVERY_MS = DAY_MS;

/**
 * What's wrong with the backups, or null. Nothing is reported until a backup
 * has been recorded at least once (no backup service runs on the Mac).
 */
export const backupProblem = (b: BackupStatus, now: Date): string | null => {
  if (b.errorAt && (!b.lastBackupAt || b.errorAt > b.lastBackupAt)) {
    return `the last backup failed: ${b.error ?? "unknown error"}`;
  }
  if (b.lastBackupAt && now.getTime() - b.lastBackupAt.getTime() > BACKUP_STALE_MS) {
    return `no backup for ${Math.round((now.getTime() - b.lastBackupAt.getTime()) / 3_600_000)} hours`;
  }
  return null;
};

/**
 * Pushes a backup alert (outside quiet hours, once a day while it lasts), so
 * a broken backup isn't found only when a restore is needed.
 */
export const runBackupCheck = async (options: {
  database: Database;
  notifier: Notifier | null;
  now?: () => Date;
  logger?: Logger;
}): Promise<{ problem: string | null; alerted: boolean }> => {
  const now = (options.now ?? (() => new Date()))();
  const log = (options.logger ?? silentLogger).child({ module: "backup" });
  const { db } = options.database;
  const state = await getSettingsState(db);
  const problem = backupProblem(state.backup, now);
  if (!problem) return { problem, alerted: false };
  const { alertAt } = state.backup;
  if (alertAt && now.getTime() - alertAt.getTime() < ALERT_EVERY_MS) {
    log.debug({ problem }, `backup problem already reported: ${problem}`);
    return { problem, alerted: false };
  }
  if (inQuietHours(now, state.settings.quietHours)) {
    log.debug({ problem }, `backup problem (${problem}); pushing after quiet hours`);
    return { problem, alerted: false };
  }
  log.warn({ problem }, `backup problem: ${problem}; check docker compose logs backup`);
  if (!options.notifier) {
    // Logged once a day, like the push
    await setSettingsTimestamp(db, "backupAlertAt", now);
    return { problem, alerted: false };
  }
  try {
    await options.notifier.send({
      title: "jobvr backup problem",
      body: `${problem[0]?.toUpperCase()}${problem.slice(1)}. On the PC: docker compose logs backup`,
    });
  } catch (err) {
    log.warn({ err }, "backup alert push failed; retrying next tick");
    return { problem, alerted: false };
  }
  await setSettingsTimestamp(db, "backupAlertAt", now);
  return { problem, alerted: true };
};
