import {
  createCompany,
  type Db,
  findCompanyByName,
  getAdapter,
  type HttpClient,
  OTHER_ATS_ID,
  type Registry,
  TIERS,
  updateCompany,
} from "@jobvr/core";
import { z } from "zod";

export const SeedEntrySchema = z.object({
  name: z.string().trim().min(1),
  city: z.string().nullish(),
  state: z.string().nullish(),
  tier: z.enum(TIERS),
  ats: z.string().min(1),
  slug: z.string().trim().min(1).nullish(),
  careersUrl: z.string().nullish(),
  notes: z.string().nullish(),
  /** Only `false` has an effect (e.g. reference-only companies). */
  track: z.boolean().optional(),
});

export type SeedEntry = z.infer<typeof SeedEntrySchema>;

export type SeedOutcome =
  | { name: string; result: "skipped" }
  | {
      name: string;
      result: "inserted" | "upgraded";
      status: string;
      track: boolean;
      jobCount?: number;
    };

/**
 * Insert-only seed: existing companies (by normalized name) are left alone,
 * with one exception: a company still stored as manual-only "other" is moved
 * to its supported board when the seed now names one and the board answers
 * (the PC picks up seed fixes such as HRT moving to Greenhouse). Supported
 * slugs are confirmed with `probe`; failures are kept as needs_review.
 */
export const seedCompanies = async (
  db: Db,
  registry: Registry,
  http: HttpClient,
  entries: readonly SeedEntry[],
): Promise<SeedOutcome[]> => {
  const outcomes: SeedOutcome[] = [];
  for (const entry of entries) {
    const adapter = getAdapter(registry, entry.ats);
    const existing = await findCompanyByName(db, entry.name);
    if (existing) {
      const upgradable =
        existing.ats === OTHER_ATS_ID &&
        existing.status === "manual_only" &&
        adapter?.kind === "ats" &&
        entry.slug &&
        adapter.probe;
      const probe = upgradable
        ? await adapter.probe?.(entry.slug ?? "", { http }).catch(() => null)
        : null;
      if (!adapter || !entry.slug || !probe?.found) {
        outcomes.push({ name: entry.name, result: "skipped" });
        continue;
      }
      const track = entry.track !== false;
      await updateCompany(db, existing.id, {
        ats: adapter.id,
        slug: entry.slug,
        track,
        status: "ok",
        ...(entry.notes && { notes: entry.notes }),
        ...(entry.careersUrl && { careersUrl: entry.careersUrl }),
      });
      outcomes.push({
        name: entry.name,
        result: "upgraded",
        status: "ok",
        track,
        jobCount: probe.jobCount,
      });
      continue;
    }
    const base = {
      name: entry.name,
      city: entry.city,
      state: entry.state,
      tier: entry.tier,
      tierSource: "seed" as const,
      careersUrl: entry.careersUrl,
      notes: entry.notes,
    };

    if (adapter?.kind !== "ats") {
      await createCompany(db, {
        ...base,
        ats: OTHER_ATS_ID,
        slug: null,
        track: false,
        status: "manual_only",
      });
      outcomes.push({ name: entry.name, result: "inserted", status: "manual_only", track: false });
      continue;
    }

    let status: "ok" | "needs_review" = "needs_review";
    let jobCount: number | undefined;
    if (entry.slug && adapter.probe) {
      try {
        const probe = await adapter.probe(entry.slug, { http });
        if (probe.found) {
          status = "ok";
          jobCount = probe.jobCount;
        }
      } catch {
        status = "needs_review";
      }
    }
    const track = Boolean(entry.slug) && entry.track !== false;
    await createCompany(db, { ...base, ats: adapter.id, slug: entry.slug, track, status });
    outcomes.push({ name: entry.name, result: "inserted", status, track, jobCount });
  }
  return outcomes;
};
