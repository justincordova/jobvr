import type { z } from "zod";
import { INVALID_ITEM_THRESHOLD } from "../constants";
import { type SourceJob, SourceJobSchema } from "./types";

export class SchemaDriftError extends Error {
  override name = "SchemaDriftError";
}

export interface ValidatedJobs {
  jobs: SourceJob[];
  invalidCount: number;
}

/**
 * Parses each raw item with `raw`, maps it, and validates the result as a
 * SourceJob. Invalid items are skipped and counted; if more than half of a
 * non-empty response is invalid the response is rejected (likely schema drift).
 * `map` may return null to drop an item deliberately (not counted as invalid).
 */
export const validateItems = <R extends z.ZodType>(
  source: string,
  items: unknown[],
  raw: R,
  map: (item: z.output<R>) => SourceJob | null,
  onInvalid?: (index: number, error: unknown) => void,
): ValidatedJobs => {
  const jobs: SourceJob[] = [];
  let invalidCount = 0;
  items.forEach((item, index) => {
    const parsed = raw.safeParse(item);
    if (!parsed.success) {
      invalidCount++;
      onInvalid?.(index, parsed.error);
      return;
    }
    let mapped: SourceJob | null;
    try {
      mapped = map(parsed.data);
    } catch (err) {
      invalidCount++;
      onInvalid?.(index, err);
      return;
    }
    if (mapped === null) return;
    const job = SourceJobSchema.safeParse(mapped);
    if (!job.success) {
      invalidCount++;
      onInvalid?.(index, job.error);
      return;
    }
    jobs.push(job.data);
  });
  if (items.length > 0 && invalidCount / items.length > INVALID_ITEM_THRESHOLD) {
    throw new SchemaDriftError(
      `${source}: ${invalidCount} of ${items.length} items failed validation`,
    );
  }
  return { jobs, invalidCount };
};

/** Parses an ISO timestamp, throwing on garbage (so the item counts as invalid). */
export const parseDate = (value: string | number): Date => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
};
