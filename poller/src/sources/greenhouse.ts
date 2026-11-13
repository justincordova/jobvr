import { type ParsedUrl, parseDate, type SourceAdapter, validateItems } from "@jobvr/core";
import { z } from "zod";
import { probeBoard } from "./shared";

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
  if (slug && jobs === "jobs" && id && /^\d+$/.test(id)) {
    return { sourceJobId: id, slug: decodeURIComponent(slug) };
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
    const { jobs, invalidCount } = validateItems("greenhouse", items, RawJob, (j) => ({
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
    return { status: "ok", etag: res.etag, jobs, invalidCount };
  },

  parseUrl: parseGreenhouseUrl,

  probe: (slug, ctx) => probeBoard(boardUrl(slug), ctx, (data) => Response.parse(data).jobs.length),
};
