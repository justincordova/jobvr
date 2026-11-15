import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./db/client";
import { companies, jobSources, jobs, settings } from "./db/schema";
import { type Notifier, type PushMessage, runCleanup, runNotify, selectPushable } from "./notify";
import { createCompany } from "./repos/companies";
import { getSettingsState, updateSettings } from "./repos/settings";
import { DEFAULT_SETTINGS } from "./settings";
import type { Registry, SourceAdapter } from "./sources/types";
import { createTestDatabase } from "./testing/db";

const HOUR = 3_600_000;
// 15:00 UTC = 10:00 Eastern (outside default quiet hours)
const NOW = new Date("2026-11-12T15:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);

const stub = (id: string, kind: "ats" | "aggregator"): SourceAdapter => ({
  id,
  label: id,
  kind,
  idPrefix: id.slice(0, 2),
  concurrency: 1,
  fetch: async () => ({ status: "not_modified" }),
});
const registry: Registry = [stub("greenhouse", "ats"), stub("simplify", "aggregator")];

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.db.delete(jobs);
  await database.db.delete(companies);
  await database.db.delete(settings);
});

const addJob = async (id: string, extra: Partial<typeof jobs.$inferInsert> = {}) => {
  await database.db.insert(jobs).values({
    id,
    companyName: "Acme",
    title: "Software Engineer, New Grad",
    locations: ["New York, NY"],
    url: `https://x.test/${id}`,
    primarySource: "greenhouse",
    firstSeenAt: ago(1),
    effectiveAt: ago(1),
    ...extra,
  });
  await database.db.insert(jobSources).values({
    source: "greenhouse",
    sourceJobId: id,
    jobId: id,
    url: `https://x.test/${id}`,
    title: "Software Engineer, New Grad",
    postedAt: ago(1),
    postedAtPrecision: "instant",
  });
};

const recorder = (fail = false) => {
  const sent: PushMessage[] = [];
  const notifier: Notifier = {
    async send(m) {
      if (fail) throw new Error("down");
      sent.push(m);
    },
  };
  return { sent, notifier };
};

describe("selectPushable", () => {
  it("applies the pushable rule (tier, not track)", async () => {
    const s = await createCompany(database.db, {
      name: "Stripe",
      tier: "S",
      track: false,
      ats: "other",
      status: "manual_only",
    });
    const corp = await createCompany(database.db, {
      name: "Bloomberg",
      tier: "Corporate",
      track: false,
      ats: "other",
      status: "manual_only",
    });
    await addJob("ok");
    await addJob("corp", { companyId: corp.id });
    await addJob("s-tier", { companyId: s.id });
    await addJob("baseline", { baseline: true });
    await addJob("notified", { notifiedAt: ago(0.5) });
    await addJob("hidden", { state: "hidden" });
    await addJob("saved", { state: "saved" });
    await addJob("old", { effectiveAt: ago(25) });
    await addJob("closed", { closedAt: ago(0.1) });
    await addJob("far", { locations: ["Austin, TX"] });

    const withoutS = {
      ...DEFAULT_SETTINGS,
      tiersToTrack: DEFAULT_SETTINGS.tiersToTrack.filter((t) => t !== "S"),
    };
    const ids = (await selectPushable(database, registry, withoutS, NOW)).map((j) => j.id);
    expect(ids.sort()).toEqual(["corp", "ok", "saved"]);

    const withS = DEFAULT_SETTINGS;
    expect((await selectPushable(database, registry, withS, NOW)).map((j) => j.id)).toContain(
      "s-tier",
    );
  });
});

describe("runNotify", () => {
  it("sends one bundled push, marks exactly those jobs, then waits for the interval", async () => {
    await addJob("a");
    await addJob("b");
    const { sent, notifier } = recorder();
    const first = await runNotify({
      database,
      registry,
      notifier,
      publicUrl: "https://jobvr.example.ts.net",
      now: () => NOW,
    });
    expect(first.sent).toBe(true);
    expect(sent).toEqual([
      { title: "jobvr", body: "2 new jobs", clickUrl: "https://jobvr.example.ts.net" },
    ]);
    const rows = await database.db.select().from(jobs);
    expect(rows.every((j) => j.notifiedAt?.getTime() === NOW.getTime())).toBe(true);
    expect((await getSettingsState(database.db)).lastPushAt).toEqual(NOW);

    await addJob("c", { firstSeenAt: NOW, effectiveAt: NOW });
    const later = new Date(NOW.getTime() + 30 * 60_000);
    expect(await runNotify({ database, registry, notifier, now: () => later })).toEqual({
      sent: false,
      reason: "not_due",
    });
    const hourLater = new Date(NOW.getTime() + 59 * 60_000);
    const third = await runNotify({ database, registry, notifier, now: () => hourLater });
    expect(third.sent).toBe(true);
    expect(sent[1]?.body).toBe("1 new job");
  });

  it("holds pushes during quiet hours and doesn't touch last_push_at when nothing is new", async () => {
    await addJob("a");
    const { sent, notifier } = recorder();
    const night = new Date("2026-11-13T05:00:00Z"); // 00:00 Eastern
    await addJob("night", { firstSeenAt: night, effectiveAt: night });
    expect(await runNotify({ database, registry, notifier, now: () => night })).toEqual({
      sent: false,
      reason: "quiet_hours",
    });
    expect(sent).toHaveLength(0);

    await updateSettings(database.db, { quietHours: { start: "00:00", end: "00:00" } });
    await database.db.update(jobs).set({ notifiedAt: NOW });
    expect(await runNotify({ database, registry, notifier, now: () => night })).toEqual({
      sent: false,
      reason: "nothing_new",
    });
    expect((await getSettingsState(database.db)).lastPushAt).toBeNull();
  });

  it("marks nothing on failure or without a notifier, and supports dry runs", async () => {
    await addJob("a");
    const failing = recorder(true);
    expect(
      (await runNotify({ database, registry, notifier: failing.notifier, now: () => NOW })).sent,
    ).toBe(false);
    expect(await runNotify({ database, registry, notifier: null, now: () => NOW })).toEqual({
      sent: false,
      reason: "no_notifier",
    });
    const dry = await runNotify({
      database,
      registry,
      notifier: null,
      dryRun: true,
      now: () => NOW,
    });
    expect(dry).toMatchObject({ reason: "dry_run", jobs: [expect.objectContaining({ id: "a" })] });
    const [row] = await database.db.select().from(jobs).where(eq(jobs.id, "a"));
    expect(row?.notifiedAt).toBeNull();
  });
});

describe("runCleanup", () => {
  it("deletes old new/hidden jobs once a day, keeping saved and applied", async () => {
    const old = new Date(NOW.getTime() - 46 * 24 * HOUR);
    await addJob("old-new", { effectiveAt: old });
    await addJob("old-hidden", { effectiveAt: old, state: "hidden" });
    await addJob("old-saved", { effectiveAt: old, state: "saved" });
    await addJob("old-applied", { effectiveAt: old, state: "applied" });
    await addJob("recent");
    expect(await runCleanup({ database, now: () => NOW })).toEqual({ ran: true, deleted: 2 });
    const ids = (await database.db.select().from(jobs)).map((j) => j.id).sort();
    expect(ids).toEqual(["old-applied", "old-saved", "recent"]);
    expect(
      await database.db.select().from(jobSources).where(eq(jobSources.jobId, "old-new")),
    ).toHaveLength(0);
    expect((await runCleanup({ database, now: () => NOW })).ran).toBe(false);
  });
});
