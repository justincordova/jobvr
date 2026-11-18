import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./db/client";
import { companies, jobs } from "./db/schema";
import { createCompany } from "./repos/companies";
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
            choices: [{ message: { content: '{"tier":"Corporate","reason":"Large insurer"}' } }],
          }),
        );
      }) as unknown as typeof fetch,
    });
    expect(
      await rater.rate({ name: "Chubb", careersUrl: null, titles: ["Software Engineer I"] }),
    ).toEqual({ tier: "Corporate", reason: "Large insurer" });
    if (!sent) throw new Error("no request sent");
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((sent.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(sent.init.body));
    expect(body).toMatchObject({ model: "gpt-5-mini", reasoning_effort: "minimal" });
    expect(body.response_format.json_schema.schema.properties.tier.enum).toEqual([
      "S",
      "A",
      "Mid",
      "Startup",
      "Corporate",
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

    const bad = createOpenAiTierRater({
      apiKey: "k",
      fetch: reply(200, { choices: [{ message: { content: '{"tier":"B","reason":"x"}' } }] }),
    });
    await expect(bad.rate({ name: "A", careersUrl: null, titles: [] })).rejects.toThrow();
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
  const add = (name: string, tierSource: "seed" | "manual" | "pending" = "pending") =>
    createCompany(database.db, {
      name,
      tier: "Startup",
      tierSource,
      track: true,
      ats: "lever",
      slug: name.toLowerCase(),
      status: "ok",
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
    expect(result).toEqual({ rated: ["Initech"], failed: [] });
    expect(seen).toEqual([
      { name: "Initech", careersUrl: null, titles: ["Software Engineer, New Grad"] },
    ]);
    expect(await tiers()).toEqual({
      Initech: ["A", "auto", "Rated Initech"],
      Globex: ["Startup", "seed", null],
      Hooli: ["Startup", "manual", null],
    });
  });

  it("does nothing without a rater, and retries a failure after an hour", async () => {
    await add("Initech");
    expect(
      await runAutoTier({ database, rater: null, state: createAutoTierState(), now: () => NOW }),
    ).toEqual({ rated: [], failed: [] });

    const state = createAutoTierState();
    const run = (now: Date, r = rater(["Initech"])) =>
      runAutoTier({ database, rater: r, state, now: () => now });
    expect(await run(NOW)).toEqual({ rated: [], failed: ["Initech"] });
    expect(await run(new Date(NOW.getTime() + 60_000))).toEqual({ rated: [], failed: [] });
    expect(await run(new Date(NOW.getTime() + AUTO_TIER_RETRY_MS), rater())).toEqual({
      rated: ["Initech"],
      failed: [],
    });
  });

  it("stops at the daily cap, counting calls made this run and ratings saved before", async () => {
    await add("Initech");
    const state = createAutoTierState();
    state.calls = Array.from({ length: AUTO_TIER_DAILY_CAP }, () => NOW.getTime() - 1000);
    const run = (now: Date) => runAutoTier({ database, rater: rater(), state, now: () => now });
    expect(await run(NOW)).toEqual({ rated: [], failed: [] });
    // A day later the old calls no longer count
    expect(await run(new Date(NOW.getTime() + 86_400_000))).toEqual({
      rated: ["Initech"],
      failed: [],
    });
  });
});
