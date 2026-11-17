import type { SourceAdapter } from "@jobvr/core";
import { validateItems } from "@jobvr/core";
import { z } from "zod";

export const SIMPLIFY_URL =
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json";

const RawListing = z.object({
  id: z.string(),
  company_name: z.string(),
  title: z.string(),
  url: z.string(),
  locations: z.array(z.string()).nullish(),
  category: z.string().nullish(),
  active: z.boolean(),
  is_visible: z.boolean(),
  /** Epoch seconds; exact midnight UTC means the source only knew the day. */
  date_posted: z.number().int().positive(),
});

export const simplify: SourceAdapter = {
  id: "simplify",
  label: "SimplifyJobs",
  kind: "aggregator",
  idPrefix: "sj",
  concurrency: 1,

  async fetch(ctx) {
    const res = await ctx.http.getJson(SIMPLIFY_URL, { etag: ctx.etag, signal: ctx.signal });
    if (res.status === "not_modified") return res;
    const items = z.array(z.unknown()).parse(res.data);
    const { jobs, invalidCount, invalidIds } = validateItems(
      "simplify",
      items,
      RawListing,
      (l) => ({
        source: "simplify",
        sourceJobId: l.id,
        companyName: l.company_name.trim(),
        title: l.title.trim(),
        locations: l.locations ?? [],
        url: l.url,
        postedAt: new Date(l.date_posted * 1000),
        postedAtPrecision: l.date_posted % 86_400 === 0 ? "day" : "instant",
        meta: {
          active: l.active,
          visible: l.is_visible,
          ...(l.category && { category: l.category }),
        },
      }),
    );
    return { status: "ok", etag: res.etag, jobs, invalidCount, invalidIds };
  },
};
