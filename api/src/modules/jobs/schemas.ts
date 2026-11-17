import { z } from "@hono/zod-openapi";
import {
  JOB_AGES,
  JOB_SORTS,
  JOB_STATES,
  JOB_VIEWS,
  MAX_JOBS_LIMIT,
  TIER_FILTERS,
} from "@jobvr/core";
import { csv, envelope, isoNullable } from "@/lib/routes";

export const JobSourceSchema = z.object({
  source: z.string(),
  url: z.string(),
  title: z.string(),
  category: z.string().nullable(),
  removedAt: isoNullable,
  /** Years of experience the description asks for: null = not checked, 0 = none named. */
  requiredYears: z.number().int().nullable(),
});

export const JobSchema = z
  .object({
    id: z.string().openapi({ example: "gh:8403107002" }),
    title: z.string(),
    companyId: z.uuid().nullable(),
    companyName: z.string(),
    tier: z.enum(TIER_FILTERS),
    locations: z.array(z.string()),
    url: z.string(),
    primarySource: z.string(),
    firstSeenAt: z.iso.datetime(),
    effectiveAt: z.iso.datetime(),
    salaryMinUsd: z.number().int().nullable(),
    salaryMaxUsd: z.number().int().nullable(),
    state: z.enum(JOB_STATES),
    baseline: z.boolean(),
    closedAt: isoNullable,
    isNew: z.boolean(),
    entryLevel: z.boolean(),
    /** The location strings that match an enabled location (shown first). */
    matchedLocations: z.array(z.string()),
    /** Other postings of the same role (same company, title, and locations); actions apply to all. */
    duplicateIds: z.array(z.string()),
    /** "Best first" points: freshness, entry level, tier, place (see SPEC). */
    score: z.number().int(),
    sources: z.array(JobSourceSchema),
  })
  .openapi("Job");

export const JobListQuery = z.object({
  view: z.enum(JOB_VIEWS).optional(),
  age: z.enum(JOB_AGES).optional(),
  location: csv(z.string()).openapi({ example: "NYC,Remote-US" }),
  company: csv(z.string()).openapi({ example: "unlisted" }),
  tier: csv(z.enum(TIER_FILTERS)).openapi({ example: "Startup,Mid" }),
  source: csv(z.string()).openapi({ example: "greenhouse,simplify" }),
  /** `entry`: only jobs flagged entry level. */
  level: z.enum(["entry"]).optional(),
  /** `best` (feed default) or `newest` (default elsewhere). */
  sort: z.enum(JOB_SORTS).optional(),
  /** Text search: every word must start a word of the title, company or locations. */
  q: z.string().trim().max(200).optional(),
  /** Rows to return (default 500). `total` in the response says how many matched. */
  limit: z.coerce.number().int().min(1).max(MAX_JOBS_LIMIT).optional(),
});

export const JobListResponse = envelope(
  z.object({
    jobs: z.array(JobSchema),
    /** Rows matching the view, filters and search, before `limit`. */
    total: z.number().int(),
    lastVisitAt: isoNullable,
    newSinceLastVisit: z.number().int(),
  }),
);

export const JobDetailsResponse = envelope(
  z
    .object({
      id: z.string(),
      source: z.string().nullable(),
      description: z.string().nullable(),
      keyLines: z.array(
        z.object({
          topic: z.enum(["experience", "degree", "visa", "workplace", "pay"]),
          text: z.string(),
        }),
      ),
    })
    .openapi("JobDetails"),
);

export const JobParams = z.object({
  id: z
    .string()
    .min(1)
    .max(200)
    .openapi({ param: { name: "id", in: "path" }, example: "gh:8403107002" }),
});

export const JobStateBody = z.object({ state: z.enum(JOB_STATES) }).openapi("JobStateBody");
