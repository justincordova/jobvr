import { ANNUALIZE, STORE_WINDOW_MS } from "./constants";
import { adjustedPostedAt } from "./freshness";
import { containsSequence, matchesAnyKeyword, tokenize } from "./normalize";
import type { Settings } from "./settings";
import type { Salary } from "./sources/types";

export type SourceKind = "ats" | "aggregator";

type KeywordSettings = Pick<
  Settings,
  | "roleKeywords"
  | "levelKeywords"
  | "excludeKeywords"
  | "applyLevelToSimplify"
  | "requireLevelOnBoards"
  | "simplifyCategories"
>;

// Numbered levels: "Engineer I" / "1" signal entry level; "II", "3", "IV" signal experience
const ENTRY_LEVEL_TOKENS = new Set(["i", "1"]);
const EXPERIENCED_LEVEL_TOKENS = new Set(["ii", "iii", "iv", "v", "2", "3", "4", "5"]);

/** Engineering titles from other disciplines; they need a role keyword, not just "engineer". */
const NON_SOFTWARE = [
  "electrical",
  "mechanical",
  "civil",
  "chemical",
  "structural",
  "hardware",
  "manufacturing",
  "process",
  "quality",
  "sales",
  "legal",
  "compliance",
  "field",
  "support",
  "solutions",
  "customer",
  "network",
];
const GENERIC_ENGINEERING = ["engineer", "engineering"];

/** True when the title says it's entry level (a level keyword, or "I" / "1"). */
export const isEntryLevelTitle = (title: string, settings: Pick<Settings, "levelKeywords">) => {
  const tokens = tokenize(title);
  return (
    matchesAnyKeyword(tokens, settings.levelKeywords) ||
    tokens.some((t) => ENTRY_LEVEL_TOKENS.has(t))
  );
};

/**
 * 1. Exclude keywords always reject ("Senior", "Intern").
 * 2. Numbered experienced levels ("II", "3") reject unless the title is also
 *    entry level ("Engineer 1/2", "Engineer 2 New Grad").
 * 3. Company boards: a role keyword, or an entry-level generic engineering
 *    title ("New Grad Engineer"). A level keyword is optional unless
 *    "requireLevelOnBoards" is on, so plain "Software Engineer" roles count.
 * 4. SimplifyJobs (already new-grad only): trusted categories pass; other
 *    categories need a role keyword ("AI Engineer" under AI/ML/Data).
 */
export const passesKeywordRule = (
  title: string,
  kind: SourceKind,
  settings: KeywordSettings,
  category?: string | null,
): boolean => {
  const tokens = tokenize(title);
  if (matchesAnyKeyword(tokens, settings.excludeKeywords)) return false;
  const entry = isEntryLevelTitle(title, settings);
  if (!entry && tokens.some((t) => EXPERIENCED_LEVEL_TOKENS.has(t))) return false;
  const role = matchesAnyKeyword(tokens, settings.roleKeywords);

  if (kind === "aggregator") {
    if (settings.applyLevelToSimplify && !entry) return false;
    return categoryAllowed(category, settings) || role;
  }
  if (settings.requireLevelOnBoards && !entry) return false;
  if (role) return true;
  return (
    entry &&
    matchesAnyKeyword(tokens, GENERIC_ENGINEERING) &&
    !matchesAnyKeyword(tokens, NON_SOFTWARE)
  );
};

const US_SEQUENCES = [
  ["us"],
  ["usa"],
  ["u", "s"],
  ["u", "s", "a"],
  ["united", "states"],
  ["united", "states", "of", "america"],
];

/**
 * "Remote", "Remote - US", "Remote in USA", "United States (Remote)", and a bare
 * "United States" (no city usually means anywhere in the US); not "Remote in UK".
 */
export const isRemoteUs = (location: string): boolean => {
  const tokens = tokenize(location);
  if (US_SEQUENCES.some((seq) => seq.length === tokens.length && containsSequence(tokens, seq)))
    return true;
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
  if (!passesKeywordRule(listing.title, kind, settings, listing.meta?.category)) return false;
  if (kind === "aggregator" && (listing.meta?.active !== true || listing.meta?.visible !== true))
    return false;
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
    return passesKeywordRule(s.title, kind, settings, s.category);
  });
  if (!keywordOk) return false;
  if (!passesSalaryRule(job.salaryMinUsd, job.salaryMaxUsd, settings)) return false;
  const hasDirect = job.sources.some((s) => kindOf(s.source) === "ats");
  return hasDirect || settings.showSimplifyJobs;
};
