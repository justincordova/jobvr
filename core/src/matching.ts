import { ANNUALIZE } from "./constants";
import { adjustedPostedAt } from "./freshness";
import { containsSequence, matchesAnyKeyword, matchesKeyword, tokenize } from "./normalize";
import { maxStoreWindowMs, type Settings, storeWindowMs } from "./settings";
import type { Salary } from "./sources/types";
import { stateCode, stateName } from "./us-states";

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
// Bare 6-9 stay out ("24/7", "Series 7"); codes like "L6" read as "5" (see `levelTokens`)
const EXPERIENCED_LEVEL_TOKENS = new Set([
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "2",
  "3",
  "4",
  "5",
]);
/**
 * Always experienced, whatever the exclude keywords say (they're editable and
 * stored, so a new default wouldn't reach existing installs). Phrases match the
 * whole title, before "Member of Technical Staff" is masked.
 */
const ALWAYS_EXPERIENCED = [
  "leader",
  "expert",
  "experienced",
  "advisory software",
  "advisory engineer",
  "consulting member of technical staff",
  "senior member of technical staff",
];
/** Pre-sales roles, whatever words surround them ("Software Solution Engineer"). */
const ALWAYS_PRESALES = ["solution engineer", "solutions engineer", "sales engineer", "presales"];
/** "Mid" as a level ("Engineer (Mid)", "Mid-Senior"), not "Mid-Market" or "Mid-Atlantic". */
const MID_NOT_LEVEL = new Set(["market", "size", "sized", "atlantic", "west", "western"]);
const isMidLevel = (tokens: readonly string[]) =>
  tokens.some((t, i) => t === "mid" && !MID_NOT_LEVEL.has(tokens[i + 1] ?? ""));
/** Level keywords too weak to waive the experience cutoff: banks' "Associate" is often 3-5 years in. */
const WEAK_LEVEL_KEYWORDS = new Set(["associate"]);
/** Only these outrank a numbered experienced level ("Engineer 2, New Grad"); "Associate" doesn't. */
const NEW_GRAD_WORDS = ["new grad", "new graduate", "grads", "entry level", "early career"];

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
  "solution",
  "solutions",
  "customer",
  "network",
  "services",
  "verification",
  "design",
  "asic",
  "fpga",
  "physical",
];

/**
 * One dash- or bracket-separated part of the title is a plain new-grad
 * engineering title: "Engineer New Grad - Evolve - An Apple Services Rotation
 * Program" names a program, not a discipline, in its other parts.
 */
const newGradEngineeringPart = (title: string) =>
  title.split(/\s[-–—|]\s|[()[\]]/).some((part) => {
    const tokens = tokenize(part);
    return (
      matchesAnyKeyword(tokens, GENERIC_ENGINEERING) &&
      matchesAnyKeyword(tokens, NEW_GRAD_WORDS) &&
      !matchesAnyKeyword(tokens, NON_SOFTWARE)
    );
  });

/**
 * A contract tag: "(Contract)", "- Contractor", ", Contract (Remote)". Contracts
 * as the subject ("Smart Contract Engineer") don't count.
 */
const CONTRACT_TAG =
  /[([]\s*contract(?:or|ual)?(?:\s+(?:position|role|basis))?\s*[)\]]|[-–—,|/]\s*contract(?:or|ual)?(?:\s+(?:position|role|basis))?\s*(?:$|[([,;])/i;
const GENERIC_ENGINEERING = ["engineer", "engineering", "developer", "programmer"];

/** Level codes read as their number: "L2", "IC3", "P2", "SDE2", "SWE3" → "2", "3", ... */
const LEVEL_CODE = /^(?:l|ic|p|sde|swe)(\d)$/;
/**
 * "L" codes where entry level starts higher: Google hires new grads at L3 and
 * Amazon's SDE I is L4. L3 says nothing about experience; L4 is entry level
 * when the title also says level I ("SDE I (L4)"), experienced otherwise.
 */
const NEUTRAL_L_CODE = "l3";
const ENTRY_L_CODE = "l4";

/**
 * Tokens for the level checks, without dotted codes: Amazon's "Software Dev
 * Engineer II - AMZ27480.1" would otherwise read as level 1 (entry).
 */
const levelTokens = (title: string) =>
  tokenize(title.replace(/\b[a-z]*\d+\w*(?:\.\d+)+\b/gi, " ")).map((t) => {
    if (t === NEUTRAL_L_CODE || t === ENTRY_L_CODE) return t;
    // Meta-style E codes: new grads start at E3, so only E4 and up say experienced
    if (/^e[4-9]$/.test(t)) return "4";
    const level = LEVEL_CODE.exec(t)?.[1];
    return level ? (Number(level) > 5 ? "5" : level) : t;
  });

/** "I" or "1" as a level: not "I/O" or "Tier 1". */
const isEntryNumber = (tokens: readonly string[], i: number) =>
  ENTRY_LEVEL_TOKENS.has(tokens[i] ?? "") && tokens[i + 1] !== "o" && tokens[i - 1] !== "tier";

/** True when the title says it's entry level (a level keyword, or "I" / "1"). */
export const isEntryLevelTitle = (title: string, settings: Pick<Settings, "levelKeywords">) => {
  const tokens = levelTokens(title);
  return (
    matchesAnyKeyword(tokens, settings.levelKeywords) ||
    tokens.some((_, i) => isEntryNumber(tokens, i))
  );
};

/**
 * A numbered level of 2 or more ("II", "3", "L2", "IC3"), unless the title is
 * a range from entry ("Engineer 1/2", "I/II") or plainly for new grads
 * ("Engineer 2, New Grad"). "Associate" or "University" alone don't outrank it.
 */
const isExperiencedLevel = (title: string) => {
  const tokens = levelTokens(title);
  const entryNumber = tokens.some((_, i) => isEntryNumber(tokens, i));
  const at = tokens.findIndex(
    (t) => EXPERIENCED_LEVEL_TOKENS.has(t) || (t === ENTRY_L_CODE && !entryNumber),
  );
  if (at < 0) return false;
  const range = at > 0 && isEntryNumber(tokens, at - 1);
  return !range && !matchesAnyKeyword(tokens, NEW_GRAD_WORDS);
};

/**
 * Blanks out the words of multi-word role phrases found in the title, so an
 * exclude word inside one ("Member of Technical Staff") doesn't reject it. A
 * phrase that is itself excluded ("machine learning" in both lists) isn't masked.
 */
const maskRolePhrases = (
  tokens: readonly string[],
  roles: readonly string[],
  excludes: readonly string[],
): string[] => {
  const excluded = new Set(excludes.map((k) => tokenize(k).join(" ")));
  const out = [...tokens];
  for (const phrase of roles) {
    const needle = tokenize(phrase);
    if (needle.length < 2 || excluded.has(needle.join(" "))) continue;
    for (let i = 0; i + needle.length <= out.length; i++) {
      if (needle.every((w, j) => tokens[i + j] === w)) out.fill("", i, i + needle.length);
    }
  }
  return out;
};

/** Joins between alternatives in a title: "Embedded/Backend", "C++ or Python", "Data & ML". */
const ALTERNATIVE_JOIN = /\s*(?:\/|&|\bor\b|\band\b)\s*/i;

/** Tokens of the longest keyword at the start or end of `tokens` (0 when none). */
const keywordAtEdge = (tokens: readonly string[], keywords: readonly string[], end: boolean) => {
  let best = 0;
  for (const k of keywords) {
    const n = tokenize(k).length;
    if (n === 0 || n > tokens.length || n <= best) continue;
    const edge = end ? tokens.slice(tokens.length - n) : tokens.slice(0, n);
    if (matchesKeyword(edge, k)) best = n;
  }
  return best;
};

/**
 * Title tokens for the exclude check, with an excluded word blanked when it's
 * one alternative beside one that isn't: "Software Engineer (Embedded/Backend)"
 * and "C++ or Python" offer a choice, "Embedded Software Engineer" doesn't.
 * Both sides excluded ("Senior/Staff") still rejects, and so does a word fenced
 * off from the join ("Tester (Freelance) / Test …").
 */
const maskAlternatives = (title: string, excludes: readonly string[]): string[] => {
  const raw = title.split(ALTERNATIVE_JOIN);
  const parts = raw.map(tokenize);
  for (let i = 0; i + 1 < parts.length; i++) {
    const left = parts[i] ?? [];
    const right = parts[i + 1] ?? [];
    if (left.length === 0 || right.length === 0) continue;
    if (!/[a-z0-9+#]$/i.test(raw[i] ?? "") || !/^[a-z0-9]/i.test(raw[i + 1] ?? "")) continue;
    const l = keywordAtEdge(left, excludes, true);
    const r = keywordAtEdge(right, excludes, false);
    // "Research Engineer / Scientist" offers two jobs, not two tracks: no waiver
    const jobTitle = (word: string | undefined) =>
      matchesAnyKeyword([word ?? ""], GENERIC_ENGINEERING);
    if (l > 0 && r === 0 && !jobTitle(right[0])) left.fill("", left.length - l);
    else if (r > 0 && l === 0 && !jobTitle(left.at(-1))) right.fill("", 0, r);
  }
  return parts.flat();
};

/**
 * 1. Exclude keywords and a contract tag always reject ("Senior", "Intern",
 *    "(Contract)").
 * 2. Numbered experienced levels ("II", "3") reject, unless it's a range from
 *    entry ("Engineer 1/2") or a new-grad title ("Engineer 2 New Grad").
 * 3. A role keyword passes ("Software Engineer", "AI Engineer"). A level
 *    keyword is optional unless "requireLevelOnBoards" (company boards) or
 *    "applyLevelToSimplify" (SimplifyJobs) is on.
 * 4. Without a role keyword, a generic engineering title with no other
 *    discipline ("Engineer 2 New Grad", not "Electrical Engineer") passes when
 *    it's entry level on a board, or in a trusted SimplifyJobs category.
 *    "AI Acceleration Specialist" never passes.
 */
export const passesKeywordRule = (
  title: string,
  kind: SourceKind,
  settings: KeywordSettings,
  category?: string | null,
): boolean => {
  const tokens = tokenize(title);
  const excludable = maskRolePhrases(
    maskAlternatives(title, settings.excludeKeywords),
    settings.roleKeywords,
    settings.excludeKeywords,
  );
  if (matchesAnyKeyword(excludable, settings.excludeKeywords) || CONTRACT_TAG.test(title)) {
    return false;
  }
  if (matchesAnyKeyword(tokens, ALWAYS_EXPERIENCED) || isMidLevel(tokens)) return false;
  if (matchesAnyKeyword(tokens, ALWAYS_PRESALES)) return false;
  const entry = isEntryLevelTitle(title, settings);
  if (isExperiencedLevel(title)) return false;
  const role = matchesAnyKeyword(tokens, settings.roleKeywords);

  if (role) {
    if (kind === "aggregator") return !settings.applyLevelToSimplify || entry;
    return !settings.requireLevelOnBoards || entry;
  }
  const genericEngineering =
    (matchesAnyKeyword(tokens, GENERIC_ENGINEERING) && !matchesAnyKeyword(tokens, NON_SOFTWARE)) ||
    newGradEngineeringPart(title);
  if (kind === "aggregator") {
    if (settings.applyLevelToSimplify && !entry) return false;
    return genericEngineering && categoryAllowed(category, settings);
  }
  return entry && genericEngineering;
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

const COUNTRY_NAMES = new Set(US_SEQUENCES.map((seq) => seq.join(" ")));

/** One place inside a location string; city/state are set for "City, ST" shapes. */
interface Place {
  raw: string;
  tokens: string[];
  city?: string[];
  state?: string;
}

/**
 * "New York, NY (HQ)" → city "new york", state "ny". A bare state ("NY",
 * "New Jersey") becomes a city-less place named after the state, so "SF; NY"
 * still reads as New York. Anything else ("NYC Office", "San Francisco, Seattle,
 * New York") is left unstructured and matched by tokens.
 */
const parsePlace = (raw: string): Place => {
  const tokens = tokenize(raw);
  let segments = raw
    .replace(/\([^)]*\)/g, " ")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const last = segments.at(-1);
  if (segments.length > 1 && last && COUNTRY_NAMES.has(tokenize(last).join(" "))) {
    segments = segments.slice(0, -1);
  }
  const [first, second] = segments;
  if (segments.length === 1 && first) {
    const code = stateCode(first);
    const name = code && stateName(code);
    if (name) return { raw, tokens, city: tokenize(name) };
  }
  if (segments.length === 2 && first && second) {
    const code = stateCode(second);
    if (code) return { raw, tokens, city: tokenize(first), state: code };
  }
  return { raw, tokens };
};

const splitPlaces = (location: string): Place[] =>
  location
    .split(/[;|]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(parsePlace);

/**
 * A "City, ST" place must be in one of the location's home states (states named
 * by its aliases), so "Brooklyn Park, MN" isn't NYC. A two-letter state alias
 * ("nj") matches the whole state; other aliases must match the city, so
 * "Buffalo, NY" isn't NYC either.
 */
const placeMatches = (place: Place, aliases: readonly string[]): boolean => {
  if (place.state) {
    const home = new Set(aliases.map(stateCode).filter((c): c is string => c !== null));
    if (home.size > 0 && !home.has(place.state)) return false;
    if (aliases.some((a) => a.trim().toLowerCase() === place.state)) return true;
    return matchesAnyKeyword(place.city ?? [], aliases);
  }
  return matchesAnyKeyword(place.city ?? place.tokens, aliases);
};

/** Places outside the US, for reading a bare "Remote" beside them. */
const FOREIGN_PLACES = new Set(
  [
    "europe",
    "emea",
    "apac",
    "latam",
    "asia",
    "uk",
    "united kingdom",
    "england",
    "canada",
    "mexico",
    "brazil",
    "argentina",
    "colombia",
    "chile",
    "ireland",
    "germany",
    "france",
    "spain",
    "portugal",
    "italy",
    "netherlands",
    "belgium",
    "switzerland",
    "austria",
    "poland",
    "hungary",
    "croatia",
    "romania",
    "bulgaria",
    "czech republic",
    "denmark",
    "sweden",
    "norway",
    "finland",
    "estonia",
    "greece",
    "serbia",
    "ukraine",
    "turkey",
    "israel",
    "egypt",
    "india",
    "singapore",
    "japan",
    "korea",
    "south korea",
    "china",
    "philippines",
    "australia",
    "new zealand",
    "london",
    "toronto",
    "vancouver",
    "montreal",
  ].map((p) => tokenize(p).join(" ")),
);

/**
 * A bare "Remote" means the US unless every other place is abroad: ElevenLabs'
 * "Remote; Poland; United Kingdom" is remote in Europe.
 */
const remoteUsHit = (places: readonly Place[]) => {
  const bare = (p: Place) => p.tokens.length === 1 && p.tokens[0] === "remote";
  if (places.some((p) => !bare(p) && isRemoteUs(p.raw))) return true;
  if (!places.some(bare)) return false;
  const others = places.filter((p) => !bare(p));
  return others.length === 0 || !others.every((p) => FOREIGN_PLACES.has(p.tokens.join(" ")));
};

/** Labels of the enabled named locations matched by any of the location strings. */
export const matchedLocationLabels = (
  locations: readonly string[],
  settings: Pick<Settings, "locations">,
): string[] => {
  const places = locations.flatMap(splitPlaces);
  const labels: string[] = [];
  for (const loc of settings.locations) {
    if (!loc.enabled) continue;
    const hit =
      loc.builtin === "remote_us"
        ? remoteUsHit(places)
        : places.some((p) => placeMatches(p, loc.aliases));
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
  // Explicit new-grad roles on company boards stay open for months
  const window =
    kind === "ats" && isEntryLevelTitle(listing.title, settings)
      ? maxStoreWindowMs(settings)
      : storeWindowMs(settings);
  return posted.getTime() >= now.getTime() - window;
};

export interface VisibilityInput {
  locations: readonly string[];
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  closedAt: Date | null;
  sources: readonly {
    source: string;
    title: string;
    category: string | null;
    requiredYears?: number | null;
  }[];
}

/**
 * A source row's description doesn't ask for too much experience: off when
 * the cutoff is 0, unknown (null) passes, and a title that clearly says it's
 * entry level ("Software Engineer, New Grad"; "Associate" alone isn't enough)
 * always passes.
 */
export const passesExperienceRule = (
  row: { title: string; requiredYears?: number | null },
  settings: Pick<Settings, "experienceCutoffYears" | "levelKeywords">,
): boolean =>
  settings.experienceCutoffYears === 0 ||
  row.requiredYears == null ||
  row.requiredYears < settings.experienceCutoffYears ||
  isEntryLevelTitle(row.title, {
    levelKeywords: settings.levelKeywords.filter((k) => !WEAK_LEVEL_KEYWORDS.has(k.toLowerCase())),
  });

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
    return (
      passesKeywordRule(s.title, kind, settings, s.category) && passesExperienceRule(s, settings)
    );
  });
  if (!keywordOk) return false;
  if (!passesSalaryRule(job.salaryMinUsd, job.salaryMaxUsd, settings)) return false;
  const hasDirect = job.sources.some((s) => kindOf(s.source) === "ats");
  return hasDirect || settings.showSimplifyJobs;
};
