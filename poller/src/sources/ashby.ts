import {
  type ParsedUrl,
  parseDate,
  type Salary,
  type SourceAdapter,
  validateItems,
} from "@jobvr/core";
import { z } from "zod";
import { decodeSlug, probeBoard, REMOTE_US } from "./shared";

const Address = z
  .object({ postalAddress: z.object({ addressCountry: z.string().nullish() }).nullish() })
  .nullish();

const RawJob = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  publishedAt: z.string(),
  isListed: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  address: Address,
  jobUrl: z.string(),
  descriptionPlain: z.string().nullish(),
  compensation: z
    .object({
      summaryComponents: z
        .array(
          z.object({
            compensationType: z.string().nullish(),
            interval: z.string().nullish(),
            currencyCode: z.string().nullish(),
            minValue: z.number().nullish(),
            maxValue: z.number().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

const Response = z.object({ jobs: z.array(z.unknown()) });

const US_COUNTRIES = new Set(["usa", "us", "united states", "united states of america"]);

const INTERVALS: Record<string, Salary["interval"]> = {
  "1 HOUR": "hour",
  "1 WEEK": "week",
  "1 MONTH": "month",
  "1 YEAR": "year",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const boardUrl = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;

const toSalary = (comp: z.output<typeof RawJob>["compensation"]): Salary | undefined => {
  const c = comp?.summaryComponents?.find((x) => x.compensationType === "Salary");
  const interval = c?.interval ? INTERVALS[c.interval] : undefined;
  if (!c || !interval || !c.currencyCode) return undefined;
  if (c.minValue == null && c.maxValue == null) return undefined;
  return {
    currency: c.currencyCode,
    interval,
    ...(c.minValue != null && { min: c.minValue }),
    ...(c.maxValue != null && { max: c.maxValue }),
  };
};

export const parseAshbyUrl = (raw: string): ParsedUrl | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== "jobs.ashbyhq.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [slug, id, extra] = parts;
  if (!slug || !id || !UUID.test(id)) return null;
  if (parts.length > 3 || (extra !== undefined && extra !== "application")) return null;
  const decoded = decodeSlug(slug);
  return decoded ? { sourceJobId: id.toLowerCase(), slug: decoded } : null;
};

export const ashby: SourceAdapter = {
  id: "ashby",
  label: "Ashby",
  kind: "ats",
  idPrefix: "ab",
  concurrency: 3,

  async fetch(ctx) {
    if (!ctx.slug) throw new Error("ashby: slug is required");
    const res = await ctx.http.getJson(boardUrl(ctx.slug), { etag: ctx.etag, signal: ctx.signal });
    if (res.status === "not_modified") return res;
    const { jobs: items } = Response.parse(res.data);
    const companyName = ctx.companyName ?? ctx.slug;
    const { jobs, invalidCount, invalidIds } = validateItems("ashby", items, RawJob, (j) => {
      // Unlisted jobs are treated as absent (closures see them as removed)
      if (j.isListed === false) return null;
      const locations = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(
        (l): l is string => Boolean(l),
      );
      // `isRemote` is not used: it is true for Hybrid jobs too
      const country = j.address?.postalAddress?.addressCountry?.trim().toLowerCase();
      if (j.workplaceType === "Remote" && country && US_COUNTRIES.has(country)) {
        if (!locations.includes(REMOTE_US)) locations.push(REMOTE_US);
      }
      const salary = toSalary(j.compensation);
      return {
        source: "ashby",
        sourceJobId: j.id.toLowerCase(),
        companyName,
        companySlug: ctx.slug,
        title: j.title.trim(),
        locations,
        url: j.jobUrl,
        postedAt: parseDate(j.publishedAt),
        postedAtPrecision: "instant",
        ...(salary && { salary }),
        ...(j.descriptionPlain && { description: j.descriptionPlain }),
      };
    });
    return { status: "ok", etag: res.etag, jobs, invalidCount, invalidIds };
  },

  parseUrl: parseAshbyUrl,

  probe: (slug, ctx) => probeBoard(boardUrl(slug), ctx, (data) => Response.parse(data).jobs.length),
};
