import { and, desc, eq, gt } from "drizzle-orm";
import type { Tier, TierSource } from "../constants";
import type { DbOrTx } from "../db/client";
import { type CompanyRow, type SuggestionRow, suggestions } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { getAdapter, OTHER_ATS_ID } from "../sources/registry";
import type { Registry } from "../sources/types";
import { createCompany } from "./companies";

export const listOpenSuggestions = (db: DbOrTx): Promise<SuggestionRow[]> =>
  db
    .select()
    .from(suggestions)
    .where(and(eq(suggestions.state, "open"), gt(suggestions.listingCount, 0)))
    .orderBy(desc(suggestions.listingCount), suggestions.displayName);

/**
 * One-click add: creates the company (tracked when its ATS + slug are known).
 * `listOnly` keeps it for its list jobs only (no readable board): `manual_only`.
 */
export const addSuggestion = (
  db: DbOrTx,
  registry: Registry,
  id: string,
  tier: Tier,
  notes: string | null = null,
  tierSource: TierSource = "manual",
  listOnly = false,
): Promise<CompanyRow> =>
  db.transaction(async (tx) => {
    const [s] = await tx.select().from(suggestions).where(eq(suggestions.id, id)).for("update");
    if (!s) throw new NotFoundError("Suggestion not found");
    if (s.state === "added") throw new ConflictError("Suggestion was already added");
    const supported = !listOnly && getAdapter(registry, s.ats)?.kind === "ats";
    const base = { name: s.displayName, city: null, state: null, tier, tierSource, notes };
    const company = !supported
      ? await createCompany(tx, {
          ...base,
          ats: OTHER_ATS_ID,
          slug: null,
          track: false,
          status: "manual_only",
        })
      : s.slug
        ? await createCompany(tx, { ...base, ats: s.ats, slug: s.slug, track: true, status: "ok" })
        : await createCompany(tx, {
            ...base,
            ats: s.ats,
            slug: null,
            track: false,
            status: "needs_review",
            notes: "find slug with discover",
          });
    await tx.update(suggestions).set({ state: "added" }).where(eq(suggestions.id, id));
    return company;
  });

export const dismissSuggestion = async (db: DbOrTx, id: string): Promise<void> => {
  const rows = await db
    .update(suggestions)
    .set({ state: "dismissed" })
    .where(eq(suggestions.id, id))
    .returning({ id: suggestions.id });
  if (rows.length === 0) throw new NotFoundError("Suggestion not found");
};
