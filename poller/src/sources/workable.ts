import {
  BOARD_TIMEOUT_MS,
  HttpError,
  type JobDetail,
  type ParsedUrl,
  parseDate,
  type Salary,
  type SourceAdapter,
  validateItems,
} from "@jobvr/core";
import { z } from "zod";
import { decodeSlug, htmlToText, probeBoard, REMOTE_US } from "./shared";

const HOST = "apply.workable.com";
/** Old-style boards on their own subdomain: acme.workable.com/j/<code>. */
const SUBDOMAIN = /^([a-z0-9-]+)\.workable\.com$/i;
const NOT_BOARDS = new Set(["apply", "www", "jobs", "api"]);
/** Shortcodes are global: apply.workable.com/j/<code> works without the account. */
const SHORTCODE = /^[A-Z0-9]{6,12}$/i;

const Place = z.object({
  city: z.string().nullish(),
  region: z.string().nullish(),
  country: z.string().nullish(),
  countryCode: z.string().nullish(),
  hidden: z.boolean().nullish(),
});

const RawJob = z.object({
  shortcode: z.string().regex(SHORTCODE),
  title: z.string(),
  // Day only ("2026-11-10")
  published_on: z.string(),
  telecommuting: z.boolean().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  locations: z.array(Place).nullish(),
});

const Response = z.object({ jobs: z.array(z.unknown()) });

const Detail = z.object({
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  benefits: z.string().nullish(),
  salary_from: z.number().nullish(),
  salary_to: z.number().nullish(),
  salary_currency_iso_code: z.string().nullish(),
  salary_frequency: z.string().nullish(),
});

const INTERVALS: Record<string, Salary["interval"]> = {
  hour: "hour",
  week: "week",
  month: "month",
  year: "year",
};

const boardUrl = (slug: string) =>
  `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`;
const detailUrl = (slug: string, code: string) =>
  `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(code)}`;

const placeText = (p: { city?: string | null; region?: string | null; country?: string | null }) =>
  [p.city, p.region, p.country]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");

const isUs = (code?: string | null, name?: string | null) =>
  code?.toUpperCase() === "US" || /^(united states|usa)$/i.test(name?.trim() ?? "");

const toSalary = (d: z.output<typeof Detail>): Salary | undefined => {
  const interval = d.salary_frequency ? INTERVALS[d.salary_frequency.toLowerCase()] : undefined;
  if (!interval || !d.salary_currency_iso_code) return undefined;
  if (!d.salary_from && !d.salary_to) return undefined;
  return {
    currency: d.salary_currency_iso_code,
    interval,
    ...(d.salary_from ? { min: d.salary_from } : {}),
    ...(d.salary_to ? { max: d.salary_to } : {}),
  };
};

/** The account a Workable link belongs to (apply.workable.com/acme/..., acme.workable.com). */
const accountOf = (url: URL): { slug: string | null; rest: string[] } | null => {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === HOST) {
    if (parts[0] === "j") return { slug: null, rest: parts };
    if (!parts[0] || parts[0] === "api") return null;
    return { slug: decodeSlug(parts[0]), rest: parts.slice(1) };
  }
  const sub = SUBDOMAIN.exec(host)?.[1];
  if (!sub || NOT_BOARDS.has(sub)) return null;
  return { slug: sub, rest: parts };
};

export const parseWorkableUrl = (raw: string): ParsedUrl | null => {
  if (!URL.canParse(raw)) return null;
  const account = accountOf(new URL(raw));
  if (!account) return null;
  const [j, code, extra, ...more] = account.rest;
  if (j !== "j" || !code || !SHORTCODE.test(code)) return null;
  if (more.length > 0 || (extra !== undefined && extra !== "apply")) return null;
  const sourceJobId = code.toUpperCase();
  return account.slug ? { sourceJobId, slug: account.slug } : { sourceJobId };
};

export const workable: SourceAdapter = {
  id: "workable",
  label: "Workable",
  kind: "ats",
  idPrefix: "wk",
  concurrency: 2,

  async fetch(ctx) {
    if (!ctx.slug) throw new Error("workable: slug is required");
    const slug = ctx.slug;
    // No ETag from Workable: every poll reads the list (~1 KB a job, without descriptions)
    const res = await ctx.http.getJson(boardUrl(slug), {
      signal: ctx.signal,
      timeoutMs: BOARD_TIMEOUT_MS,
    });
    if (res.status === "not_modified") return res;
    const { jobs: items } = Response.parse(res.data);
    const companyName = ctx.companyName ?? slug;
    const { jobs, invalidCount, invalidIds } = validateItems("workable", items, RawJob, (j) => {
      const places = (j.locations ?? []).filter((p) => !p.hidden);
      const locations = (
        places.length > 0 ? places : [{ city: j.city, region: j.state, country: j.country }]
      )
        .map(placeText)
        .filter(Boolean);
      const us =
        places.length > 0
          ? places.some((p) => isUs(p.countryCode, p.country))
          : isUs(null, j.country);
      if (j.telecommuting && us && !locations.includes(REMOTE_US)) locations.push(REMOTE_US);
      const code = j.shortcode.toUpperCase();
      return {
        source: "workable",
        sourceJobId: code,
        companyName,
        companySlug: slug,
        title: j.title.trim(),
        locations,
        url: `https://apply.workable.com/${encodeURIComponent(slug)}/j/${code}/`,
        postedAt: parseDate(j.published_on),
        postedAtPrecision: "day",
      };
    });
    return { status: "ok", etag: null, jobs, invalidCount, invalidIds };
  },

  // The list has no description or pay; they're fetched per job, only for matching listings
  async fetchDetail(slug, sourceJobId, ctx): Promise<JobDetail | null> {
    try {
      const res = await ctx.http.getJson(detailUrl(slug, sourceJobId), { signal: ctx.signal });
      if (res.status !== "ok") return null;
      const d = Detail.parse(res.data);
      const description = [d.description, d.requirements, d.benefits]
        .map((html) => htmlToText(html ?? ""))
        .filter(Boolean)
        .join("\n");
      const salary = toSalary(d);
      return { description, ...(salary && { salary }) };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  },

  parseUrl: parseWorkableUrl,
  boardSlug: (raw) => (URL.canParse(raw) ? (accountOf(new URL(raw))?.slug ?? null) : null),

  probe: (slug, ctx) => probeBoard(boardUrl(slug), ctx, (data) => Response.parse(data).jobs.length),
};
