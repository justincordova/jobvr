import { HttpError, type JobDetail, type SourceAdapter, validateItems } from "@jobvr/core";
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

/** Jobright packs lists into JSON strings ("[\"a\",\"b\"]"); anything unreadable is empty. */
const jsonList = (raw: unknown): string[] => {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const jsonObject = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const section = (heading: string, lines: readonly string[]) =>
  lines.length > 0 ? [`${heading}:`, ...lines.map((l) => l.trim())].join("\n") : "";

/**
 * The job page's text, from the data the page embeds (`__NEXT_DATA__`):
 * summary, responsibilities, qualifications and the years asked for, so list
 * jobs get the same experience check and key lines as board jobs. Null when
 * the page has no job (taken down).
 */
export const jobrightDetail = (html: string): JobDetail | null => {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) return null;
  let job: Record<string, unknown> | undefined;
  try {
    job = JSON.parse(m[1])?.props?.pageProps?.dataSource?.jobResult;
  } catch {
    return null;
  }
  if (!job || typeof job !== "object") return null;
  const quals = jsonObject(job.qualifications);
  const detail = jsonObject(job.detailQualifications);
  const mustHave = (detail.mustHave ?? {}) as Record<string, unknown>;
  const yoe = Array.isArray(mustHave.yoe)
    ? mustHave.yoe.filter((x): x is string => typeof x === "string")
    : [];
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const description = [
    typeof job.jobSummary === "string" ? job.jobSummary.trim() : "",
    section("Responsibilities", jsonList(job.coreResponsibilities)),
    section("Experience", yoe),
    section("Qualifications", list(quals.mustHave)),
    section("Preferred", list(quals.preferredHave)),
    job.isCitizenOnly === "true" ? "U.S. citizenship required." : "",
    job.isClearanceRequired === "true" ? "Security clearance required." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const min = Number(job.minSalary);
  const max = Number(job.maxSalary);
  const yearly = typeof job.salaryDesc === "string" && /\/yr/i.test(job.salaryDesc);
  return {
    description,
    ...(yearly &&
      min > 0 &&
      max >= min && { salary: { currency: "USD", interval: "year" as const, min, max } }),
  };
};

/**
 * Jobright's public new-grad SWE list (a README; Jobright itself has no public
 * API). Its links go to Jobright's page for the job, not the posting, so jobs
 * dedupe with other sources by company and title, and take their link. The
 * page itself has the description (`fetchDetail`).
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

  async fetchDetail(_slug, sourceJobId, ctx): Promise<JobDetail | null> {
    try {
      const res = await ctx.http.getText(`https://jobright.ai/jobs/info/${sourceJobId}`, {
        signal: ctx.signal,
      });
      return res.status === "ok" ? jobrightDetail(res.data) : null;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  },
};
