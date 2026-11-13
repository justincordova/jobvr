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
  url: z.url(),
  postedAt: z.date(),
  postedAtPrecision: z.enum(["instant", "day"]),
  salary: SalarySchema.optional(),
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
  | { status: "ok"; etag: string | null; jobs: SourceJob[]; invalidCount: number };

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
  /** Canonical ID prefix: "gh" | "lv" | "ab" | "sj". */
  idPrefix: string;
  /** Max in-flight fetches for this source. */
  concurrency: number;
  fetch(ctx: FetchCtx): Promise<FetchResult>;
  /** ATS adapters only. */
  parseUrl?(url: string): ParsedUrl | null;
  /** ATS adapters only; used by `discover` and `seed`. */
  probe?(slug: string, ctx: ProbeCtx): Promise<{ found: boolean; jobCount: number }>;
}

export type Registry = readonly SourceAdapter[];
