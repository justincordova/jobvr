import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./db/client";
import { settings } from "./db/schema";
import type { Notifier, PushMessage } from "./notify";
import { pollStalledFor, runPollStallCheck } from "./poll-stall-check";
import { getSettingsState, setSettingsTimestamp } from "./repos/settings";
import { createTestDatabase } from "./testing/db";

const HOUR = 3_600_000;
// 15:00 UTC = 10:00 Eastern, outside quiet hours
const NOW = new Date("2026-11-17T15:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());
beforeEach(async () => {
  await database.db.delete(settings);
  await getSettingsState(database.db);
});

describe("pollStalledFor", () => {
  it("allows three intervals, counting from boot when that's later", () => {
    expect(pollStalledFor(ago(2), ago(48), 60, NOW)).toBeNull();
    expect(pollStalledFor(ago(4), ago(48), 60, NOW)).toBe(4 * HOUR);
    // Just booted: the old success doesn't count yet
    expect(pollStalledFor(ago(30), ago(1), 60, NOW)).toBeNull();
    expect(pollStalledFor(null, ago(1), 60, NOW)).toBeNull();
    expect(pollStalledFor(null, ago(5), 60, NOW)).toBe(5 * HOUR);
  });
});

describe("runPollStallCheck", () => {
  it("pushes once a day while polling is stalled, never in quiet hours", async () => {
    const sent: PushMessage[] = [];
    const notifier: Notifier = { send: async (m) => void sent.push(m) };
    await setSettingsTimestamp(database.db, "lastPollOkAt", ago(5));
    const bootedAt = ago(48);
    const night = new Date("2026-11-17T08:05:00Z");
    expect(
      (await runPollStallCheck({ database, notifier, bootedAt, now: () => night })).alerted,
    ).toBe(false);
    expect(
      (await runPollStallCheck({ database, notifier, bootedAt, now: () => NOW })).alerted,
    ).toBe(true);
    expect(sent).toEqual([
      {
        title: "jobvr polling stalled",
        body: "No poll has finished for 5 hours. On the PC: docker compose logs app",
      },
    ]);
    const later = new Date(NOW.getTime() + 6 * HOUR);
    expect(
      (await runPollStallCheck({ database, notifier, bootedAt, now: () => later })).alerted,
    ).toBe(false);
    // Recovered: nothing to say
    await setSettingsTimestamp(database.db, "lastPollOkAt", later);
    expect(
      (await runPollStallCheck({ database, notifier, bootedAt, now: () => later })).stalledMs,
    ).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
