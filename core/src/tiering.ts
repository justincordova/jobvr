import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { DAY_MS, TIERS, type Tier } from "./constants";
import type { Database } from "./db/client";
import { type CompanyRow, companies, jobs } from "./db/schema";
import { ConflictError, NotFoundError } from "./errors";
import { errorFields, type Logger, silentLogger } from "./logger";
import { isAutoAdded, mergeCompanyInto } from "./repos/companies";

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
  /** The name in `knownCompanies` it's another name for ("BMO" for "Bank of Montreal"), else null. */
  sameAs?: string | null;
}

export interface TierRaterInput {
  name: string;
  careersUrl: string | null;
  /** A few of its recent job titles (helps place a company the model barely knows). */
  titles: string[];
  /** Companies already on the list, so a new name for one of them is caught. */
  knownCompanies?: readonly string[];
}

export interface TierRater {
  model: string;
  rate(input: TierRaterInput, options?: { signal?: AbortSignal }): Promise<TierRating>;
}

const INSTRUCTIONS = `You place companies on a tier list for someone looking for US new-grad software engineering jobs. Tiers:
- S: elite pay and prestige for new grads: the biggest tech companies, top AI labs, top trading firms and the hottest high-paying tech companies (e.g. Google, Meta, Microsoft, Amazon, OpenAI, Anthropic, Jane Street, Citadel, Hudson River Trading, Stripe, Databricks, Ramp).
- A: strong, well-known tech companies with excellent engineering (e.g. Datadog, Plaid, Brex, MongoDB, Twilio, Atlassian, Pinterest, Shopify, CrowdStrike, Duolingo).
- Mid: solid established product, enterprise and fintech software companies (e.g. Dropbox, Etsy, Zillow, Elastic, SoFi, PayPal, Autodesk, Epic Games, Affirm).
- Startup: smaller or younger venture-backed product companies. A well-known, well-funded one goes by its standing instead (e.g. Vercel is A; Render, Tailscale and PlanetScale are Mid).
- Corporate: traditional enterprises where software isn't the core business: banks, insurers, asset managers, retailers, manufacturers, government and defense contractors, consultancies, IT services firms, staffing and recruiting agencies and job boards, whatever their size (e.g. Chubb, American Express, BlackRock, Booz Allen Hamilton).
A company acquired by another goes by its parent's tier.
If you don't recognize the company, judge from its name, careers page and job titles: one that sells services, consulting, staffing or government contracting (often "Solutions", "Consulting" or "Group" names, roles for clients, or OPT-only hiring) is Corporate; otherwise answer Startup.
reason: one plain sentence of at most 15 words, e.g. "Well-funded AI coding startup" or "Large insurer; software supports the business".
sameAs: when the company is one already in knownCompanies under another name, that exact name from the list; otherwise null. Only when you're sure: a parent, a subsidiary or a different company with a similar name is not the same.`;

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
        sameAs: { type: ["string", "null"] },
      },
      required: ["tier", "reason", "sameAs"],
      additionalProperties: false,
    },
  },
} as const;

/** Room for minimal reasoning plus the small JSON answer; caps what one rating can cost. */
const MAX_COMPLETION_TOKENS = 300;

const ChatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
});
const Rating = z.strictObject({
  tier: z.enum(TIERS),
  reason: z.string().trim().min(1).max(200),
  sameAs: z.string().trim().min(1).max(200).nullish(),
});
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
    async rate(input, rateOptions) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
      const res = await doFetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          ...(takesReasoningEffort(model) && { reasoning_effort: "minimal" }),
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          response_format: RESPONSE_FORMAT,
          messages: [
            { role: "system", content: INSTRUCTIONS },
            {
              role: "user",
              content: JSON.stringify({
                company: input.name,
                careersPage: input.careersUrl,
                recentJobTitles: input.titles,
                knownCompanies: input.knownCompanies ?? [],
              }),
            },
          ],
        }),
        signal: rateOptions?.signal ? AbortSignal.any([timeout, rateOptions.signal]) : timeout,
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = ApiError.safeParse(body);
        throw new Error(
          `OpenAI answered ${res.status}${detail.success ? `: ${detail.data.error.message.slice(0, 200)}` : ""}`,
        );
      }
      const choice = ChatResponse.parse(body).choices[0];
      const message = choice?.message;
      if (choice?.finish_reason === "length") {
        throw new Error(`OpenAI's rating was cut off at ${MAX_COMPLETION_TOKENS} tokens`);
      }
      if (!message?.content)
        throw new Error(`OpenAI gave no rating (${message?.refusal ?? "empty"})`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.content);
      } catch {
        throw new Error("OpenAI's rating isn't valid JSON");
      }
      const rating = Rating.safeParse(parsed);
      if (!rating.success) {
        const issue = rating.error.issues[0];
        throw new Error(
          `OpenAI's rating doesn't fit (${issue ? `${issue.path.join(".") || "answer"}: ${issue.message}` : "invalid"})`,
        );
      }
      return rating.data;
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
  /** Stops before the next rating once this much time has passed (the rest wait for the next run). */
  budgetMs?: number;
  /** Aborts the AI call in flight (shutdown); nothing else starts. */
  signal?: AbortSignal;
}

/** "bask" and "bask health": one name's words start the other's. */
const wordPrefix = (a: string, b: string) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long === short || long.startsWith(`${short} `);
};

type MergeCandidate = Pick<CompanyRow, "name" | "normalizedName" | "aliases" | "ats" | "slug">;

/**
 * Why the AI's "same company" answer can't be trusted for these two, or null.
 * Its answer only picks among companies that already look alike (same board,
 * or one name the start of the other's), so a name on a list can't steer a
 * merge into an unrelated company.
 */
export const mergeRejection = (from: MergeCandidate, into: MergeCandidate): string | null => {
  if (from.ats === into.ats && from.slug && from.slug.toLowerCase() === into.slug?.toLowerCase()) {
    return null;
  }
  const names = (c: MergeCandidate) => [c.normalizedName, ...c.aliases];
  const alike = names(from).some((a) => names(into).some((b) => wordPrefix(a, b)));
  return alike ? null : "their names don't match (neither is the start of the other)";
};

/**
 * Rates companies whose tier is `pending` (added automatically or by hand)
 * with the AI rater, when one is configured. Seed tiers and tiers someone
 * picked are never touched. At most AUTO_TIER_DAILY_CAP calls a day. When the
 * AI says a company auto-add created is one already on the list under another
 * name, and the names agree (see `mergeRejection`), it's merged into that one
 * instead (see `mergeCompanyInto`).
 */
export const runAutoTier = async (
  options: AutoTierOptions,
): Promise<{ rated: string[]; failed: string[]; merged: string[] }> => {
  const { database, rater, state } = options;
  const { db } = database;
  if (!rater) return { rated: [], failed: [], merged: [] };
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
  if (pending.length === 0) return { rated: [], failed: [], merged: [] };
  if (left <= 0) {
    if (state.capLoggedAt === undefined || now.getTime() - state.capLoggedAt >= DAY_MS) {
      state.capLoggedAt = now.getTime();
      log.info(
        { cap: AUTO_TIER_DAILY_CAP, waiting: pending.length },
        `daily AI rating cap (${AUTO_TIER_DAILY_CAP}) reached; ${pending.length} compan${pending.length === 1 ? "y waits" : "ies wait"} until it frees up`,
      );
    }
    return { rated: [], failed: [], merged: [] };
  }

  const known = await db
    .select({
      id: companies.id,
      name: companies.name,
      normalizedName: companies.normalizedName,
      aliases: companies.aliases,
      ats: companies.ats,
      slug: companies.slug,
    })
    .from(companies);
  const rated: string[] = [];
  const failed: string[] = [];
  const merged: string[] = [];
  const started = performance.now();
  const batch = pending.slice(0, Math.min(left, AUTO_TIER_PER_RUN));
  for (const [i, c] of batch.entries()) {
    if (options.signal?.aborted) break;
    if (options.budgetMs !== undefined && performance.now() - started >= options.budgetMs) {
      log.debug(
        { budgetMs: options.budgetMs, waiting: batch.length - i },
        `rating time budget used up; ${batch.length - i} compan${batch.length - i === 1 ? "y waits" : "ies wait"} for the next run`,
      );
      break;
    }
    // Only a company auto-add created can be folded into another
    const mergeable = isAutoAdded(c);
    const titles = await db
      .selectDistinct({ title: jobs.title, effectiveAt: jobs.effectiveAt })
      .from(jobs)
      .where(eq(jobs.companyId, c.id))
      .orderBy(desc(jobs.effectiveAt))
      .limit(TITLES_SENT * 2);
    state.calls.push(now.getTime());
    try {
      const rating = await rater.rate(
        {
          name: c.name,
          careersUrl: c.careersUrl,
          titles: [...new Set(titles.map((t) => t.title))].slice(0, TITLES_SENT),
          knownCompanies: mergeable ? known.filter((k) => k.id !== c.id).map((k) => k.name) : [],
        },
        { signal: options.signal },
      );
      state.failures.delete(c.id);
      const same = mergeable ? rating.sameAs?.toLowerCase() : undefined;
      const target = same && known.find((k) => k.id !== c.id && k.name.toLowerCase() === same);
      const why = !same
        ? null
        : !target
          ? `"${rating.sameAs}" isn't on the list`
          : mergeRejection(c, target);
      if (same && why) {
        log.info(
          { company: c.name, sameAs: rating.sameAs, model: rater.model },
          `kept ${c.name} as its own company: the AI said it's ${rating.sameAs}, but ${why}`,
        );
      }
      if (target && !why) {
        try {
          await mergeCompanyInto(db, c.id, target.id);
          merged.push(c.name);
          log.info(
            { company: c.name, into: target.name, model: rater.model },
            `merged ${c.name} into ${target.name}: the same company under another name`,
          );
          continue;
        } catch (err) {
          // Both have a job board, it was edited by hand meanwhile, or one is gone
          if (!(err instanceof ConflictError || err instanceof NotFoundError)) throw err;
          log.info(
            { company: c.name, into: target.name, model: rater.model },
            `kept ${c.name} as its own company: the AI said it's ${target.name}, but ${err.message}`,
          );
        }
      }
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
      rated.push(c.name);
      log.info(
        { company: c.name, tier: rating.tier, model: rater.model },
        `rated ${c.name} ${rating.tier}: ${rating.reason}`,
      );
    } catch (err) {
      // Shutting down: not the company's fault, so it isn't held back an hour
      if (options.signal?.aborted) break;
      state.failures.set(c.id, now.getTime());
      failed.push(c.name);
      log.warn(
        { ...errorFields(err), company: c.name },
        `couldn't rate ${c.name} (${err instanceof Error ? err.message : String(err)}); trying again in an hour`,
      );
    }
  }
  return { rated, failed, merged };
};
