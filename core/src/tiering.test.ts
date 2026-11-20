import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./db/client";
import { companies, jobs } from "./db/schema";
import { ConflictError } from "./errors";
import { createCompany, findCompanyByName, mergeCompanyInto } from "./repos/companies";
import { createTestDatabase } from "./testing";
import {
  AUTO_TIER_DAILY_CAP,
  AUTO_TIER_RETRY_MS,
  createAutoTierState,
  createOpenAiTierRater,
  runAutoTier,
  type TierRater,
  type TierRaterInput,
} from "./tiering";

const NOW = new Date("2026-11-18T15:00:00Z");

describe("createOpenAiTierRater", () => {
  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("asks for a structured rating and reads it", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const rater = createOpenAiTierRater({
      apiKey: "sk-test",
      fetch: (async (url: string, init: RequestInit) => {
        sent = { url, init };
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"tier":"D","reason":"Large insurer"}' } }],
          }),
        );
      }) as unknown as typeof fetch,
    });
    expect(
      await rater.rate({ name: "Chubb", careersUrl: null, titles: ["Software Engineer I"] }),
    ).toEqual({ tier: "D", reason: "Large insurer" });
    if (!sent) throw new Error("no request sent");
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((sent.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(sent.init.body));
    expect(body).toMatchObject({
      model: "gpt-5-mini",
      reasoning_effort: "minimal",
      max_completion_tokens: 300,
    });
    expect(body.response_format.json_schema.schema.properties.tier.enum).toEqual([
      "S",
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(body.messages[1].content).toContain("Software Engineer I");
  });

  it("leaves reasoning effort out for other models", async () => {
    let body: Record<string, unknown> = {};
    const rater = createOpenAiTierRater({
      apiKey: "k",
      model: "gpt-4.1-mini",
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"tier":"S","reason":"x"}' } }] }),
        );
      }) as unknown as typeof fetch,
    });
    await rater.rate({ name: "A", careersUrl: null, titles: [] });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("reports API errors and bad ratings without the key", async () => {
    const failing = createOpenAiTierRater({
      apiKey: "sk-secret",
      fetch: reply(401, { error: { message: "Incorrect API key provided" } }),
    });
    const err = await failing.rate({ name: "A", careersUrl: null, titles: [] }).catch((e) => e);
    expect(String(err)).toContain("OpenAI answered 401: Incorrect API key provided");
    expect(String(err)).not.toContain("sk-secret");

    const answering = (content: string, finish_reason = "stop") =>
      createOpenAiTierRater({
        apiKey: "k",
        fetch: reply(200, { choices: [{ message: { content }, finish_reason }] }),
      }).rate({ name: "A", careersUrl: null, titles: [] });
    await expect(answering('{"tier":"Mid","reason":"x"}')).rejects.toThrow(
      "OpenAI's rating doesn't fit (tier:",
    );
    await expect(answering(`{"tier":"A","reason":"${"x".repeat(201)}"}`)).rejects.toThrow(
      "(reason:",
    );
    await expect(answering('{"tier":"A","reason":"x","extra":1}')).rejects.toThrow();
    await expect(answering('{"tier":"A","rea')).rejects.toThrow("isn't valid JSON");
    await expect(answering('{"tier":"A","rea', "length")).rejects.toThrow("cut off at 300 tokens");
  });

  it("stops the call when the caller aborts", async () => {
    const rater = createOpenAiTierRater({
      apiKey: "k",
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as unknown as typeof fetch,
    });
    const stop = new AbortController();
    const rating = rater.rate({ name: "A", careersUrl: null, titles: [] }, { signal: stop.signal });
    stop.abort();
    await expect(rating).rejects.toThrow();
  });
});

describe("runAutoTier", () => {
  let database: Database;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.close());
  beforeEach(async () => {
    await database.db.delete(jobs);
    await database.db.delete(companies);
  });

  const seen: TierRaterInput[] = [];
  const rater = (fail: string[] = []): TierRater => ({
    model: "test-model",
    rate: async (input) => {
      seen.push(input);
      if (fail.includes(input.name)) throw new Error("OpenAI answered 500");
      return { tier: "A", reason: `Rated ${input.name}` };
    },
  });
  const add = (
    name: string,
    tierSource: "seed" | "manual" | "pending" = "pending",
    notes: string | null = "Added automatically from SimplifyJobs (no readable job board)",
  ) =>
    createCompany(database.db, {
      name,
      tier: "C",
      tierSource,
      track: true,
      ats: "lever",
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      status: "ok",
      notes,
    });
  const tiers = async () =>
    Object.fromEntries(
      (await database.db.select().from(companies)).map((c) => [
        c.name,
        [c.tier, c.tierSource, c.tierReason],
      ]),
    );

  it("rates pending companies only, with their recent titles", async () => {
    seen.length = 0;
    const initech = await add("Initech");
    await add("Globex", "seed");
    await add("Hooli", "manual");
    await database.db.insert(jobs).values({
      id: "lv:1",
      companyId: initech.id,
      companyName: "Initech",
      title: "Software Engineer, New Grad",
      url: "https://jobs.lever.co/initech/1",
      primarySource: "lever",
      firstSeenAt: NOW,
      effectiveAt: NOW,
    });
    const result = await runAutoTier({
      database,
      rater: rater(),
      state: createAutoTierState(),
      now: () => NOW,
    });
    expect(result).toEqual({ rated: ["Initech"], failed: [], merged: [] });
    expect(seen).toMatchObject([
      { name: "Initech", careersUrl: null, titles: ["Software Engineer, New Grad"] },
    ]);
    // The other companies, so a new name for one of them is caught
    expect([...(seen[0]?.knownCompanies ?? [])].sort()).toEqual(["Globex", "Hooli"]);
    expect(await tiers()).toEqual({
      Initech: ["A", "auto", "Rated Initech"],
      Globex: ["C", "seed", null],
      Hooli: ["C", "manual", null],
    });
  });

  it("does nothing without a rater, and retries a failure after an hour", async () => {
    await add("Initech");
    expect(
      await runAutoTier({ database, rater: null, state: createAutoTierState(), now: () => NOW }),
    ).toEqual({ rated: [], failed: [], merged: [] });

    const state = createAutoTierState();
    const run = (now: Date, r = rater(["Initech"])) =>
      runAutoTier({ database, rater: r, state, now: () => now });
    expect(await run(NOW)).toEqual({ rated: [], failed: ["Initech"], merged: [] });
    expect(await run(new Date(NOW.getTime() + 60_000))).toEqual({
      rated: [],
      failed: [],
      merged: [],
    });
    expect(await run(new Date(NOW.getTime() + AUTO_TIER_RETRY_MS), rater())).toEqual({
      rated: ["Initech"],
      failed: [],
      merged: [],
    });
  });

  it("stops at the daily cap, counting calls made this run and ratings saved before", async () => {
    await add("Initech");
    const state = createAutoTierState();
    state.calls = Array.from({ length: AUTO_TIER_DAILY_CAP }, () => NOW.getTime() - 1000);
    const run = (now: Date) => runAutoTier({ database, rater: rater(), state, now: () => now });
    expect(await run(NOW)).toEqual({ rated: [], failed: [], merged: [] });
    // A day later the old calls no longer count
    expect(await run(new Date(NOW.getTime() + 86_400_000))).toEqual({
      rated: ["Initech"],
      failed: [],
      merged: [],
    });
  });
  const listOnly = (
    name: string,
    tierSource: "seed" | "manual" | "pending",
    notes: string | null,
  ) =>
    createCompany(database.db, {
      name,
      tier: tierSource === "pending" ? "C" : "D",
      tierSource,
      track: false,
      ats: "other",
      status: "manual_only",
      notes,
    });
  const sameAs = (name: string): TierRater => ({
    model: "test-model",
    rate: async () => ({ tier: "C", reason: "Health startup", sameAs: name }),
  });
  const runWith = (r: TierRater) =>
    runAutoTier({ database, rater: r, state: createAutoTierState(), now: () => NOW });

  it("merges an auto-added company into the one whose name it starts", async () => {
    const health = await listOnly("Bask Health", "seed", null);
    const bask = await add("Bask");
    await database.db.insert(jobs).values({
      id: "sj:1",
      companyId: bask.id,
      companyName: "Bask",
      title: "Software Engineer",
      url: "https://example.com/1",
      primarySource: "simplify",
      firstSeenAt: NOW,
      effectiveAt: NOW,
    });
    expect(await runWith(sameAs("bask health"))).toEqual({
      rated: [],
      failed: [],
      merged: ["Bask"],
    });

    const rows = await database.db.select().from(companies);
    // Its board moves along, and its name keeps resolving to Bask Health
    expect(rows).toEqual([
      expect.objectContaining({
        id: health.id,
        tier: "D",
        ats: "lever",
        slug: "bask",
        track: true,
        aliases: ["bask"],
      }),
    ]);
    expect(await findCompanyByName(database.db, "Bask")).toMatchObject({ id: health.id });
    const [job] = await database.db.select().from(jobs);
    expect(job).toMatchObject({ companyId: health.id, companyName: "Bask Health" });
  });

  it("keeps a company whose name doesn't match the AI's pick, rating it instead", async () => {
    await listOnly("BMO", "seed", null);
    await add("Bank of Montreal");
    // A list's company name can't steer a merge into an unrelated company
    expect(await runWith(sameAs("BMO"))).toEqual({
      rated: ["Bank of Montreal"],
      failed: [],
      merged: [],
    });
    expect((await database.db.select().from(companies)).map((c) => c.name).sort()).toEqual([
      "BMO",
      "Bank of Montreal",
    ]);
  });

  it("never merges away a seed, a picked tier or a company added by hand", async () => {
    await listOnly("Bask Health", "seed", null);
    await add("Bask", "pending", "Added by hand");
    expect(await runWith(sameAs("Bask Health"))).toMatchObject({ rated: ["Bask"], merged: [] });
    await database.db.delete(companies);

    seen.length = 0;
    await listOnly("Bask Health", "seed", null);
    await add("Bask", "pending", "Added by hand");
    await runWith(rater());
    // Not even asked: a hand-added company is never folded into another
    expect(seen[0]?.knownCompanies).toEqual([]);
    await database.db.delete(companies);

    // Whatever asks: only an auto-added company with a tier nobody picked can be merged away
    const into = await listOnly("Bask Health", "pending", "Added automatically from x");
    for (const tierSource of ["seed", "manual"] as const) {
      const from = await add(`Bask ${tierSource}`, tierSource);
      await expect(mergeCompanyInto(database.db, from.id, into.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    }
    expect(await database.db.select().from(companies)).toHaveLength(3);
  });
});
