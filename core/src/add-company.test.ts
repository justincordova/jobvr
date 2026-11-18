import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCompanyFrom } from "./add-company";
import type { Database } from "./db/client";
import { companies, settings, sourceState } from "./db/schema";
import { ConflictError, InvalidError } from "./errors";
import { HEAL_GIVE_UP_MS, HEAL_RETRY_MS, runHealCompanies } from "./heal-companies";
import { createCompany } from "./repos/companies";
import type { Registry, SourceAdapter } from "./sources/types";
import { createTestDatabase, fakeHttp } from "./testing";

const NOW = new Date("2026-11-18T15:00:00Z");
const boards = new Map<string, number>();
const greenhouse: SourceAdapter = {
  id: "greenhouse",
  label: "Greenhouse",
  kind: "ats",
  idPrefix: "gh",
  concurrency: 1,
  fetch: async () => ({ status: "not_modified" }),
  boardSlug: (url) =>
    url.startsWith("https://boards.greenhouse.io/") ? (url.split("/")[3] ?? null) : null,
  probe: async (slug) => {
    const n = boards.get(slug);
    return n === undefined ? { found: false, jobCount: 0 } : { found: true, jobCount: n };
  },
};
const registry: Registry = [greenhouse];
const { http } = fakeHttp({});

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());
beforeEach(async () => {
  boards.clear();
  await database.db.delete(sourceState);
  await database.db.delete(companies);
  await database.db.delete(settings);
});

const add = (input: string) => addCompanyFrom(input, { database, registry, http });

describe("addCompanyFrom", () => {
  it("adds from a board link, tracked, waiting for a tier", async () => {
    boards.set("blue-matrix", 4);
    const { company, board } = await add("https://boards.greenhouse.io/blue-matrix");
    expect(board).toBe(true);
    expect(company).toMatchObject({
      name: "Blue Matrix",
      ats: "greenhouse",
      slug: "blue-matrix",
      track: true,
      status: "ok",
      tier: "Startup",
      tierSource: "pending",
    });
  });

  it("finds the board from a name, or keeps the company for the lists without one", async () => {
    boards.set("initech", 7);
    expect((await add("Initech")).company).toMatchObject({ ats: "greenhouse", slug: "initech" });

    const { company, board } = await add("careers.globex.com/jobs");
    expect(board).toBe(false);
    expect(company).toMatchObject({
      name: "Globex",
      ats: "other",
      status: "manual_only",
      track: false,
      careersUrl: "https://careers.globex.com/jobs",
    });
  });

  it("refuses duplicates, blanks and dead board links", async () => {
    boards.set("initech", 7);
    await add("Initech");
    await expect(add("initech")).rejects.toBeInstanceOf(ConflictError);
    await expect(add("  ")).rejects.toBeInstanceOf(InvalidError);
    await expect(add("https://boards.greenhouse.io/nope")).rejects.toThrow("doesn't exist");
  });
});

describe("runHealCompanies", () => {
  const broken = async (name: string, slug: string | null, updatedAt = NOW) => {
    const c = await createCompany(database.db, {
      name,
      tier: "Mid",
      track: Boolean(slug),
      ats: "greenhouse",
      slug,
      status: "needs_review",
    });
    await database.db.update(companies).set({ updatedAt }).where(eq(companies.id, c.id));
    return c;
  };
  const get = async (id: string) =>
    (await database.db.select().from(companies).where(eq(companies.id, id)))[0];

  it("moves a company to the board it moved to", async () => {
    const c = await broken("Initech", "initech-old");
    boards.set("initech", 5);
    const result = await runHealCompanies({ database, registry, http, now: () => NOW });
    expect(result).toEqual({ moved: ["Initech"], gaveUp: [] });
    expect(await get(c.id)).toMatchObject({ slug: "initech", status: "ok", track: true });
  });

  it("searches again later, and leaves it to the lists after 3 days", async () => {
    const c = await broken("Globex", "globex", new Date(NOW.getTime() - HEAL_GIVE_UP_MS + 1000));
    const attempts = new Map<string, number>();
    const run = (now: Date) =>
      runHealCompanies({ database, registry, http, now: () => now, attempts });
    expect(await run(NOW)).toEqual({ moved: [], gaveUp: [] });
    // Searched a minute ago: skipped
    expect(await run(new Date(NOW.getTime() + 60_000))).toEqual({ moved: [], gaveUp: [] });
    expect(await run(new Date(NOW.getTime() + HEAL_RETRY_MS))).toEqual({
      moved: [],
      gaveUp: ["Globex"],
    });
    expect(await get(c.id)).toMatchObject({ status: "manual_only", track: false });
  });
});
