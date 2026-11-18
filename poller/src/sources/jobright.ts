import { type SourceAdapter, validateItems } from "@jobvr/core";
import { z } from "zod";
import { cellLink, cellText, parseTables, type TableRow, withoutTracking } from "./markdown";
import { REMOTE_US } from "./shared";

export const JOBRIGHT_URL =
  "https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md";

const RawRow = z.object({
  company: z.string().min(1),
  "job title": z.string().min(1),
  location: z.string(),
  "work model": z.string(),
  "date posted": z.string(),
});

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * "Nov 17" (no year) → midnight UTC of the latest such date not after
 * tomorrow, so a "Dec 30" row read on Jan 2 is last year's.
 */
export const parsePostedDate = (raw: string, now: Date): Date => {
  const m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/i.exec(raw.trim());
  const month = m?.[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  const day = Number(m?.[2]);
  if (month < 0 || !(day >= 1 && day <= 31)) throw new Error(`Invalid date: ${raw}`);
  const year = now.getUTCFullYear();
  const date = new Date(Date.UTC(year, month, day));
  return date.getTime() > now.getTime() + 86_400_000
    ? new Date(Date.UTC(year - 1, month, day))
    : date;
};

/** The job id in a jobright.ai/jobs/info/<id> link. */
const jobId = (url: string): string | null =>
  /^https:\/\/jobright\.ai\/jobs\/info\/([0-9a-z]+)/i.exec(url)?.[1]?.toLowerCase() ?? null;

/** "City, ST, United States" plus Remote - US when the work model is Remote in the US. */
export const parseLocations = (location: string, workModel: string): string[] => {
  const out = location ? [location] : [];
  const us = /(^|,\s*)(united states|usa|us)$/i.test(location);
  if (/^remote$/i.test(workModel.trim()) && us) out.push(REMOTE_US);
  return out;
};

/**
 * Jobright's public new-grad SWE list (a README; Jobright itself has no public
 * API). Its links go to Jobright's page for the job, not the posting, so jobs
 * dedupe with other sources by company and title, and take their link.
 */
export const jobright: SourceAdapter = {
  id: "jobright",
  label: "Jobright",
  kind: "aggregator",
  idPrefix: "jr",
  concurrency: 1,
  indirectLinks: true,

  async fetch(ctx) {
    const res = await ctx.http.getText(JOBRIGHT_URL, { etag: ctx.etag, signal: ctx.signal });
    if (res.status === "not_modified") return res;
    const { rows, malformed } = parseTables(res.data);
    if (rows.length === 0) throw new Error("jobright: no job table found in the README");
    const now = new Date();
    // "↳" rows are more roles at the company of the row above
    let company = "";
    const named: TableRow[] = rows.map((r) => {
      const name = cellText(r.company ?? "");
      if (name && name !== "↳") company = name;
      return { ...r, company: name === "↳" ? company : name };
    });
    // The list repeats some roles under a second id (51 of ~640 in Nov 2026); keep the
    // first (newest), or each repeat would show as its own job
    const seen = new Set<string>();
    const items = named.filter((r) => {
      const key = [r.company, cellText(r["job title"] ?? ""), cellText(r.location ?? "")]
        .join("\u0000")
        .toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const { jobs, invalidCount, invalidIds } = validateItems("jobright", items, RawRow, (r) => {
      const link = cellLink(r["job title"]);
      const url = link ? withoutTracking(link) : null;
      const id = url ? jobId(url) : null;
      if (!url || !id) throw new Error("no jobright.ai job link");
      return {
        source: "jobright",
        sourceJobId: id,
        companyName: r.company,
        title: cellText(r["job title"]),
        locations: parseLocations(cellText(r.location), cellText(r["work model"])),
        url,
        postedAt: parsePostedDate(cellText(r["date posted"]), now),
        postedAtPrecision: "day",
        meta: { active: true, visible: true, category: "Software Engineering" },
      };
    });
    return {
      status: "ok",
      etag: res.etag,
      jobs,
      invalidCount: invalidCount + malformed,
      invalidIds,
    };
  },
};
