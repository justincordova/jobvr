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
  lastPushAt: Date | null;
  lastCleanupAt: Date | null;
}

export type SettingsTimestamp = "lastVisitAt" | "lastPollAt" | "lastPushAt" | "lastCleanupAt";

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
    lastPushAt: row.lastPushAt,
    lastCleanupAt: row.lastCleanupAt,
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
