import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { CompanyStatus, Tier, TierSource } from "../constants";
import type { DbOrTx } from "../db/client";
import {
  type CompanyRow,
  companies,
  jobs,
  type SourceStateRow,
  sourceState,
  suggestions,
} from "../db/schema";
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

/**
 * Jobs already stored under this company's name (or an alias) but linked to
 * no company (a list job seen before the company was added). The poll links
 * them only when it re-reads their list, and an unchanged list isn't re-read.
 */
const linkUnlinkedJobs = async (db: DbOrTx, company: CompanyRow): Promise<void> => {
  const names = new Set([company.normalizedName, ...company.aliases]);
  // Narrowed in SQL by each name's longest word (any name that normalizes to it contains it)
  const words = [...names].map(
    (n) =>
      n
        .split(" ")
        .filter((w) => w !== "and")
        .sort((a, b) => b.length - a.length)[0],
  );
  if (words.some((w) => !w)) return;
  const unlinked = await db
    .select({ id: jobs.id, companyName: jobs.companyName })
    .from(jobs)
    .where(
      and(
        isNull(jobs.companyId),
        or(...words.map((w) => sql`strpos(lower(${jobs.companyName}), ${w}) > 0`)),
      ),
    );
  const ids = unlinked
    .filter((j) => names.has(normalizeCompanyName(j.companyName)))
    .map((j) => j.id);
  if (ids.length === 0) return;
  await db
    .update(jobs)
    .set({ companyId: company.id, companyName: company.name })
    .where(inArray(jobs.id, ids));
};

/** Every write that changes `status` sets this alongside it. */
const needsReviewSince = (
  status: string,
  current: { status: string; needsReviewSince: Date | null } | null,
  now: Date,
): Date | null =>
  status !== "needs_review"
    ? null
    : current?.status === "needs_review"
      ? (current.needsReviewSince ?? now)
      : now;

/** The note auto-add leaves on the companies it adds (anything else was added by a person). */
export const AUTO_ADDED_NOTE = "Added automatically";

/** Added by auto-add with a tier nobody picked: the only kind the AI may fold into another. */
export const isAutoAdded = (c: Pick<CompanyRow, "notes" | "tierSource">): boolean =>
  (c.tierSource === "pending" || c.tierSource === "auto") &&
  Boolean(c.notes?.startsWith(AUTO_ADDED_NOTE));

/** Creates the company and links its stored list jobs, in one transaction. */
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
    needsReviewSince: needsReviewSince(input.status, null, new Date()),
  };
  if (!values.normalizedName) throw new InvalidError("Company name is empty");
  const violation = checkCompanyInvariants(values);
  if (violation) throw new InvalidError(violation);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(companies).values(values).returning();
      if (!row) throw new Error("insert returned no row");
      await linkUnlinkedJobs(tx, row);
      return row;
    });
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

      const ats = patch.ats ?? current.ats;
      // Moving onto a readable board (or off one) changes what the status must be:
      // a board left `manual_only` would never be polled
      const movedStatus: CompanyStatus | null =
        ats === current.ats ? null : ats === OTHER_ATS ? "manual_only" : "ok";
      const next = {
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        city: patch.city !== undefined ? clean(patch.city) : current.city,
        state: patch.state !== undefined ? clean(patch.state) : current.state,
        tier: patch.tier ?? current.tier,
        tierSource: patch.tierSource ?? current.tierSource,
        tierReason: patch.tierReason !== undefined ? clean(patch.tierReason) : current.tierReason,
        track: patch.track ?? (ats === OTHER_ATS ? false : current.track),
        ats,
        slug: patch.slug !== undefined ? clean(patch.slug) : current.slug,
        careersUrl: patch.careersUrl !== undefined ? clean(patch.careersUrl) : current.careersUrl,
        notes: patch.notes !== undefined ? clean(patch.notes) : current.notes,
        status: (patch.status ?? movedStatus ?? current.status) as CompanyStatus,
      };
      const normalizedName = normalizeCompanyName(next.name);
      if (!normalizedName) throw new InvalidError("Company name is empty");
      const violation = checkCompanyInvariants(next);
      if (violation) throw new InvalidError(violation);

      // Renamed: the lists still use the old name, so it stays an alias (else auto-add
      // would bring the old name back as a second company)
      const aliases =
        normalizedName === current.normalizedName
          ? current.aliases
          : [...new Set([...current.aliases, current.normalizedName])].filter(
              (a) => a !== normalizedName,
            );

      const now = new Date();
      const [row] = await tx
        .update(companies)
        .set({
          ...next,
          normalizedName,
          aliases,
          needsReviewSince: needsReviewSince(next.status, current, now),
          updatedAt: now,
        })
        .where(eq(companies.id, id))
        .returning();
      if (!row) throw new NotFoundError("Company not found");

      // The old board's jobs are in no poll's closure scan anymore: close them now
      // (a job some list still has stays open)
      const boardGone = next.ats !== current.ats || (current.track && !next.track);
      if (boardGone && current.ats !== OTHER_ATS) {
        await tx.execute(sql`
          UPDATE job_sources s SET removed_at = now()
          FROM jobs j
          WHERE s.job_id = j.id AND j.company_id = ${id}
            AND s.source = ${current.ats} AND s.removed_at IS NULL`);
        await tx.execute(sql`
          UPDATE jobs j SET closed_at = now()
          WHERE j.company_id = ${id} AND j.closed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM job_sources s WHERE s.job_id = j.id AND s.removed_at IS NULL)`);
      }

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
 * moves along when the other has none; two boards can't merge. Only a company
 * auto-add created with a tier nobody picked can be folded away (see `isAutoAdded`).
 * Its jobs take the other's name, as the poll names every job linked to a company.
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
    if (!isAutoAdded(from)) {
      throw new ConflictError(`${from.name} was added or edited by hand; it isn't merged away`);
    }
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
          // A board given up on (manual_only) moves over untracked, like it was
          track: from.status !== "manual_only",
          status: from.status,
          needsReviewSince: from.needsReviewSince,
          careersUrl: into.careersUrl ?? from.careersUrl,
        }),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, into.id))
      .returning();
    if (!row) throw new NotFoundError("Company not found");
    return row;
  });

/**
 * A suggestion the company `c` stands for: its name, an alias, its board, or
 * its board slug as a name (see `resolveCompany`). Used inside a query over
 * `suggestions` with `companies c` in scope.
 */
export const suggestionIsCompany = sql`(
  c.normalized_name = ${suggestions.id}
  OR ${suggestions.id} = ANY(c.aliases)
  OR (${suggestions.slug} IS NOT NULL AND c.ats = ${suggestions.ats}
      AND lower(c.slug) = lower(${suggestions.slug}))
  OR (c.slug IS NOT NULL AND regexp_replace(lower(c.slug), '[^a-z0-9]', '', 'g')
      = regexp_replace(${suggestions.id}, '[^a-z0-9]', '', 'g'))
)`;

/**
 * Removing a company is final: every suggestion it stood for is dismissed
 * (and its names are kept as dismissed suggestions when the lists haven't
 * suggested them yet), so polls don't reopen them and auto-add doesn't add it back.
 */
export const deleteCompany = async (db: DbOrTx, id: string): Promise<void> => {
  await db.transaction(async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, id)).for("update");
    if (!company) throw new NotFoundError("Company not found");
    const names = new Set([company.normalizedName, ...company.aliases]);
    if (company.slug) {
      const slugName = normalizeCompanyName(company.slug.replace(/[-_]+/g, " "));
      if (slugName) names.add(slugName);
    }
    await tx
      .insert(suggestions)
      .values(
        [...names].map((name) => ({
          id: name,
          displayName: company.name,
          ats: company.ats,
          slug: company.slug,
          state: "dismissed",
        })),
      )
      .onConflictDoNothing();
    await tx.execute(sql`
      UPDATE suggestions SET state = 'dismissed'
      FROM companies c
      WHERE c.id = ${id} AND suggestions.state <> 'dismissed' AND ${suggestionIsCompany}`);
    await tx.delete(companies).where(eq(companies.id, id));
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
