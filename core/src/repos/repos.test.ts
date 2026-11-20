import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client";
import { jobs, sourceState, suggestions } from "../db/schema";
import { ConflictError, InvalidError } from "../errors";
import { createTestDatabase } from "../testing/db";
import {
  companyStateKey,
  createCompany,
  deleteCompany,
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
  const base = { tier: "Startup", track: true, ats: "lever", status: "ok" } as const;

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
      tier: "Startup",
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
        job("sj:o", "Other Co"),
      ]);
    const c = await createCompany(db, {
      name: "Honeywell Aerospace",
      tier: "Corporate",
      ats: "other",
      track: false,
      status: "manual_only",
    });
    const rows = await db.select({ id: jobs.id, companyId: jobs.companyId }).from(jobs);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.companyId]))).toMatchObject({
      "sj:hw1": c.id,
      "sj:hw2": c.id,
      "sj:o": null,
    });
  });
});
