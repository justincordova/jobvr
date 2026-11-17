import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { settings } from "../db/schema";
import {
  DEFAULT_SETTINGS,
  parseStoredSettings,
  type Settings,
  type SettingsPatch,
  SettingsSchema,
} from "../settings";

export interface SettingsState {
  settings: Settings;
  lastVisitAt: Date | null;
  lastPollAt: Date | null;
  lastPollOkAt: Date | null;
  pollStallAlertAt: Date | null;
  lastPushAt: Date | null;
  lastCleanupAt: Date | null;
  backup: BackupStatus;
  sourceOutages: SourceOutages;
}

/** An ATS whose boards all failed in the latest polls (an outage, not the boards). */
export interface SourceOutage {
  /** First poll that found it down (ISO). */
  since: string;
  /** Latest poll that found it down (ISO). */
  lastSeenAt: string;
  error: string;
  boards: number;
}
export type SourceOutages = Record<string, SourceOutage>;

/**
 * Records this poll's view of each ATS: down ones are added (keeping `since`),
 * ones where a board answered are cleared. Sources not polled are left alone.
 */
export const recordSourceOutages = async (
  db: DbOrTx,
  down: ReadonlyMap<string, { count: number; error: string }>,
  answered: ReadonlySet<string>,
  now: Date,
): Promise<SourceOutages> => {
  const { sourceOutages: current } = await getSettingsState(db);
  const next: SourceOutages = { ...current };
  for (const source of answered) delete next[source];
  for (const [source, { count, error }] of down) {
    next[source] = {
      since: current[source]?.since ?? now.toISOString(),
      lastSeenAt: now.toISOString(),
      error,
      boards: count,
    };
  }
  if (JSON.stringify(next) !== JSON.stringify(current)) {
    await db.update(settings).set({ sourceOutages: next }).where(eq(settings.id, 1));
  }
  return next;
};

/** As recorded by deploy/backup.sh; all null where no backup service runs (the Mac). */
export interface BackupStatus {
  lastBackupAt: Date | null;
  error: string | null;
  errorAt: Date | null;
  alertAt: Date | null;
}

export type SettingsTimestamp =
  | "lastVisitAt"
  | "lastPollAt"
  | "lastPollOkAt"
  | "pollStallAlertAt"
  | "lastPushAt"
  | "lastCleanupAt"
  | "backupAlertAt";

const ensureRow = (db: DbOrTx) =>
  db.insert(settings).values({ id: 1, data: DEFAULT_SETTINGS }).onConflictDoNothing();

export const getSettingsState = async (db: DbOrTx): Promise<SettingsState> => {
  let [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!row) {
    await ensureRow(db);
    [row] = await db.select().from(settings).where(eq(settings.id, 1));
  }
  if (!row) throw new Error("settings row missing");
  return {
    settings: parseStoredSettings(row.data),
    lastVisitAt: row.lastVisitAt,
    lastPollAt: row.lastPollAt,
    lastPollOkAt: row.lastPollOkAt,
    pollStallAlertAt: row.pollStallAlertAt,
    lastPushAt: row.lastPushAt,
    lastCleanupAt: row.lastCleanupAt,
    backup: {
      lastBackupAt: row.lastBackupAt,
      error: row.backupError,
      errorAt: row.backupErrorAt,
      alertAt: row.backupAlertAt,
    },
    sourceOutages: (row.sourceOutages ?? {}) as SourceOutages,
  };
};

export const getSettings = async (db: DbOrTx): Promise<Settings> =>
  (await getSettingsState(db)).settings;

/** Replaces each provided top-level field wholesale and validates the result. */
export const updateSettings = async (db: DbOrTx, patch: SettingsPatch): Promise<Settings> => {
  await ensureRow(db);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).where(eq(settings.id, 1)).for("update");
    const current = parseStoredSettings(row?.data);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = SettingsSchema.parse({ ...current, ...defined });
    await tx.update(settings).set({ data: next }).where(eq(settings.id, 1));
    return next;
  });
};

export const setSettingsTimestamp = async (
  db: DbOrTx,
  field: SettingsTimestamp,
  at: Date | null,
): Promise<void> => {
  await ensureRow(db);
  await db
    .update(settings)
    .set({ [field]: at })
    .where(eq(settings.id, 1));
};
