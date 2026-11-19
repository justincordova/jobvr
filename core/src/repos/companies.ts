import { asc, eq, inArray, or, sql } from "drizzle-orm";
import type { CompanyStatus, Tier, TierSource } from "../constants";
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
  /** Defaults to manual on create: a tier someone picked. */
  tierSource?: TierSource;
  tierReason?: string | null;
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

/** By normalized name, or by one of its aliases (see `mergeCompanyInto`). */
export const findCompanyByName = async (db: DbOrTx, name: string): Promise<CompanyRow | null> => {
  const normalized = normalizeCompanyName(name);
  const rows = await db
    .select()
    .from(companies)
    .where(
      or(eq(companies.normalizedName, normalized), sql`${normalized} = ANY(${companies.aliases})`),
    );
  return rows.find((c) => c.normalizedName === normalized) ?? rows[0] ?? null;
};

export const createCompany = async (db: DbOrTx, input: CompanyInput): Promise<CompanyRow> => {
  const values = {
    name: input.name.trim(),
    normalizedName: normalizeCompanyName(input.name),
    city: clean(input.city),
    state: clean(input.state),
    tier: input.tier,
    tierSource: input.tierSource ?? "manual",
    tierReason: clean(input.tierReason),
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
        tierSource: patch.tierSource ?? current.tierSource,
        tierReason: patch.tierReason !== undefined ? clean(patch.tierReason) : current.tierReason,
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

/**
 * Folds a company into another one that's the same company under another name
 * ("Bank of Montreal" into "BMO"): its jobs move over, its names become
 * aliases (so the lists' jobs keep resolving), and it's deleted. A job board
 * moves along when the other has none; two boards can't merge.
 */
export const mergeCompanyInto = (db: DbOrTx, fromId: string, intoId: string): Promise<CompanyRow> =>
  db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(companies)
      .where(inArray(companies.id, [fromId, intoId]))
      .for("update");
    const from = rows.find((c) => c.id === fromId);
    const into = rows.find((c) => c.id === intoId);
    if (!from || !into || from.id === into.id) throw new NotFoundError("Company not found");
    const fromBoard = from.ats !== OTHER_ATS && Boolean(from.slug);
    const intoBoard = into.ats !== OTHER_ATS && Boolean(into.slug);
    if (fromBoard && intoBoard) throw new ConflictError("Both companies have a job board");

    await tx
      .update(jobs)
      .set({ companyId: into.id, companyName: into.name })
      .where(eq(jobs.companyId, from.id));
    const aliases = [...new Set([...into.aliases, from.normalizedName, ...from.aliases])].filter(
      (a) => a !== into.normalizedName,
    );
    // First, so its board's ats + slug is free for `into`
    await tx.delete(companies).where(eq(companies.id, from.id));
    const [row] = await tx
      .update(companies)
      .set({
        aliases,
        ...(fromBoard && {
          ats: from.ats,
          slug: from.slug,
          track: true,
          status: from.status,
          careersUrl: into.careersUrl ?? from.careersUrl,
        }),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, into.id))
      .returning();
    if (!row) throw new NotFoundError("Company not found");
    return row;
  });

export const deleteCompany = async (db: DbOrTx, id: string): Promise<void> => {
  await db.transaction(async (tx) => {
    // Removing a company is final: auto-add would otherwise add it back from the lists
    await tx.execute(sql`
      UPDATE suggestions s SET state = 'dismissed'
      FROM companies c
      WHERE c.id = ${id} AND (s.id = c.normalized_name OR s.id = ANY(c.aliases))`);
    const deleted = await tx
      .delete(companies)
      .where(eq(companies.id, id))
      .returning({ id: companies.id });
    if (deleted.length === 0) throw new NotFoundError("Company not found");
  });
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
