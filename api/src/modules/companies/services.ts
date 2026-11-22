import type { z } from "@hono/zod-openapi";
import {
  atsValues,
  type CompanyRow,
  type CompanyStatus,
  type CompanyWithHealth,
  type Database,
  InvalidError,
  listCompaniesWithHealth,
  OTHER_ATS_ID,
  type Registry,
  type Tier,
  type TierSource,
} from "@jobvr/core";
import { iso, isoOrNull } from "@/lib/routes";
import type { CompanySchema, CreateCompanyBody } from "./schemas";

/** A company as the API returns it, with its board health and role stats. */
export const withHealth = async (db: Database["db"], id: string) => {
  const [found] = await listCompaniesWithHealth(db, id);
  if (!found) throw new Error("company vanished after write");
  return toCompanyDto(found, found.health, found.stats);
};

export const toCompanyDto = (
  c: CompanyRow,
  health: CompanyWithHealth["health"] = null,
  stats: CompanyWithHealth["stats"] = { roles30d: 0, lastRoleAt: null },
): z.infer<typeof CompanySchema> => ({
  id: c.id,
  name: c.name,
  city: c.city,
  state: c.state,
  tier: c.tier as Tier,
  tierSource: c.tierSource as TierSource,
  tierReason: c.tierReason,
  track: c.track,
  ats: c.ats,
  slug: c.slug,
  careersUrl: c.careersUrl,
  notes: c.notes,
  status: c.status as CompanyStatus,
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
  health: health && {
    lastAttemptAt: isoOrNull(health.lastAttemptAt),
    lastSuccessAt: isoOrNull(health.lastSuccessAt),
    consecutiveFailures: health.consecutiveFailures,
    lastError: health.lastError,
  },
  stats: { roles30d: stats.roles30d, lastRoleAt: isoOrNull(stats.lastRoleAt) },
});

export const assertKnownAts = (registry: Registry, ats: string | undefined) => {
  if (ats !== undefined && !atsValues(registry).includes(ats)) {
    throw new InvalidError(
      `Unknown ATS "${ats}" (expected one of ${atsValues(registry).join(", ")})`,
    );
  }
};

/** Fills in status/track defaults that satisfy the company invariants. */
export const withCreateDefaults = (body: z.infer<typeof CreateCompanyBody>) => {
  const other = body.ats === OTHER_ATS_ID;
  const status: CompanyStatus = body.status ?? (other ? "manual_only" : "ok");
  // Any tier: S and A are the companies most worth polling
  const track = body.track ?? (!other && Boolean(body.slug) && status !== "manual_only");
  return { ...body, status, track };
};
