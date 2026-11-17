import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client";
import { companies, jobSources, jobs, sourceState, suggestions } from "../db/schema";
import { HttpError } from "../http";
import { createConsoleLogger, type Logger } from "../logger";
import { companyStateKey, createCompany, updateCompany } from "../repos/companies";
import { listJobs } from "../repos/jobs";
import { getSettingsState, updateSettings } from "../repos/settings";
import type {
  FetchCtx,
  FetchResult,
  JobDetail,
  Registry,
  SourceAdapter,
  SourceJob,
} from "../sources/types";
import { createTestDatabase } from "../testing/db";
import { runPoll } from "./run-poll";

const T0 = new Date("2026-11-12T15:00:00Z");
const HOUR = 3_600_000;

/** Fake ATS ("greenhouse", prefix gh) whose boards live at boards.test/{slug}/jobs/{id}. */
const makeEnv = () => {
  const boards = new Map<string, SourceJob[]>();
  const etags = new Map<string, string>();
  const failing = new Set<string>();
  const calls: { slug?: string; etag?: string | null }[] = [];
  const details = new Map<string, JobDetail>();
  const detailCalls: string[] = [];
  const detailFailing = new Set<string>();
  let simplify: SourceJob[] = [];
  let onFetch: ((ctx: FetchCtx) => Promise<void>) | null = null;

  const ats: SourceAdapter = {
    id: "greenhouse",
    label: "Greenhouse",
    kind: "ats",
    idPrefix: "gh",
    concurrency: 2,
    async fetch(ctx): Promise<FetchResult> {
      calls.push({ slug: ctx.slug, etag: ctx.etag });
      await onFetch?.(ctx);
      const slug = ctx.slug ?? "";
      if (failing.has(slug)) throw new HttpError("HTTP 500", 500);
      const list = boards.get(slug);
      if (!list) throw new HttpError("HTTP 404", 404);
      const tag = etags.get(slug) ?? `"${slug}-${JSON.stringify(list).length}"`;
      if (ctx.etag === tag) return { status: "not_modified" };
      return {
        status: "ok",
        etag: tag,
        jobs: list.map((j) => ({ ...j, companyName: ctx.companyName ?? slug })),
        invalidCount: 0,
      };
    },
    async fetchDetail(_slug, id) {
      detailCalls.push(id);
      if (detailFailing.has(id)) throw new HttpError("HTTP 503", 503);
      return details.get(id) ?? { description: "Build things with us." };
    },
    parseUrl(url) {
      const m = /^https:\/\/boards\.test\/([^/]+)\/jobs\/(\d+)$/.exec(url);
      return m?.[1] && m[2] ? { slug: m[1], sourceJobId: m[2] } : null;
    },
  };
  const agg: SourceAdapter = {
    id: "simplify",
    label: "SimplifyJobs",
    kind: "aggregator",
    idPrefix: "sj",
    concurrency: 1,
    async fetch() {
      return { status: "ok", etag: null, jobs: simplify, invalidCount: 0 };
    },
  };
  const registry: Registry = [ats, agg];
  return {
    registry,
    boards,
    failing,
    calls,
    details,
    detailCalls,
    detailFailing,
    setSimplify: (l: SourceJob[]) => {
      simplify = l;
    },
    setOnFetch: (f: typeof onFetch) => {
      onFetch = f;
    },
  };
};

const ghJob = (
  slug: string,
  id: string,
  title: string,
  extra: Partial<SourceJob> = {},
): SourceJob => ({
  source: "greenhouse",
  sourceJobId: id,
  companyName: slug,
  companySlug: slug,
  title,
  locations: ["New York, NY"],
  url: `https://boards.test/${slug}/jobs/${id}`,
  postedAt: new Date(T0.getTime() - HOUR),
  postedAtPrecision: "instant",
  ...extra,
});

const sjJob = (
  id: string,
  company: string,
  title: string,
  url: string,
  extra: Partial<SourceJob> = {},
): SourceJob => ({
  source: "simplify",
  sourceJobId: id,
  companyName: company,
  title,
  locations: ["NYC"],
  url,
  postedAt: new Date("2026-11-12T00:00:00Z"),
  postedAtPrecision: "day",
  meta: { active: true, visible: true, category: "Software Engineering" },
  ...extra,
});

let database: Database;
let env: ReturnType<typeof makeEnv>;
let clock: Date;

const poll = (force = true, logger?: Logger) =>
  runPoll({
    database,
    registry: env.registry,
    http: { getJson: async () => ({ status: "not_modified" }) },
    force,
    now: () => clock,
    logger,
  });

const allJobs = () => database.db.select().from(jobs).orderBy(jobs.id);
const rowsOf = (jobId: string) =>
  database.db.select().from(jobSources).where(eq(jobSources.jobId, jobId));
const stateOf = async (key: string) =>
  (await database.db.select().from(sourceState).where(eq(sourceState.key, key)))[0];

const addAcme = (extra: { tier?: "Startup" | "S" } = {}) =>
  createCompany(database.db, {
    name: "Acme",
    tier: extra.tier ?? "Startup",
    track: true,
    ats: "greenhouse",
    slug: "acme",
    status: "ok",
  });

beforeEach(async () => {
  database = await createTestDatabase();
  env = makeEnv();
  clock = T0;
});
afterEach(() => database.close());

describe("runPoll: baseline, filters, ETags", () => {
  it("baselines a company's first poll, then stores later jobs as new", async () => {
    const acme = await addAcme();
    env.boards.set("acme", [
      ghJob("acme", "1", "Software Engineer, New Grad"),
      ghJob("acme", "2", "Senior Software Engineer"),
      ghJob("acme", "3", "Software Engineer, New Grad", { locations: ["San Francisco, CA"] }),
      ghJob("acme", "4", "Software Engineer", {
        postedAt: new Date(T0.getTime() - 31 * 24 * HOUR),
      }),
    ]);
    env.setSimplify([]);
    const first = await poll();
    expect(first.ran).toBe(true);

    let stored = await allJobs();
    expect(stored.map((j) => j.id)).toEqual(["gh:1"]);
    expect(stored[0]).toMatchObject({ baseline: true, companyId: acme.id, state: "new" });
    expect((await stateOf(companyStateKey(acme.id)))?.baselinedAt).toEqual(T0);

    clock = new Date(T0.getTime() + HOUR);
    env.boards.get("acme")?.push(ghJob("acme", "5", "Junior Backend Developer"));
    await poll();
    stored = await allJobs();
    expect(stored.find((j) => j.id === "gh:5")).toMatchObject({ baseline: false });
    // effective_at = earlier of first seen and posted
    expect(stored.find((j) => j.id === "gh:5")?.effectiveAt).toEqual(new Date(T0.getTime() - HOUR));
  });

  it("sends the ETag only while filters are unchanged", async () => {
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    await poll();
    await poll();
    expect(env.calls[0]?.etag).toBeNull();
    expect(env.calls[1]?.etag).toMatch(/^"acme-/);
    await updateSettings(database.db, { excludeKeywords: ["senior"] });
    await poll();
    expect(env.calls[2]?.etag).toBeNull();
  });

  it("respects the due check unless forced", async () => {
    expect((await poll(false)).ran).toBe(true);
    clock = new Date(T0.getTime() + 5 * 60_000);
    expect(await poll(false)).toEqual({ ran: false, reason: "not_due" });
    clock = new Date(T0.getTime() + 14 * 60_000);
    expect((await poll(false)).ran).toBe(true);
    expect((await getSettingsState(database.db)).lastPollAt).toEqual(clock);
  });

  it("doesn't poll companies whose tier isn't tracked", async () => {
    await updateSettings(database.db, {
      tiersToTrack: ["Mid", "Startup", "Corporate", "Unlisted"],
    });
    await addAcme({ tier: "S" });
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    await poll();
    expect(env.calls).toHaveLength(0);
  });
});

describe("runPoll: job details and the experience rule", () => {
  it("fetches details once for matching listings, stores years and pay, and hides 3+ years", async () => {
    await addAcme();
    env.boards.set("acme", [
      ghJob("acme", "1", "Software Engineer, Frontend"),
      ghJob("acme", "2", "Software Engineer, New Grad"),
      ghJob("acme", "3", "Senior Software Engineer"),
      ghJob("acme", "4", "Software Engineer, Backend"),
    ]);
    env.details.set("1", {
      description: "What you need: 5 years of frontend engineering experience",
      salary: { currency: "USD", interval: "year", min: 150_000, max: 200_000 },
    });
    env.details.set("2", { description: "3+ years of experience is a plus" });
    env.details.set("4", { description: "2+ years of backend engineering experience" });
    await poll();
    // Only listings that pass the poll filter (not the Senior one)
    expect(env.detailCalls.sort()).toEqual(["1", "2", "4"]);
    expect((await rowsOf("gh:1"))[0]?.requiredYears).toBe(5);
    expect((await rowsOf("gh:4"))[0]?.requiredYears).toBe(2);
    expect((await allJobs()).find((j) => j.id === "gh:1")).toMatchObject({
      salaryMinUsd: 150_000,
      salaryMaxUsd: 200_000,
    });

    // Already checked: no new detail requests, years and pay are kept
    clock = new Date(T0.getTime() + HOUR);
    env.boards.get("acme")?.push(ghJob("acme", "5", "Software Engineer"));
    env.detailCalls.length = 0;
    await poll();
    expect(env.detailCalls).toEqual(["5"]);
    expect((await rowsOf("gh:1"))[0]?.requiredYears).toBe(5);
    expect((await rowsOf("gh:5"))[0]?.requiredYears).toBe(0);
    expect((await allJobs()).find((j) => j.id === "gh:1")?.salaryMaxUsd).toBe(200_000);

    // 5 years is hidden; the new-grad title stays despite "3+ years"
    const feed = await listJobs(database.db, env.registry, {}, clock);
    expect(feed.jobs.map((j) => j.id).sort()).toEqual(["gh:2", "gh:4", "gh:5"]);
    await updateSettings(database.db, { experienceCutoffYears: 0 });
    const all = await listJobs(database.db, env.registry, {}, clock);
    expect(all.jobs.map((j) => j.id)).toContain("gh:1");
  });

  it("retries a failed detail on the next poll instead of trusting the board's ETag", async () => {
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer")]);
    env.details.set("1", { description: "5+ years of experience required" });
    env.detailFailing.add("1");
    await poll();
    expect((await rowsOf("gh:1"))[0]?.requiredYears).toBeNull();

    // The board is unchanged, but without a saved ETag it isn't a 304
    env.detailFailing.clear();
    env.detailCalls.length = 0;
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    expect(env.detailCalls).toEqual(["1"]);
    expect((await rowsOf("gh:1"))[0]?.requiredYears).toBe(5);
    // Checked now: the ETag is kept and the next poll is a 304
    env.calls.length = 0;
    await poll(true);
    expect(env.calls[0]?.etag).toBeTruthy();
  });

  it("treats an empty description as unread, not as no experience required", async () => {
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer")]);
    env.details.set("1", { description: "  " });
    await poll();
    expect((await rowsOf("gh:1"))[0]?.requiredYears).toBeNull();
  });

  it("stores older jobs after the store window is widened (bypassing the ETag)", async () => {
    await addAcme();
    const old = ghJob("acme", "1", "Software Engineer", {
      postedAt: new Date(T0.getTime() - 45 * 24 * HOUR),
    });
    env.boards.set("acme", [old]);
    await poll();
    expect(await allJobs()).toEqual([]);
    await updateSettings(database.db, { storeWindowDays: 60 });
    await poll();
    expect(env.calls[1]?.etag).toBeNull();
    expect((await allJobs()).map((j) => j.id)).toEqual(["gh:1"]);
  });
});

describe("runPoll: dedupe", () => {
  it("merges a Simplify listing that points at the ATS posting (ATS wins)", async () => {
    const acme = await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    await poll();
    clock = new Date(T0.getTime() + HOUR);
    env.setSimplify([
      sjJob("s1", "ACME Inc", "SWE New Grad (2026)", "https://boards.test/acme/jobs/1"),
    ]);
    await poll();

    const stored = await allJobs();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: "gh:1",
      title: "Software Engineer, New Grad",
      primarySource: "greenhouse",
      companyId: acme.id,
    });
    expect((await rowsOf("gh:1")).map((r) => r.source).sort()).toEqual(["greenhouse", "simplify"]);
  });

  it("an earlier Simplify-only gh: job adopts the ATS data when the company is added", async () => {
    env.setSimplify([sjJob("s1", "Acme", "Software Engineer", "https://boards.test/acme/jobs/9")]);
    await poll();
    let [job] = await allJobs();
    expect(job).toMatchObject({ id: "gh:9", companyId: null, primarySource: "simplify" });

    const acme = await addAcme();
    env.boards.set("acme", [ghJob("acme", "9", "Software Engineer, New Grad")]);
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    [job] = await allJobs();
    expect(job).toMatchObject({
      id: "gh:9",
      companyId: acme.id,
      title: "Software Engineer, New Grad",
      primarySource: "greenhouse",
    });
    expect(await rowsOf("gh:9")).toHaveLength(2);
  });

  it("fuzzy merges sj: listings with ATS jobs, and stays merged on later polls", async () => {
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    await poll();
    env.setSimplify([
      sjJob("s1", "Acme", "New Grad Software Engineer", "https://acme.com/careers/swe-ng"),
    ]);
    for (let i = 1; i <= 2; i++) {
      clock = new Date(T0.getTime() + i * HOUR);
      await poll();
      const stored = await allJobs();
      expect(stored.map((j) => j.id)).toEqual(["gh:1"]);
      expect(await rowsOf("gh:1")).toHaveLength(2);
    }
  });

  it("never merges two distinct ATS postings", async () => {
    await addAcme();
    env.boards.set("acme", [
      ghJob("acme", "1", "Software Engineer, New Grad"),
      ghJob("acme", "2", "Software Engineer, New Grad"),
    ]);
    await poll();
    expect((await allJobs()).map((j) => j.id)).toEqual(["gh:1", "gh:2"]);
  });

  it("merges an ATS listing into an earlier sj: job (fuzzy) and keeps the sj: id", async () => {
    env.setSimplify([
      sjJob("s1", "Acme", "Software Engineer, New Grad", "https://acme.com/careers/ng"),
    ]);
    await poll();
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer - New Grad")]);
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    const stored = await allJobs();
    expect(stored.map((j) => j.id)).toEqual(["sj:s1"]);
    expect(stored[0]?.primarySource).toBe("greenhouse");
    // Later polls find it exactly through the job_sources row
    clock = new Date(T0.getTime() + 2 * HOUR);
    await poll();
    expect((await allJobs()).map((j) => j.id)).toEqual(["sj:s1"]);
  });

  it("never re-inserts a reposted listing whose job is older than the window", async () => {
    const old = new Date(T0.getTime() - 35 * 24 * HOUR);
    await database.db.insert(jobs).values({
      id: "sj:old",
      companyName: "Acme",
      title: "Software Engineer",
      url: "https://acme.com/careers/swe/1",
      primarySource: "simplify",
      firstSeenAt: old,
      effectiveAt: old,
      notifiedAt: old,
    });
    await database.db.insert(jobSources).values({
      source: "simplify",
      sourceJobId: "old",
      jobId: "sj:old",
      url: "https://acme.com/careers/swe/1",
      urlKey: "https://acme.com/careers/swe/1",
      title: "Software Engineer",
      postedAt: old,
      postedAtPrecision: "day",
    });
    env.setSimplify([
      sjJob("new-id", "Acme", "Software Engineer", "https://acme.com/careers/swe/1"),
    ]);
    await poll();
    expect((await allJobs()).map((j) => j.id)).toEqual(["sj:old"]);
  });
});

describe("runPoll: closures and user state", () => {
  it("closes jobs whose every source is gone and reopens them", async () => {
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    await poll();
    env.boards.set("acme", []);
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    let [job] = await allJobs();
    expect(job?.closedAt).toEqual(clock);
    expect((await rowsOf("gh:1"))[0]?.removedAt).toEqual(clock);

    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    clock = new Date(T0.getTime() + 2 * HOUR);
    await poll();
    [job] = await allJobs();
    expect(job?.closedAt).toBeNull();
    expect((await rowsOf("gh:1"))[0]?.removedAt).toBeNull();
  });

  it("keeps a merged job open while Simplify still lists it; inactive Simplify rows count as removed", async () => {
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    env.setSimplify([sjJob("s1", "Acme", "SWE", "https://boards.test/acme/jobs/1")]);
    await poll();
    env.boards.set("acme", []);
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    expect((await allJobs())[0]?.closedAt).toBeNull();

    env.setSimplify([
      sjJob("s1", "Acme", "SWE", "https://boards.test/acme/jobs/1", {
        meta: { active: false, visible: true, category: "Software" },
      }),
    ]);
    clock = new Date(T0.getTime() + 2 * HOUR);
    await poll();
    expect((await allJobs())[0]?.closedAt).toEqual(clock);
  });

  it("never overwrites user state", async () => {
    await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    await poll();
    await database.db.update(jobs).set({ state: "hidden" }).where(eq(jobs.id, "gh:1"));
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad (NYC)")]);
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    const [job] = await allJobs();
    expect(job).toMatchObject({ state: "hidden", title: "Software Engineer, New Grad (NYC)" });
  });
});

describe("runPoll: health and transactions", () => {
  it("counts failures, marks needs_review at 3, and recovers on success", async () => {
    const acme = await addAcme();
    env.failing.add("acme");
    for (let i = 0; i < 3; i++) {
      clock = new Date(T0.getTime() + i * HOUR);
      await poll();
    }
    const key = companyStateKey(acme.id);
    expect(await stateOf(key)).toMatchObject({ consecutiveFailures: 3, baselinedAt: null });
    const [c] = await database.db.select().from(companies);
    expect(c?.status).toBe("needs_review");

    env.failing.clear();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    await poll();
    expect(await stateOf(key)).toMatchObject({ consecutiveFailures: 0, lastError: null });
    expect((await database.db.select().from(companies))[0]?.status).toBe("ok");
    // The first successful poll is still the baseline
    expect((await allJobs())[0]?.baseline).toBe(true);
  });

  it("logs what a failing board needs: name, streak, status, and the needs-review move", async () => {
    await addAcme();
    env.failing.add("acme");
    const lines: string[] = [];
    const logger = createConsoleLogger({
      level: "info",
      color: false,
      hide: ["target"],
      write: (line) => lines.push(line.slice(13)),
    });
    for (let i = 0; i < 3; i++) {
      clock = new Date(T0.getTime() + i * HOUR);
      await poll(true, logger);
    }
    const warnings = lines.filter((l) => l.startsWith("WARN"));
    expect(warnings[0]).toBe(
      "WARN  poll · Acme (Greenhouse) failed (1 in a row): HTTP 500  company=Acme ats=greenhouse slug=acme status=500",
    );
    expect(warnings).toContain(
      "WARN  poll · Acme (Greenhouse) · marked needs review after 3 failures in a row; check its slug on the Companies page  company=Acme ats=greenhouse slug=acme",
    );
    // The summary is a warning while anything failed
    expect(lines.at(-1)).toMatch(
      /^WARN {2}poll · poll finished in \d+ ms · 2 targets: 1 unchanged, 1 failed · \+0 new, 0 refreshed, 0 closed/,
    );
  });

  it("treats every board of one ATS failing as an outage, not as broken boards", async () => {
    const slugs = ["a", "b", "c", "d", "e"];
    for (const slug of slugs) {
      await createCompany(database.db, {
        name: `Co ${slug}`,
        tier: "Startup",
        track: true,
        ats: "greenhouse",
        slug,
        status: "ok",
      });
      env.failing.add(slug);
    }
    const lines: string[] = [];
    const logger = createConsoleLogger({
      level: "info",
      color: false,
      write: (line) => lines.push(line.slice(13)),
    });
    for (let i = 0; i < 3; i++) {
      clock = new Date(T0.getTime() + i * HOUR);
      env.calls.length = 0;
      await poll(true, logger);
      // After 3 boards fail in a row the rest aren't requested (one more was already in flight)
      expect(env.calls.length).toBe(4);
    }
    // Shown in the app: down since the first poll that saw it
    expect((await getSettingsState(database.db)).sourceOutages).toEqual({
      greenhouse: {
        since: T0.toISOString(),
        lastSeenAt: new Date(T0.getTime() + 2 * HOUR).toISOString(),
        error: "HTTP 500",
        boards: 5,
      },
    });
    // Lever was down for hours in Nov 2026: no board should end up "needs review"
    expect((await database.db.select().from(companies)).map((c) => c.status)).toEqual(
      slugs.map(() => "ok"),
    );
    expect(
      await database.db.select().from(sourceState).where(eq(sourceState.source, "greenhouse")),
    ).toEqual([]);
    const warnings = lines.filter((l) => l.startsWith("WARN") && !l.includes("poll finished"));
    expect(warnings).toEqual([
      'WARN  poll · Greenhouse looks down: no board answered, 5 failed (HTTP 500); their health is left alone and the next poll retries  source=greenhouse boards=5 error="HTTP 500"',
      expect.stringContaining("Greenhouse looks down"),
      expect.stringContaining("Greenhouse looks down"),
    ]);

    // A 404 first (before the timeouts): it counts against that board only; the
    // others, including the ones the breaker never requested, are left alone
    env.failing.delete("c");
    env.calls.length = 0;
    await poll();
    const states = await database.db
      .select()
      .from(sourceState)
      .where(eq(sourceState.source, "greenhouse"));
    expect(states.map((s) => s.slug)).toEqual(["c"]);

    // Once one board answers it's not an outage: every failure counts
    env.boards.set("a", []);
    env.failing.delete("a");
    await poll();
    expect((await getSettingsState(database.db)).sourceOutages).toEqual({});
    expect(
      (await database.db.select().from(sourceState).where(eq(sourceState.source, "greenhouse")))
        .length,
    ).toBe(5);
  });

  it("leaves boards the breaker skipped alone when a board in flight then answers", async () => {
    const slugs = ["a", "b", "c", "d", "e", "f"];
    for (const slug of slugs) {
      await createCompany(database.db, {
        name: `Co ${slug}`,
        tier: "Startup",
        track: true,
        ats: "greenhouse",
        slug,
        status: "ok",
      });
      if (slug !== "a") env.failing.add(slug);
    }
    env.boards.set("a", []);
    for (let i = 0; i < 3; i++) {
      // "a" answers only after b, c and d have failed and tripped the breaker
      let release: () => void = () => {};
      const held = new Promise<void>((r) => {
        release = r;
      });
      env.setOnFetch(async (ctx) => {
        if (ctx.slug === "a") await held;
        if (ctx.slug === "d") setTimeout(release, 20);
      });
      clock = new Date(T0.getTime() + i * HOUR);
      env.calls.length = 0;
      const summary = await poll();
      expect(env.calls.map((c) => c.slug).sort()).toEqual(["a", "b", "c", "d"]);
      expect(summary.ran && summary.targets.filter((t) => t.status === "skipped").length).toBe(2);
    }
    expect((await getSettingsState(database.db)).sourceOutages).toEqual({});
    const status = new Map(
      (await database.db.select().from(companies)).map((c) => [c.slug, c.status]),
    );
    // The three that really failed 3 times need review; e and f were never asked
    expect(slugs.map((s) => status.get(s))).toEqual([
      "ok",
      "needs_review",
      "needs_review",
      "needs_review",
      "ok",
      "ok",
    ]);
  });

  it("carries a saved mark over when its only posting moves to another job", async () => {
    await addAcme();
    // A SimplifyJobs listing pointing at the company's own careers page, saved by the user
    env.setSimplify([
      sjJob("s1", "Acme", "Software Engineer, New Grad", "https://acme.test/careers/1"),
    ]);
    env.boards.set("acme", [ghJob("acme", "1", "Platform Engineer, New Grad")]);
    await poll();
    const sj = (await allJobs()).find((j) => j.id.startsWith("sj:"));
    if (!sj) throw new Error("expected the SimplifyJobs job");
    await database.db.update(jobs).set({ state: "saved" }).where(eq(jobs.id, sj.id));

    // SimplifyJobs now links the Greenhouse posting: its row moves to gh:1
    clock = new Date(T0.getTime() + HOUR);
    env.setSimplify([
      sjJob("s1", "Acme", "Software Engineer, New Grad", "https://boards.test/acme/jobs/1"),
    ]);
    await poll();
    const after = await allJobs();
    // No empty saved row left behind (it could never close); the mark moved with the posting
    expect(after.map((j) => [j.id, j.state])).toEqual([["gh:1", "saved"]]);
  });

  it("rolls back a failed target without saving its ETag", async () => {
    const acme = await addAcme();
    env.boards.set("acme", [
      ghJob("acme", "1", "Software Engineer, New Grad"),
      // An unknown source makes processing throw after the first insert
      { ...ghJob("acme", "2", "Software Engineer, New Grad"), source: "nope" },
    ]);
    const summary = await poll();
    expect(summary.ran && summary.targets[0]?.status).toBe("failed");
    expect(await allJobs()).toHaveLength(0);
    const state = await stateOf(companyStateKey(acme.id));
    expect(state).toMatchObject({ etag: null, consecutiveFailures: 1, baselinedAt: null });
  });

  it("abandons a target whose slug changed mid-poll, so the new slug gets a baseline", async () => {
    const acme = await addAcme();
    env.boards.set("acme", [ghJob("acme", "1", "Software Engineer, New Grad")]);
    env.boards.set("acme2", [ghJob("acme2", "7", "Software Engineer, New Grad")]);
    env.setOnFetch(async () => {
      env.setOnFetch(null);
      await updateCompany(database.db, acme.id, { slug: "acme2" });
    });
    const summary = await poll();
    expect(summary.ran && summary.targets[0]).toMatchObject({ stats: { abandoned: true } });
    expect(await allJobs()).toHaveLength(0);
    expect(await stateOf(companyStateKey(acme.id))).toBeUndefined();

    clock = new Date(T0.getTime() + HOUR);
    await poll();
    const stored = await allJobs();
    expect(stored.map((j) => [j.id, j.baseline])).toEqual([["gh:7", true]]);
  });
});

describe("runPoll: Simplify companies and suggestions", () => {
  it("baselines the aggregator's first poll", async () => {
    env.setSimplify([sjJob("s1", "Globex", "Software Engineer", "https://globex.com/jobs/1")]);
    await poll();
    expect((await allJobs())[0]).toMatchObject({ id: "sj:s1", baseline: true });
    env.setSimplify([
      sjJob("s1", "Globex", "Software Engineer", "https://globex.com/jobs/1"),
      sjJob("s2", "Globex", "Backend Engineer", "https://globex.com/jobs/2"),
    ]);
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    expect((await allJobs()).find((j) => j.id === "sj:s2")?.baseline).toBe(false);
  });

  it("suggests unlisted companies with the ATS from their URLs, and re-resolves jobs once added", async () => {
    env.setSimplify([
      sjJob("s1", "Initech", "Software Engineer", "https://boards.test/initech/jobs/11"),
      sjJob("s2", "Initech, Inc.", "Backend Engineer", "https://boards.test/initech/jobs/12"),
      sjJob("s3", "Initech", "Frontend Engineer", "https://initech.com/careers/fe"),
      sjJob("s4", "Hooli", "Senior Engineer", "https://hooli.com/jobs/1"),
    ]);
    await poll();
    let rows = await database.db.select().from(suggestions);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "initech",
        displayName: "Initech",
        ats: "greenhouse",
        slug: "initech",
        listingCount: 3,
        state: "open",
      }),
    ]);

    const initech = await createCompany(database.db, {
      name: "Initech",
      tier: "Mid",
      track: false,
      ats: "other",
      status: "manual_only",
    });
    clock = new Date(T0.getTime() + HOUR);
    await poll();
    rows = await database.db.select().from(suggestions);
    expect(rows[0]?.state).toBe("added");
    const stored = await allJobs();
    expect(stored.every((j) => j.id === "sj:s4" || j.companyId === initech.id)).toBe(true);
  });
});
