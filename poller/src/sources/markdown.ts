import { createHash } from "node:crypto";
import { htmlToText } from "./shared";

/** One table row from a markdown document, keyed by lowercased header. */
export type TableRow = Record<string, string>;

export interface ParsedTables {
  rows: TableRow[];
  /** Rows whose cell count didn't match their table's header (counted as invalid). */
  malformed: number;
}

const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

/** Splits a "| a | b |" line on unescaped pipes. */
const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

/**
 * Every pipe table in a GitHub README: a header line, a `| --- |` line, then
 * rows until the first non-table line. Each row maps header → raw cell.
 */
export const parseTables = (markdown: string): ParsedTables => {
  const lines = markdown.split(/\r?\n/);
  const rows: TableRow[] = [];
  let malformed = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]?.trim() ?? "";
    if (!header.startsWith("|") || !SEPARATOR.test(lines[i + 1]?.trim() ?? "")) continue;
    const names = cells(header).map((h) => h.toLowerCase());
    let j = i + 2;
    for (; j < lines.length; j++) {
      const line = lines[j]?.trim() ?? "";
      if (!line.startsWith("|")) break;
      const values = cells(line);
      if (values.length !== names.length) {
        malformed++;
        continue;
      }
      rows.push(Object.fromEntries(names.map((n, k) => [n, values[k] ?? ""])));
    }
    i = j - 1;
  }
  return { rows, malformed };
};

/** Visible text of a cell: markdown links and emphasis and HTML tags removed. */
export const cellText = (cell: string): string =>
  htmlToText(
    cell
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__/g, ""),
  ).trim();

/** First link in a cell (markdown or HTML), or null. */
export const cellLink = (cell: string): string | null =>
  /href="([^"]+)"/.exec(cell)?.[1] ?? /\]\((https?:\/\/[^)\s]+)\)/.exec(cell)?.[1] ?? null;

/** A stable id for a list row that has no id of its own. */
export const shortHash = (value: string): string =>
  createHash("sha1").update(value).digest("hex").slice(0, 16);

/** The link without tracking parameters (utm_*, ref, source), so ids and dedupe ignore them. */
export const withoutTracking = (raw: string): string => {
  if (!URL.canParse(raw)) return raw;
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || key === "ref" || key === "source") url.searchParams.delete(key);
  }
  // A page anchor (#apply) goes; a route (Oracle's #en/sites/jobsearch/job/350824) is the job
  if (!url.hash.includes("/")) url.hash = "";
  return url.toString();
};

/** Midnight UTC `days` days before `now` ("3d" on a list updated today). */
export const daysAgo = (days: number, now: Date): Date => {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - days * 86_400_000);
};
