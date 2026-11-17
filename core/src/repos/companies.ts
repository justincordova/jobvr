import { asc, eq, inArray, sql } from "drizzle-orm";
import type { CompanyStatus, Tier } from "../constants";
import type { DbOrTx } from "../db/client";
import { type CompanyRow, companies, jobs, type SourceStateRow, sourceState } from "../db/schema";
import { ConflictError, InvalidError, isUniqueViolation, NotFoundError } from "../errors";
import { normalizeCompanyName } from "../normalize";

export const OTHER_ATS = "other";

export interface CompanyInput {
  name: string;
  city?: string | null;
  state?: string | null;
  tier: Tier;
  track: boolean;
  ats: string;
  slug?: string | null;
  careersUrl?: string | null;
  notes?: string | null;
  status: CompanyStatus;
}

export type CompanyPatch = Partial<CompanyInput>;

export interface CompanyHealth {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
}

/** What a company's board has produced: matching roles, from any source. */
export interface CompanyStats {
  /** Stored roles posted in the last 30 days (any state, including closed). */
  roles30d: number;
  /** When its newest stored role was posted; null if none is stored. */
  lastRoleAt: Date | null;
}

export type CompanyWithHealth = CompanyRow & { health: CompanyHealth | null; stats: CompanyStats };

export const companyStateKey = (companyId: string) => `company:${companyId}`;

/** Returns a message describing the first violated invariant, or null. */
export const checkCompanyInvariants = (c: {
  ats: string;
  slug?: string | null;
  track: boolean;
  status: CompanyStatus;
}): string | null => {
  if (c.ats === OTHER_ATS && c.status !== "manual_only") {
    return "Companies on an unsupported ATS must have status manual_only";
  }
  if (c.ats === OTHER_ATS && c.track) return "Companies on an unsupported ATS can't be tracked";
  if (c.ats !== OTHER_ATS && !c.slug && c.track) return "A company needs a slug to be tracked";
  return null;
};

const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

const toHealth = (s: SourceStateRow | null): CompanyHealth | null =>
  s
    ? {
        lastAttemptAt: s.lastAttemptAt,
        lastSuccessAt: s.lastSuccessAt,
        consecutiveFailures: s.consecutiveFailures,
        lastError: s.lastError,
      }
    : null;

const conflict = () =>
  new ConflictError("A company with the same name or the same ATS + slug already exists");

export const listCompanies = (db: DbOrTx): Promise<CompanyRow[]> =>
  db.select().from(companies).orderBy(asc(companies.name));

export const listCompaniesWithHealth = async (
  db: DbOrTx,
  id?: string,
  now: Date = new Date(),
): Promise<CompanyWithHealth[]> => {
  const rows = await db
    .select({ company: companies, state: sourceState })
    .from(companies)
    .leftJoin(sourceState, eq(sourceState.key, sql`'company:' || ${companies.id}::text`))
    .where(id ? eq(companies.id, id) : undefined)
    .orderBy(asc(companies.name));
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const counts = await db
    .select({
      companyId: jobs.companyId,
      roles30d: sql<number>`(count(*) filter (where ${jobs.effectiveAt} >= ${since}))::int`,
      lastRoleAt: sql<Date | null>`max(${jobs.effectiveAt})`.mapWith(jobs.effectiveAt),
    })
    .from(jobs)
    .where(id ? eq(jobs.companyId, id) : sql`${jobs.companyId} is not null`)
    .groupBy(jobs.companyId);
  const byCompany = new Map(counts.map((c) => [c.companyId, c]));
  return rows.map((r) => {
    const c = byCompany.get(r.company.id);
    return {
      ...r.company,
      health: toHealth(r.state),
      stats: { roles30d: c?.roles30d ?? 0, lastRoleAt: c?.lastRoleAt ?? null },
    };
  });
};

export const getCompany = async (db: DbOrTx, id: string): Promise<CompanyRow | null> =>
  (await db.select().from(companies).where(eq(companies.id, id)))[0] ?? null;

export const findCompanyByName = async (db: DbOrTx, name: string): Promise<CompanyRow | null> =>
  (
    await db
      .select()
      .from(companies)
      .where(eq(companies.normalizedName, normalizeCompanyName(name)))
  )[0] ?? null;

export const createCompany = async (db: DbOrTx, input: CompanyInput): Promise<CompanyRow> => {
  const values = {
    name: input.name.trim(),
    normalizedName: normalizeCompanyName(input.name),
    city: clean(input.city),
    state: clean(input.state),
    tier: input.tier,
    track: input.track,
    ats: input.ats,
    slug: clean(input.slug),
    careersUrl: clean(input.careersUrl),
    notes: clean(input.notes),
    status: input.status,
  };
  if (!values.normalizedName) throw new InvalidError("Company name is empty");
  const violation = checkCompanyInvariants(values);
  if (violation) throw new InvalidError(violation);
  try {
    const [row] = await db.insert(companies).values(values).returning();
    if (!row) throw new Error("insert returned no row");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict();
    throw err;
  }
};

/**
 * Updates a company under a row lock (so it can't interleave with a poll
 * target's transaction). Changing `ats` or `slug` deletes its source state so
 * the next poll starts with a fresh baseline; setting status `ok` resets failures.
 */
export const updateCompany = async (
  db: DbOrTx,
  id: string,
  patch: CompanyPatch,
): Promise<CompanyRow> => {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(companies).where(eq(companies.id, id)).for("update");
      if (!current) throw new NotFoundError("Company not found");

      const next = {
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        city: patch.city !== undefined ? clean(patch.city) : current.city,
        state: patch.state !== undefined ? clean(patch.state) : current.state,
        tier: patch.tier ?? current.tier,
        track: patch.track ?? current.track,
        ats: patch.ats ?? current.ats,
        slug: patch.slug !== undefined ? clean(patch.slug) : current.slug,
        careersUrl: patch.careersUrl !== undefined ? clean(patch.careersUrl) : current.careersUrl,
        notes: patch.notes !== undefined ? clean(patch.notes) : current.notes,
        status: (patch.status ?? current.status) as CompanyStatus,
      };
      const normalizedName = normalizeCompanyName(next.name);
      if (!normalizedName) throw new InvalidError("Company name is empty");
      const violation = checkCompanyInvariants(next);
      if (violation) throw new InvalidError(violation);

      const [row] = await tx
        .update(companies)
        .set({ ...next, normalizedName, updatedAt: new Date() })
        .where(eq(companies.id, id))
        .returning();
      if (!row) throw new NotFoundError("Company not found");

      const key = companyStateKey(id);
      if (next.ats !== current.ats || next.slug !== current.slug) {
        await tx.delete(sourceState).where(eq(sourceState.key, key));
      } else if (patch.status === "ok") {
        await tx
          .update(sourceState)
          .set({ consecutiveFailures: 0 })
          .where(eq(sourceState.key, key));
      }
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict();
    throw err;
  }
};

export const deleteCompany = async (db: DbOrTx, id: string): Promise<void> => {
  const deleted = await db
    .delete(companies)
    .where(eq(companies.id, id))
    .returning({ id: companies.id });
  if (deleted.length === 0) throw new NotFoundError("Company not found");
};

/** Health of non-company targets (aggregators), keyed by source id. */
export const getSourceHealth = async (
  db: DbOrTx,
  keys: readonly string[],
): Promise<Map<string, CompanyHealth>> => {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select()
    .from(sourceState)
    .where(inArray(sourceState.key, [...keys]));
  return new Map(rows.map((r) => [r.key, toHealth(r) as CompanyHealth]));
};
