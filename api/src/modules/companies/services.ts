import type { z } from "@hono/zod-openapi";
import {
  atsValues,
  type CompanyRow,
  type CompanyStatus,
  type CompanyWithHealth,
  InvalidError,
  OTHER_ATS_ID,
  type Registry,
  type Tier,
} from "@jobvr/core";
import { iso, isoOrNull } from "@/lib/routes";
import type { CompanySchema, CreateCompanyBody } from "./schemas";

export const toCompanyDto = (
  c: CompanyRow,
  health: CompanyWithHealth["health"] = null,
): z.infer<typeof CompanySchema> => ({
  id: c.id,
  name: c.name,
  city: c.city,
  state: c.state,
  tier: c.tier as Tier,
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
  const track =
    body.track ??
    (!other &&
      Boolean(body.slug) &&
      status !== "manual_only" &&
      body.tier !== "S" &&
      body.tier !== "A");
  return { ...body, status, track };
};
