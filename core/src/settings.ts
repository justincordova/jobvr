import { z } from "zod";
import { DAY_MS, ENTRY_LEVEL_STORE_DAYS, RETENTION_MARGIN_DAYS, TIER_FILTERS } from "./constants";

export const REMOTE_US_LABEL = "Remote-US";

const keyword = z.string().trim().min(1).max(100);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use HH:MM (24 h)" });

export const NamedLocationSchema = z
  .object({
    label: z.string().trim().min(1).max(50),
    aliases: z.array(keyword).max(50),
    enabled: z.boolean(),
    builtin: z.literal("remote_us").optional(),
  })
  .refine((loc) => (loc.builtin ? loc.aliases.length === 0 : loc.aliases.length > 0), {
    error: "Alias locations need at least one alias; the built-in Remote-US entry has none",
  });

export type NamedLocation = z.infer<typeof NamedLocationSchema>;

const fields = {
  locations: z
    .array(NamedLocationSchema)
    .max(30)
    .superRefine((locs, ctx) => {
      const labels = locs.map((l) => l.label.toLowerCase());
      if (new Set(labels).size !== labels.length) {
        ctx.addIssue({ code: "custom", message: "Location labels must be unique" });
      }
      if (!locs.some((l) => l.enabled)) {
        ctx.addIssue({ code: "custom", message: "Enable at least one location" });
      }
      const builtins = locs.filter((l) => l.builtin === "remote_us");
      if (builtins.length !== 1 || builtins[0]?.label !== REMOTE_US_LABEL) {
        ctx.addIssue({
          code: "custom",
          message: `The built-in ${REMOTE_US_LABEL} location can't be renamed or removed`,
        });
      }
    }),
  tiersToTrack: z.array(z.enum(TIER_FILTERS)).transform((t) => [...new Set(t)]),
  roleKeywords: z.array(keyword).min(1).max(100),
  levelKeywords: z.array(keyword).min(1).max(100),
  excludeKeywords: z.array(keyword).max(100),
  applyLevelToSimplify: z.boolean(),
  /** Off: plain titles like "Software Engineer" count; only seniority is excluded. */
  requireLevelOnBoards: z.boolean(),
  simplifyCategories: z.array(keyword).max(50),
  /** Hide board jobs whose description asks for this many years or more; 0 = off. */
  experienceCutoffYears: z.number().int().min(0).max(20),
  /** The poller stores jobs posted within this many days (the store window). */
  storeWindowDays: z.number().int().min(7).max(120),
  maxJobAgeHours: z.number().int().min(1).max(168),
  pollEveryMinutes: z.number().int().min(5).max(1440),
  pushEveryMinutes: z.number().int().min(5).max(1440),
  quietHours: z.object({ start: hhmm, end: hhmm }),
  minSalaryUsd: z.number().int().min(0),
  emailDigest: z.boolean(),
  /** Validated against the source registry by the API. */
  enabledSources: z.array(z.string().min(1)).transform((s) => [...new Set(s)]),
  showSimplifyJobs: z.boolean(),
  suggestCompanies: z.boolean(),
};

/** Full settings document (every field required). */
export const SettingsSchema = z.object(fields);

export type Settings = z.output<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  locations: [
    {
      label: "NJ",
      aliases: ["nj", "new jersey", "jersey city", "hoboken", "newark", "princeton"],
      enabled: true,
    },
    {
      label: "PA",
      aliases: ["pa", "pennsylvania", "philadelphia", "philly", "pittsburgh"],
      enabled: true,
    },
    {
      label: "NYC",
      aliases: ["nyc", "new york", "brooklyn", "manhattan", "queens", "bronx", "long island city"],
      enabled: true,
    },
    { label: REMOTE_US_LABEL, aliases: [], enabled: true, builtin: "remote_us" },
  ],
  tiersToTrack: ["S", "A", "Mid", "Startup", "Corporate", "Unlisted"],
  roleKeywords: [
    "software",
    "developer",
    "swe",
    "sde",
    "programmer",
    "full stack",
    "fullstack",
    "backend",
    "back end",
    "frontend",
    "front end",
    "web engineer",
    "mobile engineer",
    "ios",
    "android",
    "product engineer",
    "platform engineer",
    "infrastructure engineer",
    "forward deployed engineer",
    "devops",
    "site reliability",
    "sre",
    "machine learning",
    "ml engineer",
    "ai engineer",
    "applied ai",
    "data engineer",
    "research engineer",
    "cloud engineer",
    "automation engineer",
    "founding engineer",
    "member of technical staff",
    "application development",
    "applications development",
  ],
  levelKeywords: [
    "new grad",
    "new graduate",
    "graduate",
    "grad",
    "entry",
    "junior",
    "jr",
    "early career",
    "early talent",
    "emerging talent",
    "university",
    "college",
    "campus",
    "associate",
    "rotational",
    "apprentice",
    "apprenticeship",
    "residency",
    "development program",
    "2026",
    "2027",
  ],
  excludeKeywords: [
    "senior",
    "sr",
    "staff",
    "principal",
    "lead",
    "manager",
    "director",
    "head",
    "vp",
    "vice president",
    "architect",
    "distinguished",
    "intern",
    "internship",
    "co op",
    "postdoc",
    "postdoctoral",
    "scientist",
    "researcher",
    "mid level",
    "intermediate",
    "fellow",
    // Not a full-time role
    "part time",
    "temporary",
    "seasonal",
    "fixed term",
    "contract to hire",
    // Not engineering, even with a role keyword ("Campus Recruiter, Machine Learning")
    "recruiter",
    "designer",
    "educator",
    "phd",
    "customer support",
    "gtm",
    "go to market",
    // "developer" outside software
    "curriculum",
    "instructional",
    "business developer",
    "business development",
    "developer advocate",
    "developer relations",
    "content developer",
  ],
  applyLevelToSimplify: false,
  requireLevelOnBoards: false,
  simplifyCategories: ["Software", "Software Engineering"],
  experienceCutoffYears: 3,
  storeWindowDays: 30,
  maxJobAgeHours: 24,
  // A full poll takes seconds; 10 min is ~390 requests/h across all boards, polite for public APIs
  pollEveryMinutes: 10,
  pushEveryMinutes: 30,
  quietHours: { start: "23:00", end: "07:00" },
  minSalaryUsd: 0,
  emailDigest: false,
  enabledSources: ["greenhouse", "lever", "ashby", "simplify"],
  showSimplifyJobs: true,
  suggestCompanies: true,
};

/** PATCH body: any subset of fields, each replaced wholesale. */
export const SettingsPatchSchema = z.object(fields).partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/**
 * Parse stored settings JSON. Missing or invalid fields fall back to their
 * defaults, so adding a setting never needs a migration.
 */
export const parseStoredSettings = (data: unknown): Settings => {
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const out = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>;
  for (const [key, schema] of Object.entries(fields)) {
    if (!(key in raw)) continue;
    const parsed = schema.safeParse(raw[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Settings;
};

/** How far back the poller stores jobs. */
export const storeWindowMs = (s: Pick<Settings, "storeWindowDays">) => s.storeWindowDays * DAY_MS;

/**
 * The oldest job the poller can store: the store window, or the longer
 * window for explicit entry-level board roles. Also the in-memory dedupe and
 * closure window.
 */
export const maxStoreWindowMs = (s: Pick<Settings, "storeWindowDays">) =>
  Math.max(s.storeWindowDays, ENTRY_LEVEL_STORE_DAYS) * DAY_MS;

/** new/hidden jobs older than this are deleted by cleanup (past anything still storable). */
export const retentionMs = (s: Pick<Settings, "storeWindowDays">) =>
  maxStoreWindowMs(s) + RETENTION_MARGIN_DAYS * DAY_MS;
