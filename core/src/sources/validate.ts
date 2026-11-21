import type { z } from "zod";
import { INVALID_ITEM_THRESHOLD } from "../constants";
import { type SourceJob, SourceJobSchema } from "./types";

export class SchemaDriftError extends Error {
  override name = "SchemaDriftError";
}

export interface ValidatedJobs {
  jobs: SourceJob[];
  invalidCount: number;
  /** Lowercased `id` of each invalid item that has one (its job may still be open). */
  invalidIds: string[];
}

/** The raw item's id (`id`, or the source's own key), when it has a usable one. */
const rawId = (item: unknown, key: string): string | null => {
  const id = item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined;
  return typeof id === "string" || typeof id === "number" ? String(id).toLowerCase() : null;
};

/**
 * Parses each raw item with `raw`, maps it, and validates the result as a
 * SourceJob. Invalid items are skipped and counted; if more than half of a
 * non-empty response is invalid the response is rejected (likely schema drift).
 * `map` may return null to drop an item deliberately (not counted as invalid).
 * `idKey` names the raw field holding the posting id (Workable's `shortcode`),
 * so an invalid item's job isn't closed and the rest of the board's closures run.
 */
export const validateItems = <R extends z.ZodType>(
  source: string,
  items: unknown[],
  raw: R,
  map: (item: z.output<R>) => SourceJob | null,
  onInvalid?: (index: number, error: unknown) => void,
  idKey = "id",
): ValidatedJobs => {
  const jobs: SourceJob[] = [];
  let invalidCount = 0;
  const invalidIds: string[] = [];
  const invalid = (item: unknown, index: number, error: unknown) => {
    invalidCount++;
    const id = rawId(item, idKey);
    if (id !== null) invalidIds.push(id);
    onInvalid?.(index, error);
  };
  for (const [index, item] of items.entries()) {
    const parsed = raw.safeParse(item);
    if (!parsed.success) {
      invalid(item, index, parsed.error);
      continue;
    }
    let mapped: SourceJob | null;
    try {
      mapped = map(parsed.data);
    } catch (err) {
      invalid(item, index, err);
      continue;
    }
    if (mapped === null) continue;
    const job = SourceJobSchema.safeParse(mapped);
    if (!job.success) {
      invalid(item, index, job.error);
      continue;
    }
    jobs.push(job.data);
  }
  if (items.length > 0 && invalidCount / items.length > INVALID_ITEM_THRESHOLD) {
    throw new SchemaDriftError(
      `${source}: ${invalidCount} of ${items.length} items failed validation`,
    );
  }
  return { jobs, invalidCount, invalidIds };
};

/** Parses an ISO timestamp, throwing on garbage (so the item counts as invalid). */
export const parseDate = (value: string | number): Date => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
};
