import {
  type ParsedUrl,
  parseDate,
  type Salary,
  type SourceAdapter,
  validateItems,
} from "@jobvr/core";
import { z } from "zod";
import { probeBoard, REMOTE_US } from "./shared";

const RawPosting = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  createdAt: z.number(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  salaryRange: z
    .object({
      currency: z.string().nullish(),
      interval: z.string().nullish(),
      min: z.number().nullish(),
      max: z.number().nullish(),
    })
    .nullish(),
});

const INTERVALS: Record<string, Salary["interval"]> = {
  "per-hour-wage": "hour",
  "per-week-salary": "week",
  "per-month-salary": "month",
  "per-year-salary": "year",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Slugs are sent exactly as given: Lever is case-sensitive (BlueMatrix vs bluematrix)
const postingsUrl = (slug: string) =>
  `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;

const toSalary = (range: z.output<typeof RawPosting>["salaryRange"]): Salary | undefined => {
  const interval = range?.interval ? INTERVALS[range.interval] : undefined;
  if (!range || !interval || !range.currency) return undefined;
  if (range.min == null && range.max == null) return undefined;
  return {
    currency: range.currency,
    interval,
    ...(range.min != null && { min: range.min }),
    ...(range.max != null && { max: range.max }),
  };
};

export const parseLeverUrl = (raw: string): ParsedUrl | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // jobs.eu.lever.co is deliberately not recognized (EU API is out of scope)
  if (url.hostname.toLowerCase() !== "jobs.lever.co") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [slug, id, extra] = parts;
  if (!slug || !id || !UUID.test(id)) return null;
  if (parts.length > 3 || (extra !== undefined && extra !== "apply")) return null;
  return { sourceJobId: id.toLowerCase(), slug: decodeURIComponent(slug) };
};

export const lever: SourceAdapter = {
  id: "lever",
  label: "Lever",
  kind: "ats",
  idPrefix: "lv",
  concurrency: 3,

  async fetch(ctx) {
    if (!ctx.slug) throw new Error("lever: slug is required");
    const res = await ctx.http.getJson(postingsUrl(ctx.slug), {
      etag: ctx.etag,
      signal: ctx.signal,
    });
    if (res.status === "not_modified") return res;
    const items = z.array(z.unknown()).parse(res.data);
    const companyName = ctx.companyName ?? ctx.slug;
    const { jobs, invalidCount } = validateItems("lever", items, RawPosting, (p) => {
      const locations = p.categories?.allLocations?.length
        ? [...p.categories.allLocations]
        : p.categories?.location
          ? [p.categories.location]
          : [];
      if (p.workplaceType === "remote" && p.country === "US" && !locations.includes(REMOTE_US)) {
        locations.push(REMOTE_US);
      }
      const salary = toSalary(p.salaryRange);
      return {
        source: "lever",
        sourceJobId: p.id.toLowerCase(),
        companyName,
        companySlug: ctx.slug,
        title: p.text.trim(),
        locations,
        url: p.hostedUrl,
        postedAt: parseDate(p.createdAt),
        postedAtPrecision: "instant",
        ...(salary && { salary }),
      };
    });
    return { status: "ok", etag: res.etag, jobs, invalidCount };
  },

  parseUrl: parseLeverUrl,

  probe: (slug, ctx) =>
    probeBoard(postingsUrl(slug), ctx, (data) => z.array(z.unknown()).parse(data).length),
};
