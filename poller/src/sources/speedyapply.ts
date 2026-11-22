import { type Salary, type SourceAdapter, validateItems } from "@jobvr/core";
import { z } from "zod";
import { cellLink, cellText, daysAgo, parseTables, shortHash, withoutTracking } from "./markdown";
import { REMOTE_US } from "./shared";

export const SPEEDYAPPLY_URL =
  "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md";

/** One row of any of the README's tables (FAANG+, Quant, Other; only some have Salary). */
const RawRow = z.object({
  company: z.string().min(1),
  position: z.string().min(1),
  location: z.string(),
  salary: z.string().optional(),
  posting: z.string(),
  age: z.string().regex(/^\d+d$/),
});

/** "$193k/yr" → a yearly salary (one figure: the list shows no range). */
export const parseSalary = (raw: string | undefined): Salary | undefined => {
  const m = /^\$(\d+(?:\.\d+)?)(k?)\/(yr|hr)$/i.exec(raw?.trim() ?? "");
  if (!m?.[1]) return undefined;
  const value = Number(m[1]) * (m[2] ? 1000 : 1);
  return { currency: "USD", interval: m[3]?.toLowerCase() === "hr" ? "hour" : "year", max: value };
};

/**
 * "New York City, NY +1" → "New York City, NY" (the others aren't named).
 * "Remote - Austin, TX" / "Remote - USA" → the place plus Remote - US; a
 * remote role elsewhere ("Remote - Canada") stays as written.
 */
export const parseLocation = (raw: string): string[] => {
  const place = raw.replace(/\s*\+\d+$/, "").trim();
  const remote = /^remote\s*-\s*(.+)$/i.exec(place);
  if (!remote?.[1]) return place ? [place] : [];
  const where = remote[1].trim();
  if (/^(usa|us|united states)$/i.test(where)) return [REMOTE_US];
  if (/,\s*[A-Z]{2}$/.test(where) || /,\s*(usa|united states)$/i.test(where)) {
    return [where, REMOTE_US];
  }
  return [place];
};

export const speedyapply: SourceAdapter = {
  id: "speedyapply",
  label: "SpeedyApply",
  kind: "aggregator",
  idPrefix: "sa",
  concurrency: 1,

  async fetch(ctx) {
    const res = await ctx.http.getText(SPEEDYAPPLY_URL, { etag: ctx.etag, signal: ctx.signal });
    if (res.status === "not_modified") return res;
    const { rows, malformed } = parseTables(res.data);
    if (rows.length === 0) throw new Error("speedyapply: no job table found in the README");
    const now = new Date();
    const { jobs, invalidCount, invalidIds } = validateItems("speedyapply", rows, RawRow, (r) => {
      const link = cellLink(r.posting);
      if (!link) throw new Error("no apply link");
      const url = withoutTracking(link);
      const salary = parseSalary(r.salary);
      return {
        source: "speedyapply",
        sourceJobId: shortHash(url),
        companyName: cellText(r.company),
        title: cellText(r.position),
        locations: parseLocation(cellText(r.location)),
        url,
        postedAt: daysAgo(Number.parseInt(r.age, 10), now),
        postedAtPrecision: "day",
        ...(salary && { salary }),
        // A new-grad SWE list: every row is the software category, and listed means open
        meta: { active: true, visible: true, category: "Software Engineering" },
      };
    });
    // Ids come from the link: rows that share one (a generic careers page) would
    // overwrite each other's job, so only the first is kept
    const seen = new Set<string>();
    const unique = jobs.filter((j) => !seen.has(j.sourceJobId) && seen.add(j.sourceJobId));
    return {
      status: "ok",
      etag: res.etag,
      jobs: unique,
      invalidCount: invalidCount + malformed,
      invalidIds,
    };
  },
};
