import { ANNUALIZE, STORE_WINDOW_MS } from "./constants";
import { adjustedPostedAt } from "./freshness";
import { containsSequence, matchesAnyKeyword, tokenize } from "./normalize";
import type { Settings } from "./settings";
import type { Salary } from "./sources/types";

export type SourceKind = "ats" | "aggregator";

type KeywordSettings = Pick<
  Settings,
  "roleKeywords" | "levelKeywords" | "excludeKeywords" | "applyLevelToSimplify"
>;

/**
 * ATS: role AND level AND NOT exclude. Aggregator: NOT exclude (AND level when
 * "Apply level keywords to Simplify" is on); role is covered by the category check.
 */
export const passesKeywordRule = (
  title: string,
  kind: SourceKind,
  settings: KeywordSettings,
): boolean => {
  const tokens = tokenize(title);
  if (matchesAnyKeyword(tokens, settings.excludeKeywords)) return false;
  const level = matchesAnyKeyword(tokens, settings.levelKeywords);
  if (kind === "aggregator") return settings.applyLevelToSimplify ? level : true;
  return level && matchesAnyKeyword(tokens, settings.roleKeywords);
};

const US_SEQUENCES = [["us"], ["usa"], ["u", "s"], ["u", "s", "a"], ["united", "states"]];

/** "Remote", "Remote - US", "Remote in USA", "United States (Remote)"; not "Remote in UK". */
export const isRemoteUs = (location: string): boolean => {
  const tokens = tokenize(location);
  if (!tokens.includes("remote")) return false;
  if (tokens.length === 1) return true;
  return US_SEQUENCES.some((seq) => containsSequence(tokens, seq));
};

/** Labels of the enabled named locations matched by any of the location strings. */
export const matchedLocationLabels = (
  locations: readonly string[],
  settings: Pick<Settings, "locations">,
): string[] => {
  const tokenized = locations.map((l) => ({ raw: l, tokens: tokenize(l) }));
  const labels: string[] = [];
  for (const loc of settings.locations) {
    if (!loc.enabled) continue;
    const hit =
      loc.builtin === "remote_us"
        ? tokenized.some((t) => isRemoteUs(t.raw))
        : tokenized.some((t) => matchesAnyKeyword(t.tokens, loc.aliases));
    if (hit) labels.push(loc.label);
  }
  return labels;
};

export const passesLocationRule = (
  locations: readonly string[],
  settings: Pick<Settings, "locations">,
): boolean => matchedLocationLabels(locations, settings).length > 0;

/** Annual USD salary, or nulls when no USD salary is listed. */
export const annualUsd = (salary?: Salary): { min: number | null; max: number | null } => {
  if (salary?.currency.toUpperCase() !== "USD") return { min: null, max: null };
  const factor = ANNUALIZE[salary.interval];
  const round = (v?: number) => (v === undefined ? null : Math.round(v * factor));
  return { min: round(salary.min), max: round(salary.max) };
};

/** Unlisted salary always passes; otherwise max (or min if no max) ≥ the setting. */
export const passesSalaryRule = (
  minUsd: number | null,
  maxUsd: number | null,
  settings: Pick<Settings, "minSalaryUsd">,
): boolean => {
  const value = maxUsd ?? minUsd;
  return value === null || value >= settings.minSalaryUsd;
};

export const categoryAllowed = (
  category: string | null | undefined,
  settings: Pick<Settings, "simplifyCategories">,
): boolean => {
  if (!category) return false;
  const c = category.trim().toLowerCase();
  return settings.simplifyCategories.some((s) => s.trim().toLowerCase() === c);
};

export interface FilterableListing {
  title: string;
  locations: readonly string[];
  postedAt: Date;
  postedAtPrecision: "instant" | "day";
  meta?: { active?: boolean; visible?: boolean; category?: string };
}

/** Decides whether a listing is stored (inserted or merged). */
export const passesPollFilter = (
  listing: FilterableListing,
  kind: SourceKind,
  settings: Settings,
  now: Date,
): boolean => {
  if (!passesLocationRule(listing.locations, settings)) return false;
  if (!passesKeywordRule(listing.title, kind, settings)) return false;
  if (kind === "aggregator") {
    if (listing.meta?.active !== true || listing.meta?.visible !== true) return false;
    if (!categoryAllowed(listing.meta?.category, settings)) return false;
  }
  const posted = adjustedPostedAt(listing.postedAt, listing.postedAtPrecision);
  return posted.getTime() >= now.getTime() - STORE_WINDOW_MS;
};

export interface VisibilityInput {
  locations: readonly string[];
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  closedAt: Date | null;
  sources: readonly { source: string; title: string; category: string | null }[];
}

/** Visibility rules V, applied at read time with current settings. */
export const isVisible = (
  job: VisibilityInput,
  settings: Settings,
  kindOf: (source: string) => SourceKind | undefined,
): boolean => {
  if (job.closedAt) return false;
  if (!passesLocationRule(job.locations, settings)) return false;
  const keywordOk = job.sources.some((s) => {
    const kind = kindOf(s.source);
    if (!kind) return false;
    if (kind === "aggregator" && !categoryAllowed(s.category, settings)) return false;
    return passesKeywordRule(s.title, kind, settings);
  });
  if (!keywordOk) return false;
  if (!passesSalaryRule(job.salaryMinUsd, job.salaryMaxUsd, settings)) return false;
  const hasDirect = job.sources.some((s) => kindOf(s.source) === "ats");
  return hasDirect || settings.showSimplifyJobs;
};
