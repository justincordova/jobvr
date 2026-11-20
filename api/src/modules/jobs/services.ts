import type { z } from "@hono/zod-openapi";
import type { JobWithFlags } from "@jobvr/core";
import { iso, isoOrNull } from "@/lib/routes";
import type { JobSchema } from "./schemas";

export const toJobDto = (j: JobWithFlags): z.infer<typeof JobSchema> => ({
  id: j.id,
  title: j.title,
  companyId: j.companyId,
  companyName: j.companyName,
  tier: j.tier,
  locations: j.locations,
  url: j.url,
  primarySource: j.primarySource,
  firstSeenAt: iso(j.firstSeenAt),
  effectiveAt: iso(j.effectiveAt),
  salaryMinUsd: j.salaryMinUsd,
  salaryMaxUsd: j.salaryMaxUsd,
  state: j.state,
  // Kept in the database after an undo; it only means something while applied
  appliedAt: j.state === "applied" ? isoOrNull(j.appliedAt) : null,
  baseline: j.baseline,
  closedAt: isoOrNull(j.closedAt),
  isNew: j.isNew,
  entryLevel: j.entryLevel,
  matchedLocations: j.matchedLocations,
  duplicateIds: j.duplicateIds,
  score: j.score,
  sources: j.sources.map((s) => ({ ...s, removedAt: isoOrNull(s.removedAt) })),
});
