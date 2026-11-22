import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backupProblem, runBackupCheck } from "./backup-check";
import type { Database } from "./db/client";
import { settings } from "./db/schema";
import type { Notifier, PushMessage } from "./notify";
import { getSettingsState } from "./repos/settings";
import { createTestDatabase } from "./testing/db";

const HOUR = 3_600_000;
// 15:00 UTC = 10:00 Eastern, outside quiet hours
const NOW = new Date("2026-11-17T15:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);
const none = { lastBackupAt: null, error: null, errorAt: null, alertAt: null };

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());
beforeEach(async () => {
  await database.db.delete(settings);
  await getSettingsState(database.db);
});

describe("backupProblem", () => {
  it("is quiet until a backup was ever recorded, then flags failures and gaps", () => {
    expect(backupProblem(none, NOW)).toBeNull();
    expect(backupProblem({ ...none, lastBackupAt: ago(12) }, NOW)).toBeNull();
    expect(backupProblem({ ...none, lastBackupAt: ago(30) }, NOW)).toBe("no backup for 30 hours");
    expect(
      backupProblem({ ...none, lastBackupAt: ago(36), error: "disk full", errorAt: ago(12) }, NOW),
    ).toBe("the last backup failed: disk full");
    // A later success clears an older failure
    expect(
      backupProblem({ ...none, lastBackupAt: ago(1), error: "disk full", errorAt: ago(25) }, NOW),
    ).toBeNull();
  });
});

describe("runBackupCheck", () => {
  it("pushes once a day while the problem lasts, never in quiet hours", async () => {
    const sent: PushMessage[] = [];
    const notifier: Notifier = { send: async (m) => void sent.push(m) };
    await database.db
      .update(settings)
      .set({
        lastBackupAt: ago(40),
        backupError: "pg_dump: connection refused",
        backupErrorAt: ago(16),
      })
      .where(eq(settings.id, 1));

    // 03:05 Eastern: quiet hours, held
    const night = new Date("2026-11-17T08:05:00Z");
    expect((await runBackupCheck({ database, notifier, now: () => night })).alerted).toBe(false);
    expect((await runBackupCheck({ database, notifier, now: () => NOW })).alerted).toBe(true);
    expect(sent).toEqual([
      {
        title: "jobvr backup problem",
        body: "The last backup failed: pg_dump: connection refused. On the PC: docker compose logs backup",
      },
    ]);
    // Same day: not again
    const later = new Date(NOW.getTime() + 6 * HOUR);
    expect((await runBackupCheck({ database, notifier, now: () => later })).alerted).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("waits for a problem to last 10 minutes, so a just-woken PC can catch up", async () => {
    const sent: PushMessage[] = [];
    const notifier: Notifier = { send: async (m) => void sent.push(m) };
    await database.db
      .update(settings)
      .set({ lastBackupAt: ago(30), backupError: null, backupErrorAt: null, backupAlertAt: null })
      .where(eq(settings.id, 1));
    const seen: { since: Date | null } = { since: null };
    const at = (min: number) => () => new Date(NOW.getTime() + min * 60_000);
    expect((await runBackupCheck({ database, notifier, seen, now: at(0) })).alerted).toBe(false);
    expect((await runBackupCheck({ database, notifier, seen, now: at(5) })).alerted).toBe(false);
    // The backup lands: the problem's gone and the wait starts over next time
    await database.db
      .update(settings)
      .set({ lastBackupAt: at(6)() })
      .where(eq(settings.id, 1));
    expect((await runBackupCheck({ database, notifier, seen, now: at(10) })).problem).toBeNull();
    expect(seen.since).toBeNull();
    expect(sent).toHaveLength(0);
  });
});
