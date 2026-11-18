import { z } from "zod";
import type { HttpClient } from "../http";

/** Validated against the registry at runtime ("greenhouse" | "lever" | "ashby" | "simplify" today). */
export type SourceId = string;

export const SalarySchema = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  currency: z.string().min(1),
  interval: z.enum(["hour", "week", "month", "year"]),
});

export const SourceJobSchema = z.object({
  source: z.string().min(1),
  sourceJobId: z.string().min(1),
  companyName: z.string().min(1),
  companySlug: z.string().min(1).optional(),
  title: z.string().trim().min(1),
  locations: z.array(z.string()),
  // http(s) only: the URL becomes a link in the feed and the push
  url: z.url({ protocol: /^https?$/ }),
  postedAt: z.date(),
  postedAtPrecision: z.enum(["instant", "day"]),
  salary: SalarySchema.optional(),
  /** Plain-text description, when the listing endpoint includes one. */
  description: z.string().optional(),
  meta: z
    .object({
      active: z.boolean().optional(),
      visible: z.boolean().optional(),
      category: z.string().optional(),
    })
    .optional(),
});

export type Salary = z.infer<typeof SalarySchema>;
export type SourceJob = z.infer<typeof SourceJobSchema>;

export interface FetchCtx {
  slug?: string;
  companyName?: string;
  etag?: string | null;
  signal?: AbortSignal;
  http: HttpClient;
}

export interface ProbeCtx {
  signal?: AbortSignal;
  http: HttpClient;
}

export type FetchResult =
  | { status: "not_modified" }
  | {
      status: "ok";
      etag: string | null;
      jobs: SourceJob[];
      invalidCount: number;
      /** Lowercased ids of invalid items that had one; their rows are neither closed nor reopened. */
      invalidIds?: string[];
    };

/** What `fetchDetail` adds to a listing. */
export interface JobDetail {
  description: string;
  salary?: Salary;
}

export interface ParsedUrl {
  sourceJobId: string;
  slug?: string;
}

export interface SourceAdapter {
  id: SourceId;
  /** UI name, e.g. "SimplifyJobs". */
  label: string;
  /** ats: one fetch per company slug; aggregator: one global fetch. */
  kind: "ats" | "aggregator";
  /** Canonical ID prefix: "gh" | "lv" | "ab" | "sj" | "sa" | "jr". */
  idPrefix: string;
  /** Max in-flight fetches for this source. */
  concurrency: number;
  fetch(ctx: FetchCtx): Promise<FetchResult>;
  /**
   * For sources whose listing endpoint has no description (Greenhouse): one
   * job's description and pay. runPoll calls it only for listings that pass the
   * poll filter and haven't been checked yet. Null when the job is gone.
   */
  fetchDetail?(slug: string, sourceJobId: string, ctx: ProbeCtx): Promise<JobDetail | null>;
  /**
   * Aggregators whose links go to their own page, not the posting (Jobright):
   * a job they found takes the link of any other list that has it.
   */
  indirectLinks?: boolean;
  /** ATS adapters only. */
  parseUrl?(url: string): ParsedUrl | null;
  /** ATS adapters only: the board slug in a board or job link on this ATS, else null. */
  boardSlug?(url: string): string | null;
  /** ATS adapters only; used by `discover` and `seed`. */
  probe?(slug: string, ctx: ProbeCtx): Promise<{ found: boolean; jobCount: number }>;
}

export type Registry = readonly SourceAdapter[];
