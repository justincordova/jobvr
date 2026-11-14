import { schema } from "@jobvr/core";
import { testClient } from "hono/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app";
import { setupTestDeps } from "./helpers";

const ctx = setupTestDeps(beforeAll, afterAll);
let client: ReturnType<typeof testClient<ReturnType<typeof createApp>>>;
beforeAll(() => {
  client = testClient(createApp(ctx.deps));
});

const HOUR = 3_600_000;
const at = (hoursAgo: number) => new Date(ctx.clock.getTime() - hoursAgo * HOUR);

const insertJob = async (
  id: string,
  extra: Partial<typeof schema.jobs.$inferInsert> = {},
  source = {
    source: "greenhouse",
    title: "Software Engineer, New Grad",
    category: null as string | null,
  },
) => {
  const { db } = ctx.database;
  await db.insert(schema.jobs).values({
    id,
    companyName: "Acme",
    title: source.title,
    locations: ["New York, NY"],
    url: `https://example.com/jobs/${id}`,
    primarySource: source.source,
    firstSeenAt: at(1),
    effectiveAt: at(1),
    ...extra,
  });
  await db.insert(schema.jobSources).values({
    source: source.source,
    sourceJobId: id,
    jobId: id,
    url: `https://example.com/jobs/${id}`,
    title: source.title,
    category: source.category,
    postedAt: at(1),
    postedAtPrecision: "instant",
  });
};

beforeEach(async () => {
  const { db } = ctx.database;
  await db.delete(schema.jobs);
  await db.delete(schema.suggestions);
  await db.delete(schema.companies);
  await db.delete(schema.settings);
});

const body = async <T>(res: { json(): Promise<unknown> }) => (await res.json()) as T;

describe("jobs routes", () => {
  it("lists the feed newest first, applying V and filters", async () => {
    await insertJob("gh:1", { effectiveAt: at(2) });
    await insertJob("gh:2", { effectiveAt: at(1) });
    await insertJob("gh:3", { state: "hidden" });
    await insertJob("gh:4", { locations: ["Austin, TX"] });
    await insertJob("gh:5", { effectiveAt: at(100) });
    await insertJob(
      "sj:6",
      {},
      { source: "simplify", title: "Software Engineer", category: "Software" },
    );

    const res = await client.api.jobs.$get({ query: {} });
    expect(res.status).toBe(200);
    const data = await res.json();
    if (!data.success) throw new Error("expected success");
    // Default age is "all"; 3d drops the 100 h old job
    expect(data.data.jobs.map((j) => j.id)).toEqual(["gh:2", "sj:6", "gh:1", "gh:5"]);
    expect(data.data.jobs[0]).toMatchObject({ tier: "Unlisted", isNew: false, state: "new" });
    const recent = await body<{ data: { jobs: { id: string }[] } }>(
      await client.api.jobs.$get({ query: { age: "3d" } }),
    );
    expect(recent.data.jobs.map((j) => j.id)).toEqual(["gh:2", "sj:6", "gh:1"]);

    const gh = await client.api.jobs.$get({ query: { source: "greenhouse", age: "1h" } });
    const ghData = await gh.json();
    if (!ghData.success) throw new Error("expected success");
    expect(ghData.data.jobs.map((j) => j.id)).toEqual(["gh:2"]);

    const hidden = await body<{ data: { jobs: { id: string }[] } }>(
      await client.api.jobs.$get({ query: { view: "hidden" } }),
    );
    expect(hidden.data.jobs.map((j) => j.id)).toEqual(["gh:3"]);

    const bad = await client.api.jobs.$get({ query: { tier: "Z" as "S" } });
    expect(bad.status).toBe(400);
  });

  it("counts new jobs since the last visit", async () => {
    await client.api.jobs.visit.$post();
    ctx.clock = new Date(ctx.clock.getTime() + HOUR);
    await insertJob("gh:new", { firstSeenAt: ctx.clock, effectiveAt: ctx.clock });
    await insertJob("gh:base", { firstSeenAt: ctx.clock, effectiveAt: ctx.clock, baseline: true });
    const res = await body<{
      data: { newSinceLastVisit: number; jobs: { id: string; isNew: boolean }[] };
    }>(await client.api.jobs.$get({ query: {} }));
    expect(res.data.newSinceLastVisit).toBe(1);
    expect(res.data.jobs.find((j) => j.id === "gh:new")?.isNew).toBe(true);
    expect(res.data.jobs.find((j) => j.id === "gh:base")?.isNew).toBe(false);
  });

  it("saves, hides, marks applied, and moves a job back", async () => {
    await insertJob("gh:1");
    const param = { id: "gh:1" };
    expect((await client.api.jobs[":id"].$patch({ param, json: { state: "saved" } })).status).toBe(
      200,
    );
    expect(
      (await client.api.jobs[":id"].$patch({ param: { id: "gh:nope" }, json: { state: "saved" } }))
        .status,
    ).toBe(404);

    expect(
      (await client.api.jobs[":id"].$patch({ param, json: { state: "applied" } })).status,
    ).toBe(200);
    const appliedView = await body<{ data: { jobs: { id: string }[] } }>(
      await client.api.jobs.$get({ query: { view: "applied" } }),
    );
    expect(appliedView.data.jobs.map((j) => j.id)).toEqual(["gh:1"]);
    const feedWhileApplied = await body<{ data: { jobs: unknown[] } }>(
      await client.api.jobs.$get({ query: {} }),
    );
    expect(feedWhileApplied.data.jobs).toEqual([]);

    await client.api.jobs[":id"].$patch({ param, json: { state: "new" } });
    const feed = await body<{ data: { jobs: { id: string; state: string }[] } }>(
      await client.api.jobs.$get({ query: {} }),
    );
    expect(feed.data.jobs[0]).toMatchObject({ id: "gh:1", state: "new" });
  });
});

describe("companies routes", () => {
  it("creates with defaults, rejects duplicates and bad ATS, and resets health on slug change", async () => {
    const res = await client.api.companies.$post({
      json: { name: "Acme", tier: "Startup", ats: "lever", slug: "Acme" },
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    if (!created.success) throw new Error("expected success");
    expect(created.data).toMatchObject({ track: true, status: "ok", health: null });

    const other = await client.api.companies.$post({
      json: { name: "Big Corp", tier: "Corporate", ats: "other" },
    });
    expect(await other.json()).toMatchObject({ data: { status: "manual_only", track: false } });

    const dup = await client.api.companies.$post({
      json: { name: "ACME Inc.", tier: "Mid", ats: "lever", slug: "x" },
    });
    expect(dup.status).toBe(409);
    const badAts = await client.api.companies.$post({
      json: { name: "Z", tier: "Mid", ats: "workday" },
    });
    expect(badAts.status).toBe(400);
    const badInvariant = await client.api.companies[":id"].$patch({
      param: { id: created.data.id },
      json: { ats: "other" },
    });
    expect(badInvariant.status).toBe(400);

    const patched = await client.api.companies[":id"].$patch({
      param: { id: created.data.id },
      json: { tier: "Mid", notes: "Great team" },
    });
    expect(await patched.json()).toMatchObject({ data: { tier: "Mid", notes: "Great team" } });

    expect(
      (await client.api.companies[":id"].$delete({ param: { id: created.data.id } })).status,
    ).toBe(200);
    expect(
      (await client.api.companies[":id"].$delete({ param: { id: created.data.id } })).status,
    ).toBe(404);
  });
});

describe("suggestions routes", () => {
  it("adds (tracked when the slug is known) and dismisses", async () => {
    const { db } = ctx.database;
    await db.insert(schema.suggestions).values([
      {
        id: "globex",
        displayName: "Globex",
        ats: "ashby",
        slug: "globex",
        listingCount: 3,
        sampleTitles: ["SWE"],
      },
      {
        id: "initech",
        displayName: "Initech",
        ats: "greenhouse",
        slug: null,
        listingCount: 5,
        sampleTitles: [],
      },
      { id: "hooli", displayName: "Hooli", ats: "other", listingCount: 1, sampleTitles: [] },
      { id: "gone", displayName: "Gone", ats: "other", listingCount: 0, sampleTitles: [] },
    ]);
    const list = await body<{ data: { id: string }[] }>(await client.api.suggestions.$get());
    expect(list.data.map((s) => s.id)).toEqual(["initech", "globex", "hooli"]);

    const add = await client.api.suggestions[":id"].add.$post({
      param: { id: "globex" },
      json: { tier: "Mid" },
    });
    expect(add.status).toBe(201);
    expect(await add.json()).toMatchObject({
      data: { name: "Globex", tier: "Mid", track: true, status: "ok" },
    });
    const noSlug = await client.api.suggestions[":id"].add.$post({
      param: { id: "initech" },
      json: {},
    });
    expect(await noSlug.json()).toMatchObject({
      data: { track: false, status: "needs_review", tier: "Startup" },
    });
    expect(
      (await client.api.suggestions[":id"].add.$post({ param: { id: "globex" }, json: {} })).status,
    ).toBe(409);

    expect(
      (await client.api.suggestions[":id"].dismiss.$post({ param: { id: "hooli" } })).status,
    ).toBe(200);
    expect(
      (await body<{ data: unknown[] }>(await client.api.suggestions.$get())).data,
    ).toHaveLength(0);
  });
});

describe("settings routes", () => {
  it("returns settings with sources and validates patches", async () => {
    const res = await client.api.settings.$get();
    const data = await res.json();
    if (!data.success) throw new Error("expected success");
    expect(data.data.sources.map((s) => s.id)).toEqual([
      "greenhouse",
      "lever",
      "ashby",
      "simplify",
    ]);
    expect(data.data.sourceHealth).toEqual([
      expect.objectContaining({
        source: "simplify",
        label: "SimplifyJobs",
        consecutiveFailures: 0,
      }),
    ]);

    const patched = await client.api.settings.$patch({
      json: { maxJobAgeHours: 48, enabledSources: ["simplify"] },
    });
    expect(await patched.json()).toMatchObject({
      data: { settings: { maxJobAgeHours: 48, enabledSources: ["simplify"] } },
    });

    expect(
      (await client.api.settings.$patch({ json: { enabledSources: ["workday"] } })).status,
    ).toBe(400);
    expect((await client.api.settings.$patch({ json: { maxJobAgeHours: 0 } })).status).toBe(400);
    expect((await client.api.settings.$patch({ json: {} })).status).toBe(400);
  });
});
