import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTO_ADD_RETRY_MS, runAutoAddCompanies } from "./auto-add";
import type { Database } from "./db/client";
import { companies, settings, sourceState, suggestions } from "./db/schema";
import { updateSettings } from "./repos/settings";
import type { Registry, SourceAdapter } from "./sources/types";
import { createTestDatabase, fakeHttp } from "./testing";

const NOW = new Date("2026-11-18T15:00:00Z");
const boards = new Map<string, number>();
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
    const jobs = boards.get(slug);
    if (jobs === undefined) throw new Error("HTTP 404");
    return { found: true, jobCount: jobs };
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

  it("skips unsupported boards, missing slugs, dismissed ones, and disabled sources", async () => {
    boards.set("globex", 3);
    await suggest("hooli", "other", null);
    await suggest("acme", "greenhouse", null);
    await suggest("globex", "greenhouse", "globex", "dismissed");
    expect(await run()).toEqual({ added: [], failed: [] });
    expect(probed).toEqual([]);

    await suggest("umbrella", "greenhouse", "umbrella");
    boards.set("umbrella", 4);
    await updateSettings(database.db, { disabledSources: ["greenhouse"] });
    expect((await run()).added).toEqual([]);
    await updateSettings(database.db, { disabledSources: [], suggestCompanies: false });
    expect((await run()).added).toEqual([]);
    expect(probed).toEqual([]);
  });

  it("retries a board that failed or had no jobs only after a day", async () => {
    boards.set("empty", 0);
    await suggest("empty", "greenhouse", "empty");
    await suggest("gone", "greenhouse", "gone");
    const failures = new Map<string, number>();

    expect(await run(failures)).toEqual({ added: [], failed: ["Empty", "Gone"] });
    expect(await run(failures, new Date(NOW.getTime() + 60_000))).toEqual({
      added: [],
      failed: [],
    });
    boards.set("empty", 5);
    const later = new Date(NOW.getTime() + AUTO_ADD_RETRY_MS);
    expect(await run(failures, later)).toEqual({ added: ["Empty"], failed: ["Gone"] });
  });
});
