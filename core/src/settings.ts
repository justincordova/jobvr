import { z } from "zod";
import { TIER_FILTERS } from "./constants";

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
  simplifyCategories: z.array(keyword).max(50),
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
    { label: "NJ", aliases: ["nj", "new jersey"], enabled: true },
    { label: "PA", aliases: ["pa", "pennsylvania", "philadelphia", "pittsburgh"], enabled: true },
    { label: "NYC", aliases: ["nyc", "new york", "brooklyn", "manhattan"], enabled: true },
    { label: REMOTE_US_LABEL, aliases: [], enabled: true, builtin: "remote_us" },
  ],
  tiersToTrack: ["Mid", "Startup", "Corporate", "Unlisted"],
  roleKeywords: [
    "software",
    "engineer",
    "engineering",
    "developer",
    "swe",
    "sde",
    "programmer",
    "full stack",
    "fullstack",
    "backend",
    "frontend",
  ],
  levelKeywords: [
    "new grad",
    "entry",
    "junior",
    "early career",
    "associate",
    "graduate",
    "software engineer i",
  ],
  excludeKeywords: [
    "senior",
    "sr.",
    "staff",
    "principal",
    "lead",
    "manager",
    "director",
    "iii",
    "ii",
    "intern",
    "internship",
  ],
  applyLevelToSimplify: false,
  simplifyCategories: ["Software", "Software Engineering"],
  maxJobAgeHours: 24,
  pollEveryMinutes: 15,
  pushEveryMinutes: 60,
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
