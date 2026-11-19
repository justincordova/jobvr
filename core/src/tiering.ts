import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { DAY_MS, TIERS, type Tier } from "./constants";
import type { Database } from "./db/client";
import { companies, jobs } from "./db/schema";
import { errorFields, type Logger, silentLogger } from "./logger";

export const DEFAULT_TIER_MODEL = "gpt-5-mini";
/** Hard ceiling on AI calls a day, so a bug or a flood of new companies can't run up a bill. */
export const AUTO_TIER_DAILY_CAP = 200;
export const AUTO_TIER_PER_RUN = 10;
/** A company whose rating failed is tried again after this long. */
export const AUTO_TIER_RETRY_MS = 60 * 60_000;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TITLES_SENT = 5;

export interface TierRating {
  tier: Tier;
  /** One short sentence a job seeker understands. */
  reason: string;
}

export interface TierRaterInput {
  name: string;
  careersUrl: string | null;
  /** A few of its recent job titles (helps place a company the model barely knows). */
  titles: string[];
}

export interface TierRater {
  model: string;
  rate(input: TierRaterInput): Promise<TierRating>;
}

const INSTRUCTIONS = `You place companies on a tier list for someone looking for US new-grad software engineering jobs. Tiers:
- S: elite pay and prestige for new grads: the biggest tech companies, top AI labs, top trading firms and the hottest high-paying tech companies (e.g. Google, Meta, Microsoft, Amazon, OpenAI, Anthropic, Jane Street, Citadel, Hudson River Trading, Stripe, Databricks, Ramp).
- A: strong, well-known tech companies with excellent engineering (e.g. Datadog, Plaid, Brex, MongoDB, Twilio, Atlassian, Pinterest, Shopify, CrowdStrike, Duolingo).
- Mid: solid established product, enterprise and fintech software companies (e.g. Dropbox, Etsy, Zillow, Elastic, SoFi, PayPal, Autodesk, Epic Games, Affirm).
- Startup: smaller or younger venture-backed tech companies.
- Corporate: traditional enterprises where software isn't the core business: banks, insurers, retailers, manufacturers, defense contractors, consultancies and staffing firms (e.g. Chubb, American Express, BlackRock).
If you don't recognize the company, judge from its name, careers page and job titles; when still unsure, answer Startup.
reason: one plain sentence of at most 15 words, e.g. "Well-funded AI coding startup" or "Large insurer; software supports the business".`;

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "company_tier",
    strict: true,
    schema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: [...TIERS] },
        reason: { type: "string" },
      },
      required: ["tier", "reason"],
      additionalProperties: false,
    },
  },
} as const;

const ChatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
});
const Rating = z.object({ tier: z.enum(TIERS), reason: z.string().trim().min(1).max(300) });
const ApiError = z.object({ error: z.object({ message: z.string() }) });

/** GPT-5 reasoning models think before answering; minimal effort keeps a rating cheap and quick. */
const takesReasoningEffort = (model: string) =>
  /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(model);

/** Rates companies with OpenAI's Chat Completions API (structured output: a tier and a reason). */
export const createOpenAiTierRater = (options: {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): TierRater => {
  const model = options.model ?? DEFAULT_TIER_MODEL;
  const doFetch = options.fetch ?? fetch;
  return {
    model,
    async rate(input) {
      const res = await doFetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          ...(takesReasoningEffort(model) && { reasoning_effort: "minimal" }),
          response_format: RESPONSE_FORMAT,
          messages: [
            { role: "system", content: INSTRUCTIONS },
            {
              role: "user",
              content: JSON.stringify({
                company: input.name,
                careersPage: input.careersUrl,
                recentJobTitles: input.titles,
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = ApiError.safeParse(body);
        throw new Error(
          `OpenAI answered ${res.status}${detail.success ? `: ${detail.data.error.message.slice(0, 200)}` : ""}`,
        );
      }
      const message = ChatResponse.parse(body).choices[0]?.message;
      if (!message?.content)
        throw new Error(`OpenAI gave no rating (${message?.refusal ?? "empty"})`);
      return Rating.parse(JSON.parse(message.content));
    },
  };
};

/** Kept by the caller between runs: recent AI calls (for the daily cap) and failed companies. */
export interface AutoTierState {
  calls: number[];
  failures: Map<string, number>;
  /** When "cap reached" was last logged (once a day is enough). */
  capLoggedAt?: number;
}

export const createAutoTierState = (): AutoTierState => ({ calls: [], failures: new Map() });

export interface AutoTierOptions {
  database: Database;
  rater: TierRater | null;
  state: AutoTierState;
  logger?: Logger;
  now?: () => Date;
  /** Only these companies (a company just added by hand). */
  ids?: readonly string[];
}

/**
 * Rates companies whose tier is `pending` (added automatically or by hand)
 * with the AI rater, when one is configured. Seed tiers and tiers someone
 * picked are never touched. At most AUTO_TIER_DAILY_CAP calls a day.
 */
export const runAutoTier = async (
  options: AutoTierOptions,
): Promise<{ rated: string[]; failed: string[] }> => {
  const { database, rater, state } = options;
  const { db } = database;
  if (!rater) return { rated: [], failed: [] };
  const log = (options.logger ?? silentLogger).child({ module: "companies" });
  const now = (options.now ?? (() => new Date()))();
  const since = now.getTime() - DAY_MS;
  state.calls = state.calls.filter((t) => t > since);
  // Calls made before a restart aren't in memory; the ratings they saved are
  const [saved] = await db
    .select({ n: count() })
    .from(companies)
    .where(and(eq(companies.tierSource, "auto"), gte(companies.tieredAt, new Date(since))));
  const left = AUTO_TIER_DAILY_CAP - Math.max(state.calls.length, saved?.n ?? 0);

  const pending = (
    await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.tierSource, "pending"),
          options.ids ? inArray(companies.id, [...options.ids]) : undefined,
        ),
      )
      .orderBy(companies.createdAt)
  ).filter((c) => {
    const failedAt = state.failures.get(c.id);
    return failedAt === undefined || now.getTime() - failedAt >= AUTO_TIER_RETRY_MS;
  });
  if (pending.length === 0) return { rated: [], failed: [] };
  if (left <= 0) {
    if (state.capLoggedAt === undefined || now.getTime() - state.capLoggedAt >= DAY_MS) {
      state.capLoggedAt = now.getTime();
      log.info(
        { cap: AUTO_TIER_DAILY_CAP, waiting: pending.length },
        `daily AI rating cap (${AUTO_TIER_DAILY_CAP}) reached; ${pending.length} compan${pending.length === 1 ? "y waits" : "ies wait"} until it frees up`,
      );
    }
    return { rated: [], failed: [] };
  }

  const rated: string[] = [];
  const failed: string[] = [];
  for (const c of pending.slice(0, Math.min(left, AUTO_TIER_PER_RUN))) {
    const titles = await db
      .selectDistinct({ title: jobs.title, effectiveAt: jobs.effectiveAt })
      .from(jobs)
      .where(eq(jobs.companyId, c.id))
      .orderBy(desc(jobs.effectiveAt))
      .limit(TITLES_SENT * 2);
    state.calls.push(now.getTime());
    try {
      const rating = await rater.rate({
        name: c.name,
        careersUrl: c.careersUrl,
        titles: [...new Set(titles.map((t) => t.title))].slice(0, TITLES_SENT),
      });
      // A tier picked meanwhile wins
      await db
        .update(companies)
        .set({
          tier: rating.tier,
          tierSource: "auto",
          tierReason: rating.reason,
          tieredAt: now,
          updatedAt: now,
        })
        .where(and(eq(companies.id, c.id), eq(companies.tierSource, "pending")));
      state.failures.delete(c.id);
      rated.push(c.name);
      log.info(
        { company: c.name, tier: rating.tier, model: rater.model },
        `rated ${c.name} ${rating.tier}: ${rating.reason}`,
      );
    } catch (err) {
      state.failures.set(c.id, now.getTime());
      failed.push(c.name);
      log.warn(
        { ...errorFields(err), company: c.name },
        `couldn't rate ${c.name} (${err instanceof Error ? err.message : String(err)}); trying again in an hour`,
      );
    }
  }
  return { rated, failed };
};
