import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCompanyFrom } from "./add-company";
import type { Database } from "./db/client";
import { companies, jobSources, jobs, settings, sourceState } from "./db/schema";
import { ConflictError, InvalidError } from "./errors";
import {
  HEAL_GIVE_UP_MS,
  HEAL_RETRY_MS,
  runFindListBoards,
  runHealCompanies,
} from "./heal-companies";
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
  parseUrl: (url) => {
    const m = /^https:\/\/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)$/.exec(url);
    return m?.[1] && m[2] ? { slug: m[1], sourceJobId: m[2] } : null;
  },
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
  await database.db.delete(jobs);
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
      tier: "C",
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
    await expect(add("x".repeat(201))).rejects.toThrow("at most 200 characters");
  });

  it("creates the company and links its stored list jobs together", async () => {
    await database.db.insert(jobs).values({
      id: "sj:1",
      companyName: "Globex Inc.",
      title: "Software Engineer",
      url: "https://example.com/1",
      primarySource: "simplify",
      firstSeenAt: NOW,
      effectiveAt: NOW,
    });
    const { company } = await add("Globex");
    const [job] = await database.db.select().from(jobs);
    expect(job).toMatchObject({ companyId: company.id, companyName: "Globex" });
  });
});

describe("runHealCompanies", () => {
  const broken = async (name: string, slug: string | null, since = NOW) => {
    const c = await createCompany(database.db, {
      name,
      tier: "B",
      track: Boolean(slug),
      ats: "greenhouse",
      slug,
      status: "needs_review",
    });
    await database.db
      .update(companies)
      .set({ needsReviewSince: since })
      .where(eq(companies.id, c.id));
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
    expect(await get(c.id)).toMatchObject({
      status: "manual_only",
      track: false,
      needsReviewSince: null,
    });
  });

  it("never gives up on the first search (after a restart), whatever the clock says", async () => {
    const c = await broken("Globex", "globex", new Date(NOW.getTime() - 5 * HEAL_GIVE_UP_MS));
    // Edited a minute ago: the clock is when it broke, not the last edit
    await database.db.update(companies).set({ updatedAt: NOW }).where(eq(companies.id, c.id));
    const attempts = new Map<string, number>();
    const run = (now: Date) =>
      runHealCompanies({ database, registry, http, now: () => now, attempts });
    expect(await run(NOW)).toEqual({ moved: [], gaveUp: [] });
    expect(await get(c.id)).toMatchObject({ status: "needs_review" });
    expect(await run(new Date(NOW.getTime() + HEAL_RETRY_MS))).toEqual({
      moved: [],
      gaveUp: ["Globex"],
    });
  });

  it("only moves to a board whose slug carries the company's name", async () => {
    const c = await broken("Scale AI", "scaleai-old");
    // "scale" is a guess from the shortened name: it can be another company's board
    boards.set("scale", 40);
    expect(await runHealCompanies({ database, registry, http, now: () => NOW })).toEqual({
      moved: [],
      gaveUp: [],
    });
    expect(await get(c.id)).toMatchObject({ slug: "scaleai-old", status: "needs_review" });
    boards.set("scale-ai", 3);
    expect(
      await runHealCompanies({
        database,
        registry,
        http,
        now: () => new Date(NOW.getTime() + HEAL_RETRY_MS),
      }),
    ).toEqual({ moved: ["Scale AI"], gaveUp: [] });
    expect(await get(c.id)).toMatchObject({ slug: "scale-ai", needsReviewSince: null });
  });

  it("stops at its time budget and when stopped", async () => {
    await broken("Initech", "initech-old");
    boards.set("initech", 5);
    expect(
      await runHealCompanies({ database, registry, http, now: () => NOW, budgetMs: 0 }),
    ).toEqual({ moved: [], gaveUp: [] });
    const stop = new AbortController();
    stop.abort();
    expect(
      await runHealCompanies({ database, registry, http, now: () => NOW, signal: stop.signal }),
    ).toEqual({ moved: [], gaveUp: [] });
  });
});

describe("runFindListBoards", () => {
  const listOnly = (name: string) =>
    createCompany(database.db, {
      name,
      tier: "C",
      track: false,
      ats: "other",
      slug: null,
      status: "manual_only",
    });
  const listJob = async (companyId: string, name: string, url: string) => {
    const id = `sj:${url}`;
    await database.db.insert(jobs).values({
      id,
      companyId,
      companyName: name,
      title: "Software Engineer",
      url,
      primarySource: "simplify",
      firstSeenAt: NOW,
      effectiveAt: NOW,
    });
    await database.db.insert(jobSources).values({
      source: "simplify",
      sourceJobId: url,
      jobId: id,
      url,
      title: "Software Engineer",
      postedAt: NOW,
      postedAtPrecision: "day",
    });
  };
  const get = async (id: string) =>
    (await database.db.select().from(companies).where(eq(companies.id, id)))[0];

  it("moves a list-only company to the board most of its list jobs link to", async () => {
    const c = await listOnly("Raydar");
    await listJob(c.id, "Raydar", "https://boards.greenhouse.io/raydar/jobs/1");
    await listJob(c.id, "Raydar", "https://boards.greenhouse.io/raydar/jobs/2");
    await listJob(c.id, "Raydar", "https://boards.greenhouse.io/raydar-old/jobs/3");
    await listJob(c.id, "Raydar", "https://raydar.com/careers/4");
    boards.set("raydar", 3);
    expect(await runFindListBoards({ database, registry, http, now: () => NOW })).toEqual({
      moved: ["Raydar"],
    });
    expect(await get(c.id)).toMatchObject({
      ats: "greenhouse",
      slug: "raydar",
      track: true,
      status: "ok",
    });
  });

  it("leaves it alone when the board has no jobs, and checks again a day later", async () => {
    const c = await listOnly("Ajaia");
    await listJob(c.id, "Ajaia", "https://boards.greenhouse.io/ajaia/jobs/1");
    const attempts = new Map<string, number>();
    const run = (now: Date) =>
      runFindListBoards({ database, registry, http, now: () => now, attempts });
    expect(await run(NOW)).toEqual({ moved: [] });
    boards.set("ajaia", 2);
    // Checked an hour ago: skipped
    expect(await run(new Date(NOW.getTime() + 3_600_000))).toEqual({ moved: [] });
    expect(await run(new Date(NOW.getTime() + 86_400_000))).toEqual({ moved: ["Ajaia"] });
  });

  it("skips boards on a source switched off in Settings", async () => {
    const c = await listOnly("Rokt");
    await listJob(c.id, "Rokt", "https://boards.greenhouse.io/rokt/jobs/1");
    boards.set("rokt", 9);
    await database.db.insert(settings).values({ id: 1, data: { disabledSources: ["greenhouse"] } });
    expect(await runFindListBoards({ database, registry, http, now: () => NOW })).toEqual({
      moved: [],
    });
    expect(await get(c.id)).toMatchObject({ ats: "other", status: "manual_only" });
  });
});
