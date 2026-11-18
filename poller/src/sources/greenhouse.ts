import {
  HttpError,
  type JobDetail,
  type ParsedUrl,
  parseDate,
  type SourceAdapter,
  validateItems,
} from "@jobvr/core";
import { z } from "zod";
import { boardSlugOn, decodeSlug, htmlToText, probeBoard } from "./shared";

const HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "job-boards.eu.greenhouse.io",
  "job-boards.anz.greenhouse.io",
]);

const RawJob = z.object({
  id: z.union([z.number().int(), z.string().regex(/^\d+$/)]),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  first_published: z.string(),
});

const Response = z.object({ jobs: z.array(z.unknown()) });

const Detail = z.object({
  content: z.string().nullish(),
  pay_input_ranges: z
    .array(
      z.object({
        min_cents: z.number().nullish(),
        max_cents: z.number().nullish(),
        currency_type: z.string().nullish(),
        title: z.string().nullish(),
      }),
    )
    .nullish(),
});

const detailUrl = (slug: string, id: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}?pay_transparency=true`;

/** The first pay range; its title says when it's hourly ("The hourly pay range ..."). */
const toSalary = (ranges: z.output<typeof Detail>["pay_input_ranges"]): JobDetail["salary"] => {
  const r = ranges?.find((x) => x.currency_type && (x.min_cents || x.max_cents));
  if (!r?.currency_type) return undefined;
  return {
    currency: r.currency_type,
    interval: /\bhour/i.test(r.title ?? "") ? "hour" : "year",
    ...(r.min_cents ? { min: r.min_cents / 100 } : {}),
    ...(r.max_cents ? { max: r.max_cents / 100 } : {}),
  };
};

const boardUrl = (slug: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;

export const parseGreenhouseUrl = (raw: string): ParsedUrl | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Career pages that embed Greenhouse: any host, slug unknown
  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid)) return { sourceJobId: ghJid };

  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "embed" && parts[1] === "job_app") {
    const token = url.searchParams.get("token");
    return token && /^\d+$/.test(token) ? { sourceJobId: token } : null;
  }
  const [slug, jobs, id] = parts;
  const decoded = slug && decodeSlug(slug);
  if (decoded && jobs === "jobs" && id && /^\d+$/.test(id)) {
    return { sourceJobId: id, slug: decoded };
  }
  return null;
};

export const greenhouse: SourceAdapter = {
  id: "greenhouse",
  label: "Greenhouse",
  kind: "ats",
  idPrefix: "gh",
  concurrency: 3,

  async fetch(ctx) {
    if (!ctx.slug) throw new Error("greenhouse: slug is required");
    const res = await ctx.http.getJson(boardUrl(ctx.slug), { etag: ctx.etag, signal: ctx.signal });
    if (res.status === "not_modified") return res;
    const { jobs: items } = Response.parse(res.data);
    const companyName = ctx.companyName ?? ctx.slug;
    const { jobs, invalidCount, invalidIds } = validateItems("greenhouse", items, RawJob, (j) => ({
      source: "greenhouse",
      sourceJobId: String(j.id),
      companyName,
      companySlug: ctx.slug,
      title: j.title.trim(),
      locations: j.location?.name ? [j.location.name] : [],
      url: j.absolute_url,
      // Never `updated_at`: it changes on every edit
      postedAt: parseDate(j.first_published),
      postedAtPrecision: "instant",
    }));
    return { status: "ok", etag: res.etag, jobs, invalidCount, invalidIds };
  },

  // The board list has no description or pay (`content=true` is ~50x larger
  // and uncompressed), so they're fetched per job, only for matching listings
  async fetchDetail(slug, sourceJobId, ctx) {
    try {
      const res = await ctx.http.getJson(detailUrl(slug, sourceJobId), { signal: ctx.signal });
      if (res.status !== "ok") return null;
      const d = Detail.parse(res.data);
      const salary = toSalary(d.pay_input_ranges);
      return { description: htmlToText(d.content ?? ""), ...(salary && { salary }) };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  },

  parseUrl: parseGreenhouseUrl,
  boardSlug: (url) => boardSlugOn(url, HOSTS),

  probe: (slug, ctx) => probeBoard(boardUrl(slug), ctx, (data) => Response.parse(data).jobs.length),
};
