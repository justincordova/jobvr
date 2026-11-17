import { createHash } from "node:crypto";
import type { JobRow, JobSourceRow } from "../db/schema";

/**
 * A source row as the poll keeps it in memory: the description (up to 20k
 * chars) only as its MD5, enough to tell whether it changed. Matches
 * Postgres's `md5(description)`.
 */
export type MemSourceRow = Omit<JobSourceRow, "description"> & { descriptionMd5: string | null };

export const descriptionMd5 = (text: string | null): string | null =>
  text === null ? null : createHash("md5").update(text, "utf8").digest("hex");

export interface MemJob {
  job: JobRow;
  sources: MemSourceRow[];
}

export type JobMap = Map<string, MemJob>;

const sourceKey = (source: string, sourceJobId: string) => `${source}\u0000${sourceJobId}`;

const cloneJob = (m: MemJob): MemJob => ({
  job: { ...m.job, locations: [...m.job.locations] },
  sources: m.sources.map((s) => ({ ...s })),
});

/**
 * Copy-on-write view of the in-memory job window for one target. Jobs are
 * cloned the first time they're touched; `commit()` yields the new window and
 * discarding the working set rolls everything back.
 */
export class WorkingSet {
  private readonly jobs: JobMap;
  private readonly touched = new Set<string>();
  private readonly bySource = new Map<string, string>();
  private readonly byUrlKey = new Map<string, Set<string>>();

  constructor(base: JobMap) {
    this.jobs = new Map(base);
    for (const [id, m] of this.jobs) {
      for (const s of m.sources) this.indexRow(id, s);
    }
  }

  private indexRow(jobId: string, row: MemSourceRow) {
    this.bySource.set(sourceKey(row.source, row.sourceJobId), jobId);
    if (row.urlKey) {
      let set = this.byUrlKey.get(row.urlKey);
      if (!set) {
        set = new Set();
        this.byUrlKey.set(row.urlKey, set);
      }
      set.add(jobId);
    }
  }

  private unindexRow(jobId: string, row: MemSourceRow) {
    const key = sourceKey(row.source, row.sourceJobId);
    if (this.bySource.get(key) === jobId) this.bySource.delete(key);
    if (row.urlKey) {
      const set = this.byUrlKey.get(row.urlKey);
      // Another row of the same job may share the url key
      const job = this.jobs.get(jobId);
      if (set && !job?.sources.some((s) => s !== row && s.urlKey === row.urlKey)) {
        set.delete(jobId);
      }
    }
  }

  get(id: string): MemJob | undefined {
    return this.jobs.get(id);
  }

  values(): IterableIterator<MemJob> {
    return this.jobs.values();
  }

  /** Mutable copy of a job (cloned on first touch). */
  touch(id: string): MemJob {
    const current = this.jobs.get(id);
    if (!current) throw new Error(`job ${id} not in working set`);
    if (this.touched.has(id)) return current;
    const copy = cloneJob(current);
    this.jobs.set(id, copy);
    this.touched.add(id);
    return copy;
  }

  add(job: JobRow, row: MemSourceRow): void {
    this.jobs.set(job.id, { job, sources: [row] });
    this.touched.add(job.id);
    this.indexRow(job.id, row);
  }

  remove(id: string): void {
    const m = this.jobs.get(id);
    if (!m) return;
    for (const s of m.sources) this.unindexRow(id, s);
    this.jobs.delete(id);
  }

  jobIdForSource(source: string, sourceJobId: string): string | undefined {
    return this.bySource.get(sourceKey(source, sourceJobId));
  }

  jobIdsForUrlKey(key: string): string[] {
    return [...(this.byUrlKey.get(key) ?? [])];
  }

  /**
   * Upserts a source row onto `jobId`. Returns the id of the job the row was
   * moved from (if it previously belonged to a different job).
   */
  upsertRow(jobId: string, row: MemSourceRow): string | undefined {
    const previous = this.jobIdForSource(row.source, row.sourceJobId);
    if (previous && previous !== jobId && this.jobs.has(previous)) {
      const old = this.touch(previous);
      const existing = old.sources.find(
        (s) => s.source === row.source && s.sourceJobId === row.sourceJobId,
      );
      if (existing) {
        this.unindexRow(previous, existing);
        old.sources = old.sources.filter((s) => s !== existing);
      }
    }
    const target = this.touch(jobId);
    const index = target.sources.findIndex(
      (s) => s.source === row.source && s.sourceJobId === row.sourceJobId,
    );
    if (index >= 0) {
      const existing = target.sources[index];
      if (existing) this.unindexRow(jobId, existing);
      target.sources[index] = row;
    } else {
      target.sources.push(row);
    }
    this.indexRow(jobId, row);
    return previous && previous !== jobId ? previous : undefined;
  }

  commit(): JobMap {
    return this.jobs;
  }
}
