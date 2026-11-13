import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client";
import { sourceState } from "../db/schema";
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
});
