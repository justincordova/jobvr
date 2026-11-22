import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client";
import { companies, jobSources, jobs, sourceState, suggestions } from "../db/schema";
import { ConflictError, InvalidError, NotFoundError } from "../errors";
import { createTestDatabase } from "../testing/db";
import {
  companyStateKey,
  createCompany,
  deleteCompany,
  findCompanyByName,
  listCompaniesWithHealth,
  updateCompany,
} from "./companies";
import { getSettingsState, setSettingsTimestamp, updateSettings } from "./settings";

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

describe("settings repo", () => {
  it("creates the row on first read and applies wholesale patches", async () => {
    const { db } = database;
    const first = await getSettingsState(db);
    expect(first.settings.maxJobAgeHours).toBe(24);
    expect(first.lastPollAt).toBeNull();

    const next = await updateSettings(db, { excludeKeywords: ["senior"], maxJobAgeHours: 12 });
    expect(next.excludeKeywords).toEqual(["senior"]);
    expect((await getSettingsState(db)).settings.maxJobAgeHours).toBe(12);

    const at = new Date("2026-11-12T10:00:00Z");
    await setSettingsTimestamp(db, "lastPollAt", at);
    expect((await getSettingsState(db)).lastPollAt).toEqual(at);
  });

  it("rejects an invalid patch", async () => {
    await expect(updateSettings(database.db, { roleKeywords: [] })).rejects.toThrow();
  });
});

describe("companies repo", () => {
  const base = { tier: "C", track: true, ats: "lever", status: "ok" } as const;

  it("enforces invariants and uniqueness", async () => {
    const { db } = database;
    await expect(createCompany(db, { ...base, name: "NoSlug" })).rejects.toBeInstanceOf(
      InvalidError,
    );
    await expect(
      createCompany(db, { ...base, name: "Other", ats: "other", track: false }),
    ).rejects.toBeInstanceOf(InvalidError);

    await createCompany(db, { ...base, name: "Regal", slug: "Regal" });
    await expect(
      createCompany(db, { ...base, name: "Regal Inc", slug: "regal2" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createCompany(db, { ...base, name: "Someone", slug: "REGAL" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("resets source state when ats/slug change and failures when status -> ok", async () => {
    const { db } = database;
    const c = await createCompany(db, { ...base, name: "BlueMatrix", slug: "BlueMatrix" });
    const key = companyStateKey(c.id);
    const seedState = () =>
      db
        .insert(sourceState)
        .values({ key, source: "lever", companyId: c.id, slug: c.slug, consecutiveFailures: 3 })
        .onConflictDoNothing();

    await seedState();
    await updateCompany(db, c.id, { status: "ok" });
    const [reset] = await db.select().from(sourceState).where(eq(sourceState.key, key));
    expect(reset?.consecutiveFailures).toBe(0);

    await updateCompany(db, c.id, { slug: "bluematrix" });
    expect(await db.select().from(sourceState).where(eq(sourceState.key, key))).toHaveLength(0);

    await seedState();
    const withHealth = (await listCompaniesWithHealth(db)).find((x) => x.id === c.id);
    expect(withHealth?.health?.consecutiveFailures).toBe(3);

    await deleteCompany(db, c.id);
    expect(await db.select().from(sourceState).where(eq(sourceState.key, key))).toHaveLength(0);
  });

  it("dismisses a deleted company's suggestion, so auto-add doesn't bring it back", async () => {
    const { db } = database;
    const c = await createCompany(db, {
      name: "Zephyrtech",
      tier: "C",
      ats: "other",
      track: false,
      status: "manual_only",
    });
    await db
      .insert(suggestions)
      .values({ id: "zephyrtech", displayName: "Zephyrtech", ats: "other", state: "added" });
    await deleteCompany(db, c.id);
    const [s] = await db.select().from(suggestions).where(eq(suggestions.id, "zephyrtech"));
    expect(s?.state).toBe("dismissed");
  });

  it("dismisses every suggestion a deleted company stood for, and keeps its names dismissed", async () => {
    const { db } = database;
    const c = await createCompany(db, {
      name: "Kira Learning",
      tier: "C",
      ats: "ashby",
      slug: "kira-ai",
      track: true,
      status: "ok",
    });
    await db
      .update(companies)
      .set({ aliases: ["kira labs"] })
      .where(eq(companies.id, c.id));
    const suggestion = (id: string, ats = "other", slug: string | null = null) => ({
      id,
      displayName: id,
      ats,
      slug,
      listingCount: 1,
      state: "open",
    });
    await db
      .insert(suggestions)
      .values([
        suggestion("kira labs"),
        suggestion("kira learning inc", "ashby", "KIRA-AI"),
        suggestion("unrelated", "ashby", "unrelated"),
      ]);
    await deleteCompany(db, c.id);
    const states = Object.fromEntries(
      (await db.select().from(suggestions)).map((s) => [s.id, s.state]),
    );
    expect(states).toMatchObject({
      // By alias, by board, and its names and board slug before any list suggests them
      "kira labs": "dismissed",
      "kira learning inc": "dismissed",
      "kira learning": "dismissed",
      "kira ai": "dismissed",
      unrelated: "open",
    });
    await expect(deleteCompany(db, c.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps a renamed company's old name as an alias, so the lists still find it", async () => {
    const { db } = database;
    const c = await createCompany(db, { ...base, name: "Bask", slug: "bask" });
    const renamed = await updateCompany(db, c.id, { name: "Bask Health" });
    expect(renamed.aliases).toEqual(["bask"]);
    expect((await findCompanyByName(db, "Bask"))?.id).toBe(c.id);
    // Back again: the current name isn't its own alias
    expect((await updateCompany(db, c.id, { name: "Bask" })).aliases).toEqual(["bask health"]);
  });

  it("closes the old board's jobs when a company moves to another ATS", async () => {
    const { db } = database;
    const at = new Date("2026-11-20T12:00:00Z");
    const c = await createCompany(db, { ...base, name: "Movers", slug: "movers" });
    const job = (id: string) => ({
      id,
      companyId: c.id,
      companyName: "Movers",
      title: "Software Engineer",
      url: `https://jobs.lever.co/movers/${id}`,
      primarySource: "lever",
      firstSeenAt: at,
      effectiveAt: at,
    });
    const row = (jobId: string, source: string) => ({
      source,
      sourceJobId: `${source}-${jobId}`,
      jobId,
      url: `https://x.test/${jobId}`,
      title: "Software Engineer",
      postedAt: at,
      postedAtPrecision: "instant",
    });
    await db.insert(jobs).values([job("lv:board-only"), job("lv:also-listed")]);
    await db
      .insert(jobSources)
      .values([
        row("lv:board-only", "lever"),
        row("lv:also-listed", "lever"),
        row("lv:also-listed", "simplify"),
      ]);
    await updateCompany(db, c.id, { ats: "greenhouse", slug: "movers" });
    const closed = await db
      .select({ id: jobs.id, closedAt: jobs.closedAt })
      .from(jobs)
      .where(eq(jobs.companyId, c.id));
    expect(Object.fromEntries(closed.map((j) => [j.id, j.closedAt !== null]))).toEqual({
      "lv:board-only": true,
      "lv:also-listed": false,
    });
  });

  it("links list jobs already stored under the new company's name", async () => {
    const { db } = database;
    const at = new Date("2026-11-20T11:32:42Z");
    const job = (id: string, companyName: string) => ({
      id,
      companyId: null,
      companyName,
      title: "Software Engineer New Grad",
      url: `https://example.test/${id}`,
      primarySource: "simplify",
      firstSeenAt: at,
      effectiveAt: at,
    });
    await db
      .insert(jobs)
      .values([
        job("sj:hw1", "Honeywell Aerospace"),
        job("sj:hw2", "honeywell aerospace"),
        job("sj:hw3", "The Honeywell Aerospace, Inc."),
        job("sj:hw4", "Honeywell Aerospace Systems"),
        job("sj:o", "Other Co"),
      ]);
    const c = await createCompany(db, {
      name: "Honeywell Aerospace",
      tier: "D",
      ats: "other",
      track: false,
      status: "manual_only",
    });
    const rows = await db.select({ id: jobs.id, companyId: jobs.companyId }).from(jobs);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.companyId]))).toMatchObject({
      "sj:hw1": c.id,
      "sj:hw2": c.id,
      "sj:hw3": c.id,
      "sj:hw4": null,
      "sj:o": null,
    });
  });
});
