import {
  BOARD_TIMEOUT_MS,
  HttpError,
  type JobDetail,
  type ParsedUrl,
  parseDate,
  type SourceAdapter,
  validateItems,
} from "@jobvr/core";
import { z } from "zod";
import { boardSlugOn, decodeSlug, htmlToText, probeBoard, REMOTE_US } from "./shared";

const HOSTS = new Set(["jobs.smartrecruiters.com", "careers.smartrecruiters.com"]);
const PAGE = 100;
/** Big employers post thousands; 20 pages (2,000 US roles) is far beyond any board seen so far. */
const MAX_PAGES = 20;
/** Posting ids lead the job link's last segment: /Acme/744000145291599-software-engineer. */
const POSTING_ID = /^(\d{6,})(?:-|$)/;

const RawJob = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  releasedDate: z.string(),
  company: z.object({ identifier: z.string() }),
  location: z
    .object({
      fullLocation: z.string().nullish(),
      city: z.string().nullish(),
      region: z.string().nullish(),
      country: z.string().nullish(),
      remote: z.boolean().nullish(),
    })
    .nullish(),
});

const Page = z.object({
  totalFound: z.number().int().nonnegative(),
  content: z.array(z.unknown()),
});

const Detail = z.object({
  jobAd: z
    .object({
      sections: z.record(z.string(), z.object({ text: z.string().nullish() }).nullish()).nullish(),
    })
    .nullish(),
});

/**
 * US postings only: big employers list thousands worldwide (Bosch ~5,000, 360 in
 * the US), and only US places (and Remote - US) can match.
 */
const pageUrl = (slug: string, offset: number) =>
  `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?country=us&limit=${PAGE}&offset=${offset}`;
const detailUrl = (slug: string, id: string) =>
  `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings/${encodeURIComponent(id)}`;

/** Sections worth reading, in order; the company blurb is skipped. */
const SECTIONS = ["jobDescription", "qualifications", "additionalInformation"];

export const parseSmartRecruitersUrl = (raw: string): ParsedUrl | null => {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [company, posting, ...more] = parts;
  const id = posting && POSTING_ID.exec(posting)?.[1];
  if (!company || !id || more.length > 0) return null;
  const slug = decodeSlug(company);
  return slug ? { sourceJobId: id, slug } : null;
};

export const smartrecruiters: SourceAdapter = {
  id: "smartrecruiters",
  label: "SmartRecruiters",
  kind: "ats",
  idPrefix: "sr",
  concurrency: 2,

  async fetch(ctx) {
    if (!ctx.slug) throw new Error("smartrecruiters: slug is required");
    const slug = ctx.slug;
    // The first page (newest first) carries the ETag: unchanged means the board is.
    // A posting closing deeper down with nothing new on top waits for the next change.
    const first = await ctx.http.getJson(pageUrl(slug, 0), {
      etag: ctx.etag,
      signal: ctx.signal,
      timeoutMs: BOARD_TIMEOUT_MS,
    });
    if (first.status === "not_modified") return first;
    const head = Page.parse(first.data);
    const items = [...head.content];
    const pages = Math.min(MAX_PAGES, Math.ceil(head.totalFound / PAGE));
    for (let p = 1; p < pages; p++) {
      const res = await ctx.http.getJson(pageUrl(slug, p * PAGE), {
        signal: ctx.signal,
        timeoutMs: BOARD_TIMEOUT_MS,
      });
      if (res.status !== "ok") break;
      const page = Page.parse(res.data);
      items.push(...page.content);
      if (page.content.length < PAGE) break;
    }
    const companyName = ctx.companyName ?? slug;
    const { jobs, invalidCount, invalidIds } = validateItems(
      "smartrecruiters",
      items,
      RawJob,
      (j) => {
        const loc = j.location;
        const place =
          loc?.fullLocation?.trim() ||
          [loc?.city, loc?.region, loc?.country]
            .map((s) => s?.trim())
            .filter(Boolean)
            .join(", ");
        const locations = place ? [place] : [];
        // Every posting asked for is in the US
        if (loc?.remote) locations.push(REMOTE_US);
        return {
          source: "smartrecruiters",
          sourceJobId: j.id,
          companyName,
          companySlug: slug,
          title: j.name.trim(),
          locations,
          url: `https://jobs.smartrecruiters.com/${encodeURIComponent(j.company.identifier)}/${j.id}`,
          postedAt: parseDate(j.releasedDate),
          postedAtPrecision: "instant",
        };
      },
    );
    return { status: "ok", etag: first.etag, jobs, invalidCount, invalidIds };
  },

  // The list has no description; it's fetched per job, only for matching listings
  async fetchDetail(slug, sourceJobId, ctx): Promise<JobDetail | null> {
    try {
      const res = await ctx.http.getJson(detailUrl(slug, sourceJobId), { signal: ctx.signal });
      if (res.status !== "ok") return null;
      const sections = Detail.parse(res.data).jobAd?.sections ?? {};
      const description = SECTIONS.map((k) => htmlToText(sections[k]?.text ?? ""))
        .filter(Boolean)
        .join("\n");
      return { description };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  },

  parseUrl: parseSmartRecruitersUrl,
  boardSlug: (url) => boardSlugOn(url, HOSTS),

  // An unknown company answers like an empty one, so only a board with US roles counts
  probe: async (slug, ctx) => {
    const { jobCount } = await probeBoard(
      pageUrl(slug, 0),
      ctx,
      (data) => Page.parse(data).totalFound,
    );
    return { found: jobCount > 0, jobCount };
  },
};
