import {
  createCompany,
  type Db,
  findCompanyByName,
  getAdapter,
  type HttpClient,
  OTHER_ATS_ID,
  type Registry,
  TIERS,
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
  | { name: string; result: "inserted"; status: string; track: boolean; jobCount?: number };

const UNTRACKED_TIERS = new Set(["S", "A"]);

/**
 * Insert-only seed: existing companies (by normalized name) are never touched.
 * Supported slugs are confirmed with `probe`; failures are kept as needs_review.
 */
export const seedCompanies = async (
  db: Db,
  registry: Registry,
  http: HttpClient,
  entries: readonly SeedEntry[],
): Promise<SeedOutcome[]> => {
  const outcomes: SeedOutcome[] = [];
  for (const entry of entries) {
    if (await findCompanyByName(db, entry.name)) {
      outcomes.push({ name: entry.name, result: "skipped" });
      continue;
    }
    const adapter = getAdapter(registry, entry.ats);
    const base = {
      name: entry.name,
      city: entry.city,
      state: entry.state,
      tier: entry.tier,
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
    const track = Boolean(entry.slug) && !UNTRACKED_TIERS.has(entry.tier) && entry.track !== false;
    await createCompany(db, { ...base, ats: adapter.id, slug: entry.slug, track, status });
    outcomes.push({ name: entry.name, result: "inserted", status, track, jobCount });
  }
  return outcomes;
};
