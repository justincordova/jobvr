import type { HttpClient } from "./http";
import type { Registry, SourceAdapter } from "./sources/types";

const STRIP_SUFFIXES = new Set(["ai", "labs", "inc", "technologies", "software", "robotics", "hq"]);
const LOWER_SUFFIXES = ["hq", "-hq", "-io", "inc"];

/** "EliseAI Labs" → ["Elise", "AI", "Labs"]. */
export const splitWords = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

/** Board slug guesses for a company name, most likely first. */
export const slugCandidates = (name: string): string[] => {
  const all = splitWords(name);
  const bases = [all];
  const trimmed = [...all];
  while (trimmed.length > 0 && STRIP_SUFFIXES.has(trimmed.at(-1)?.toLowerCase() ?? "")) {
    trimmed.pop();
  }
  if (trimmed.length > 0 && trimmed.length !== all.length) bases.push(trimmed);

  const out: string[] = [];
  const lowerForms: string[] = [];
  for (const words of bases) {
    const lower = words.map((w) => w.toLowerCase());
    out.push(words.join(""), lower.join(""), lower.join("-"));
    lowerForms.push(lower.join(""), lower.join("-"));
  }
  for (const form of lowerForms) {
    for (const suffix of LOWER_SUFFIXES) out.push(form + suffix);
  }
  return [...new Set(out.filter(Boolean))];
};

export interface BoardHit {
  ats: string;
  slug: string;
  jobCount: number;
}

export interface FindBoardOptions {
  registry: Registry;
  http: HttpClient;
  /** Source ids switched off in Settings. */
  disabled?: readonly string[];
  /** Aborts the probes (shutdown); the search then stops early. */
  signal?: AbortSignal;
  /** Only guesses this accepts are tried (see `boardFitsCompany`). */
  accept?: (slug: string) => boolean;
}

const atsAdapters = ({ registry, disabled = [] }: FindBoardOptions): SourceAdapter[] =>
  registry.filter((a) => a.kind === "ats" && a.probe && !disabled.includes(a.id));

/** A link as a URL; "acme.com/careers" (no scheme) counts too. */
export const asUrl = (input: string): URL | null => {
  const text = input.trim();
  if (/\s/.test(text) || !text.includes(".")) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  if (!URL.canParse(withScheme)) return null;
  const url = new URL(withScheme);
  return url.hostname.includes(".") ? url : null;
};

/** The ATS board a link points at (`jobs.lever.co/acme`), unchecked; null for other sites. */
export const boardInLink = (
  url: URL,
  options: FindBoardOptions,
): { adapter: SourceAdapter; slug: string } | null => {
  for (const adapter of atsAdapters(options)) {
    const slug = adapter.boardSlug?.(url.href) ?? adapter.parseUrl?.(url.href)?.slug;
    if (slug) return { adapter, slug };
  }
  return null;
};

/**
 * Looks for a company's board by guessing slugs from its name on every ATS.
 * Only boards with open jobs count (an empty board can be a stranger's test
 * board); the one with the most jobs wins. Probe errors count as "not there".
 */
export const findBoardByName = async (
  name: string,
  options: FindBoardOptions,
): Promise<BoardHit | null> => {
  const candidates = slugCandidates(name).filter((slug) => options.accept?.(slug) ?? true);
  const hits: BoardHit[] = [];
  // ATSes are separate hosts, so they're searched side by side; a few guesses at a time per host
  await Promise.all(
    atsAdapters(options).map(async (adapter) => {
      const probe = adapter.probe?.bind(adapter);
      if (!probe) return;
      for (let i = 0; i < candidates.length; i += 3) {
        if (options.signal?.aborted) return;
        const batch = candidates.slice(i, i + 3);
        const results = await Promise.allSettled(
          batch.map((slug) => probe(slug, { http: options.http, signal: options.signal })),
        );
        results.forEach((r, j) => {
          if (r.status !== "fulfilled" || !r.value.found || r.value.jobCount === 0) return;
          hits.push({ ats: adapter.id, slug: batch[j] as string, jobCount: r.value.jobCount });
        });
      }
    }),
  );
  // Registry order breaks ties, as when the ATSes were searched one by one
  const order = atsAdapters(options).map((a) => a.id);
  let best: BoardHit | null = null;
  for (const hit of hits.sort(
    (a, b) =>
      order.indexOf(a.ats) - order.indexOf(b.ats) ||
      candidates.indexOf(a.slug) - candidates.indexOf(b.slug),
  )) {
    if (!best || hit.jobCount > best.jobCount) best = hit;
  }
  return best;
};

/** "blue-matrix" → "Blue Matrix"; careers.acme.com → "Acme". */
export const nameFromLink = (url: URL, slug: string | null): string => {
  const base =
    slug ??
    url.hostname
      .toLowerCase()
      .replace(/^(www|careers|jobs|boards|apply)\./, "")
      .split(".")[0] ??
    url.hostname;
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
};
