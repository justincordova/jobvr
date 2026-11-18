import { schema } from "@jobvr/core";
import { eq } from "drizzle-orm";
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
  // Distinct roles by default ("gh:1" -> "... - Team gh1"); identical ones collapse into one row
  source = {
    source: "greenhouse",
    title: `Software Engineer, New Grad - Team ${id.replace(/\W/g, "")}`,
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
  it("lists the feed (newest first on request), applying V and filters", async () => {
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

    const res = await client.api.jobs.$get({ query: { sort: "newest" } });
    expect(res.status).toBe(200);
    const data = await res.json();
    if (!data.success) throw new Error("expected success");
    // Default age is "all"; 3d drops the 100 h old job
    expect(data.data.jobs.map((j) => j.id)).toEqual(["gh:2", "sj:6", "gh:1", "gh:5"]);
    expect(data.data.jobs[0]).toMatchObject({ tier: "Unlisted", isNew: false, state: "new" });
    expect(data.data.jobs[0]?.duplicateIds).toEqual([]);
    const recent = await body<{ data: { jobs: { id: string }[] } }>(
      await client.api.jobs.$get({ query: { age: "3d", sort: "newest" } }),
    );
    expect(recent.data.jobs.map((j) => j.id)).toEqual(["gh:2", "sj:6", "gh:1"]);
    const week = await body<{ data: { jobs: { id: string }[] } }>(
      await client.api.jobs.$get({ query: { age: "1w", sort: "newest" } }),
    );
    expect(week.data.jobs.map((j) => j.id)).toEqual(["gh:2", "sj:6", "gh:1", "gh:5"]);

    const gh = await client.api.jobs.$get({ query: { source: "greenhouse", age: "1h" } });
    const ghData = await gh.json();
    if (!ghData.success) throw new Error("expected success");
    expect(ghData.data.jobs.map((j) => j.id)).toEqual(["gh:2"]);

    // A plain board title isn't entry level; SimplifyJobs rows always are
    await insertJob(
      "gh:7",
      { effectiveAt: at(3), locations: ["Austin, TX", "New York, NY"] },
      {
        source: "greenhouse",
        title: "Software Engineer, Payments",
        category: null,
      },
    );
    const entry = await body<{ data: { jobs: { id: string; entryLevel: boolean }[] } }>(
      await client.api.jobs.$get({ query: { level: "entry", sort: "newest" } }),
    );
    expect(entry.data.jobs.map((j) => j.id)).toEqual(["gh:2", "sj:6", "gh:1", "gh:5"]);
    expect(entry.data.jobs.every((j) => j.entryLevel)).toBe(true);
    const everything = await body<{
      data: { jobs: { id: string; entryLevel: boolean; matchedLocations: string[] }[] };
    }>(await client.api.jobs.$get({ query: {} }));
    const plain = everything.data.jobs.find((j) => j.id === "gh:7");
    expect(plain?.entryLevel).toBe(false);
    // Only the location that matched a named location, so the feed can show it first
    expect(plain?.matchedLocations).toEqual(["New York, NY"]);

    const hidden = await body<{ data: { jobs: { id: string }[] } }>(
      await client.api.jobs.$get({ query: { view: "hidden" } }),
    );
    expect(hidden.data.jobs.map((j) => j.id)).toEqual(["gh:3"]);

    const bad = await client.api.jobs.$get({ query: { tier: "Z" as "S" } });
    expect(bad.status).toBe(400);
  });

  it("defaults the feed to the tracked tiers and, when set, to entry-level jobs", async () => {
    await insertJob("gh:grad");
    await insertJob(
      "gh:plain",
      {},
      { source: "greenhouse", title: "Software Engineer, Payments", category: null },
    );
    const ids = async (query: Record<string, string> = {}) =>
      (
        await body<{ data: { jobs: { id: string }[] } }>(
          await client.api.jobs.$get({ query: { sort: "newest", ...query } }),
        )
      ).data.jobs
        .map((j) => j.id)
        .sort();

    await client.api.settings.$patch({ json: { tiersToTrack: ["Mid", "Startup"] } });
    expect(await ids()).toEqual([]);
    // Picking a tier in Filters still shows it
    expect(await ids({ tier: "Unlisted" })).toEqual(["gh:grad", "gh:plain"]);

    await client.api.settings.$patch({
      json: { tiersToTrack: ["Unlisted"], entryLevelOnly: true },
    });
    expect(await ids()).toEqual(["gh:grad"]);
  });

  it("shows a role posted several times as one row (H2O.ai posted the same role 3 times)", async () => {
    const same = { source: "simplify", title: "Software Engineer", category: "Software" };
    await insertJob("sj:a", { effectiveAt: at(3) }, same);
    await insertJob("sj:b", { effectiveAt: at(1) }, same);
    await insertJob("sj:c", { effectiveAt: at(2) }, same);
    const res = await body<{ data: { jobs: { id: string; duplicateIds: string[] }[] } }>(
      await client.api.jobs.$get({ query: {} }),
    );
    expect(res.data.jobs.map((j) => [j.id, j.duplicateIds])).toEqual([["sj:b", ["sj:c", "sj:a"]]]);
  });

  it("ranks the feed best first by default (new-grad title over a fresher plain one)", async () => {
    await insertJob(
      "gh:plain",
      { effectiveAt: at(1) },
      {
        source: "greenhouse",
        title: "Software Engineer, Payments",
        category: null,
      },
    );
    await insertJob("gh:grad", { effectiveAt: at(30) });
    const best = await body<{ data: { jobs: { id: string; score: number }[] } }>(
      await client.api.jobs.$get({ query: {} }),
    );
    expect(best.data.jobs.map((j) => [j.id, j.score])).toEqual([
      ["gh:grad", 24 + 20 + 4],
      ["gh:plain", 30 + 4],
    ]);
    // Other views stay newest first
    const newest = await body<{ data: { jobs: { id: string }[] } }>(
      await client.api.jobs.$get({ query: { sort: "newest" } }),
    );
    expect(newest.data.jobs.map((j) => j.id)).toEqual(["gh:plain", "gh:grad"]);
  });

  it("searches title, company and places by word prefix, and pages with limit/total", async () => {
    await insertJob("gh:a", { companyName: "Stripe", title: "Backend Engineer, New Grad" });
    await insertJob("gh:b", { companyName: "Ramp", title: "Frontend Engineer, New Grad" });
    await insertJob("gh:c", {
      companyName: "Ramp",
      title: "Software Engineer, New Grad",
      locations: ["Philadelphia, PA"],
    });
    const ids = async (query: Record<string, string>) =>
      (
        await body<{ data: { jobs: { id: string }[]; total: number } }>(
          await client.api.jobs.$get({ query }),
        )
      ).data;
    expect((await ids({ q: "back" })).jobs.map((j) => j.id)).toEqual(["gh:a"]);
    expect((await ids({ q: "ramp philly" })).jobs).toEqual([]);
    expect((await ids({ q: "ramp phil" })).jobs.map((j) => j.id)).toEqual(["gh:c"]);
    const page = await ids({ limit: "2", sort: "newest" });
    expect(page.jobs).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  it("returns a job's description and key lines; 404 for an unknown job", async () => {
    await insertJob("gh:d");
    await ctx.database.db
      .update(schema.jobSources)
      .set({
        description:
          "Great team.\nBachelor's degree in Computer Science required.\nHybrid in our NYC office.",
      })
      .where(eq(schema.jobSources.jobId, "gh:d"));
    const res = await client.api.jobs[":id"].details.$get({ param: { id: "gh:d" } });
    expect(await res.json()).toMatchObject({
      data: {
        source: "greenhouse",
        keyLines: [
          { topic: "degree", text: "Bachelor's degree in Computer Science required." },
          { topic: "workplace", text: "Hybrid in our NYC office." },
        ],
      },
    });
    expect((await client.api.jobs[":id"].details.$get({ param: { id: "gh:none" } })).status).toBe(
      404,
    );
  });

  it("reports each company's recent roles", async () => {
    const res = await client.api.companies.$post({
      json: { name: "Acme", tier: "Startup", ats: "lever", slug: "acme" },
    });
    const acme = await res.json();
    if (!acme.success) throw new Error("expected success");
    await insertJob("gh:r1", { companyId: acme.data.id, effectiveAt: at(24) });
    await insertJob("gh:r2", { companyId: acme.data.id, effectiveAt: at(40 * 24) });
    const list = await body<{ data: { name: string; stats: unknown }[] }>(
      await client.api.companies.$get(),
    );
    expect(list.data.find((c) => c.name === "Acme")?.stats).toEqual({
      roles30d: 1,
      lastRoleAt: at(24).toISOString(),
    });
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

    // The banner's jobs come back even when the filters hide them from the list
    const filtered = await body<{
      data: { newSinceLastVisit: number; jobs: unknown[]; newJobs: { id: string }[] };
    }>(await client.api.jobs.$get({ query: { q: "no such role" } }));
    expect(filtered.data.jobs).toHaveLength(0);
    expect(filtered.data.newJobs.map((j) => j.id)).toEqual(["gh:new"]);
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
    const appliedView = await body<{ data: { jobs: { id: string; appliedAt: string }[] } }>(
      await client.api.jobs.$get({ query: { view: "applied" } }),
    );
    expect(appliedView.data.jobs.map((j) => [j.id, j.appliedAt])).toEqual([
      ["gh:1", ctx.clock.toISOString()],
    ]);
    const feedWhileApplied = await body<{ data: { jobs: unknown[] } }>(
      await client.api.jobs.$get({ query: {} }),
    );
    expect(feedWhileApplied.data.jobs).toEqual([]);

    await client.api.jobs[":id"].$patch({ param, json: { state: "new" } });
    const feed = await body<{ data: { jobs: { id: string; state: string }[] } }>(
      await client.api.jobs.$get({ query: {} }),
    );
    expect(feed.data.jobs[0]).toMatchObject({ id: "gh:1", state: "new", appliedAt: null });
  });

  it("lists applied jobs latest applied first, keeping the date on a repeat", async () => {
    await insertJob("gh:old", { effectiveAt: at(48) });
    await insertJob("gh:fresh");
    const apply = (id: string) =>
      client.api.jobs[":id"].$patch({ param: { id }, json: { state: "applied" } });
    const first = ctx.clock;
    await apply("gh:fresh");
    ctx.clock = new Date(first.getTime() + HOUR);
    await apply("gh:old");
    ctx.clock = new Date(first.getTime() + 2 * HOUR);
    // Marking an applied job applied again (a repost) keeps its date
    await apply("gh:fresh");
    const list = async (sort?: "newest") =>
      (
        await body<{ data: { jobs: { id: string; appliedAt: string }[] } }>(
          await client.api.jobs.$get({ query: { view: "applied", sort } }),
        )
      ).data.jobs.map((j) => [j.id, j.appliedAt]);
    expect(await list()).toEqual([
      ["gh:old", new Date(first.getTime() + HOUR).toISOString()],
      ["gh:fresh", first.toISOString()],
    ]);
    expect((await list("newest")).map(([id]) => id)).toEqual(["gh:fresh", "gh:old"]);
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

    // Top tiers are tracked too (they used to default to untracked)
    const top = await client.api.companies.$post({
      json: { name: "Stripe", tier: "S", ats: "greenhouse", slug: "stripe" },
    });
    expect(await top.json()).toMatchObject({ data: { track: true, status: "ok" } });

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
    const badUrl = await client.api.companies.$post({
      json: { name: "Y", tier: "Mid", ats: "lever", slug: "y", careersUrl: "javascript:alert(1)" },
    });
    // The message names the field instead of only "Request validation failed"
    expect(await badUrl.json()).toMatchObject({ message: "careers URL: Invalid URL" });
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

  it("adds from one line, rates the tier, keeps a picked tier and can hand it back", async () => {
    const rated: string[] = [];
    ctx.deps.tierRater = {
      model: "test-model",
      rate: async ({ name }) => {
        rated.push(name);
        return { tier: "A", reason: "Well-known payments company" };
      },
    };
    try {
      const res = await client.api.companies.add.$post({ json: { query: "Globodyne" } });
      expect(res.status).toBe(201);
      const added = await res.json();
      if (!added.success) throw new Error("expected success");
      // No network in tests, so no board is found: its jobs come from the lists
      expect(added).toMatchObject({
        data: {
          name: "Globodyne",
          ats: "other",
          status: "manual_only",
          tier: "A",
          tierSource: "auto",
          tierReason: "Well-known payments company",
        },
        message: expect.stringContaining("no job board found"),
      });
      expect((await client.api.companies.add.$post({ json: { query: "globodyne" } })).status).toBe(
        409,
      );

      const id = added.data.id;
      const picked = await client.api.companies[":id"].$patch({
        param: { id },
        json: { tier: "Mid" },
      });
      expect(await picked.json()).toMatchObject({
        data: { tier: "Mid", tierSource: "manual", tierReason: null },
      });
      const handedBack = await client.api.companies[":id"].$patch({
        param: { id },
        json: { autoTier: true },
      });
      expect(await handedBack.json()).toMatchObject({ data: { tier: "A", tierSource: "auto" } });
      expect(rated).toEqual(["Globodyne", "Globodyne"]);

      const both = await client.api.companies[":id"].$patch({
        param: { id },
        json: { tier: "S", autoTier: true },
      });
      expect(both.status).toBe(400);
      const settings = await body<{ data: { tierModel: string | null } }>(
        await client.api.settings.$get(),
      );
      expect(settings.data.tierModel).toBe("test-model");
    } finally {
      ctx.deps.tierRater = null;
    }
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
      "speedyapply",
      "jobright",
    ]);
    // One health entry per new-grad list
    expect(data.data.sourceHealth).toEqual([
      expect.objectContaining({
        source: "simplify",
        label: "SimplifyJobs",
        consecutiveFailures: 0,
      }),
      expect.objectContaining({ source: "speedyapply", label: "SpeedyApply" }),
      expect.objectContaining({ source: "jobright", label: "Jobright" }),
    ]);

    const patched = await client.api.settings.$patch({
      json: { maxJobAgeHours: 48, disabledSources: ["lever"] },
    });
    expect(await patched.json()).toMatchObject({
      data: { settings: { maxJobAgeHours: 48, disabledSources: ["lever"] } },
    });

    expect(
      (await client.api.settings.$patch({ json: { disabledSources: ["workday"] } })).status,
    ).toBe(400);
    expect((await client.api.settings.$patch({ json: { maxJobAgeHours: 0 } })).status).toBe(400);
    expect((await client.api.settings.$patch({ json: {} })).status).toBe(400);
  });
});
