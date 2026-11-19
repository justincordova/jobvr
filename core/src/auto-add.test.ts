import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTO_ADD_RETRY_MS, runAutoAddCompanies } from "./auto-add";
import type { Database } from "./db/client";
import { companies, settings, sourceState, suggestions } from "./db/schema";
import { createCompany } from "./repos/companies";
import { updateSettings } from "./repos/settings";
import type { Registry, SourceAdapter } from "./sources/types";
import { createTestDatabase, fakeHttp } from "./testing";

const NOW = new Date("2026-11-18T15:00:00Z");
const boards = new Map<string, number>();
/** Boards that don't answer (network error, 5xx). */
const down = new Set<string>();
const probed: string[] = [];

const greenhouse: SourceAdapter = {
  id: "greenhouse",
  label: "Greenhouse",
  kind: "ats",
  idPrefix: "gh",
  concurrency: 1,
  fetch: async () => ({ status: "not_modified" }),
  probe: async (slug) => {
    probed.push(slug);
    if (down.has(slug)) throw new Error("HTTP 503");
    const jobs = boards.get(slug);
    return jobs === undefined ? { found: false, jobCount: 0 } : { found: true, jobCount: jobs };
  },
};
const simplify: SourceAdapter = {
  id: "simplify",
  label: "SimplifyJobs",
  kind: "aggregator",
  idPrefix: "sj",
  concurrency: 1,
  fetch: async () => ({ status: "not_modified" }),
};
const registry: Registry = [greenhouse, simplify];
const { http } = fakeHttp({});

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  boards.clear();
  down.clear();
  probed.length = 0;
  await database.db.delete(suggestions);
  await database.db.delete(sourceState);
  await database.db.delete(companies);
  await database.db.delete(settings);
});

const suggest = (id: string, ats: string, slug: string | null, state = "open", count = 2) =>
  database.db.insert(suggestions).values({
    id,
    displayName: id[0]?.toUpperCase() + id.slice(1),
    ats,
    slug,
    listingCount: count,
    listingCounts: { simplify: count },
    state,
  });

const run = (failures = new Map<string, number>(), now = NOW) =>
  runAutoAddCompanies({ database, registry, http, now: () => now, failures });

describe("runAutoAddCompanies", () => {
  it("adds list companies whose board answers with jobs, tracked as Startup", async () => {
    boards.set("initech", 12);
    await suggest("initech", "greenhouse", "initech");
    await database.db
      .insert(sourceState)
      .values({ key: "simplify", source: "simplify", etag: '"v1"' });

    expect(await run()).toEqual({ added: ["Initech"], failed: [] });
    const [company] = await database.db.select().from(companies);
    expect(company).toMatchObject({
      name: "Initech",
      tier: "Startup",
      ats: "greenhouse",
      slug: "initech",
      track: true,
      status: "ok",
    });
    expect(company?.notes).toMatch(/from SimplifyJobs .*12 jobs/);
    expect((await database.db.select().from(suggestions))[0]?.state).toBe("added");
    // The list refetches in full next poll, so its jobs find the new company
    expect((await database.db.select().from(sourceState))[0]?.etag).toBeNull();
  });

  it("keeps list-only companies for their jobs, and skips dismissed ones and known ones", async () => {
    await createCompany(database.db, {
      name: "Kira Learning",
      tier: "Mid",
      track: true,
      ats: "greenhouse",
      slug: "kira",
      status: "ok",
    });
    await suggest("hooli", "other", null);
    await suggest("acme", "greenhouse", null);
    await suggest("globex", "greenhouse", "globex", "dismissed");
    // Jobright's "Kira" is Kira Learning (board "kira"), not a new company
    await suggest("kira", "other", null);
    expect(await run()).toEqual({ added: ["Acme", "Hooli"], failed: [] });
    expect(probed).toEqual([]);
    const rows = await database.db.select().from(companies);
    expect(rows.find((c) => c.name === "Hooli")).toMatchObject({
      ats: "other",
      status: "manual_only",
      track: false,
      tierSource: "pending",
    });
    const states = Object.fromEntries(
      (await database.db.select().from(suggestions)).map((s) => [s.id, s.state]),
    );
    expect(states).toMatchObject({ kira: "added", globex: "dismissed" });
    expect(rows.map((c) => c.name).sort()).toEqual(["Acme", "Hooli", "Kira Learning"]);
  });

  it("waits on switched-off sources and when adding is off", async () => {
    boards.set("umbrella", 4);
    await suggest("umbrella", "greenhouse", "umbrella");
    await updateSettings(database.db, { disabledSources: ["greenhouse"] });
    expect((await run()).added).toEqual([]);
    await updateSettings(database.db, { disabledSources: [], suggestCompanies: false });
    expect((await run()).added).toEqual([]);
    expect(probed).toEqual([]);
  });

  it("keeps an empty board for its list jobs, and retries one that didn't answer after a day", async () => {
    boards.set("empty", 0);
    down.add("gone");
    await suggest("empty", "greenhouse", "empty");
    await suggest("gone", "greenhouse", "gone");
    const failures = new Map<string, number>();

    expect(await run(failures)).toEqual({ added: ["Empty"], failed: ["Gone"] });
    const [empty] = await database.db.select().from(companies);
    expect(empty).toMatchObject({ ats: "other", status: "manual_only" });
    expect(await run(failures, new Date(NOW.getTime() + 60_000))).toEqual({
      added: [],
      failed: [],
    });
    down.clear();
    boards.set("gone", 5);
    const later = new Date(NOW.getTime() + AUTO_ADD_RETRY_MS);
    expect(await run(failures, later)).toEqual({ added: ["Gone"], failed: [] });
  });
});
