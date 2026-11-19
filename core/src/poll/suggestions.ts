import { and, notInArray, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { suggestions } from "../db/schema";
import { OTHER_ATS_ID } from "../sources/registry";
import type { Registry } from "../sources/types";
import type { PreparedListing } from "./resolve";

/** Most common value (ties: first seen). */
const mostCommon = <T>(values: readonly T[]): T | undefined => {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestCount = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
};

export interface SuggestionGroup {
  id: string;
  displayName: string;
  ats: string;
  slug: string | null;
  listingCount: number;
  sampleTitles: string[];
}

/** Groups unresolved listings by normalized company name. */
export const groupSuggestions = (
  listings: readonly PreparedListing[],
  registry: Registry,
): SuggestionGroup[] => {
  const groups = new Map<string, PreparedListing[]>();
  for (const p of listings) {
    if (!p.companyNorm) continue;
    let g = groups.get(p.companyNorm);
    if (!g) {
      g = [];
      groups.set(p.companyNorm, g);
    }
    g.push(p);
  }
  const atsIds = new Set(registry.filter((a) => a.kind === "ats").map((a) => a.id));
  return [...groups].map(([id, items]) => {
    const refs = items.flatMap((p) => (p.atsRef && atsIds.has(p.atsRef.source) ? [p.atsRef] : []));
    const ats = mostCommon(refs.map((r) => r.source)) ?? OTHER_ATS_ID;
    const slug =
      mostCommon(refs.filter((r) => r.source === ats && r.slug).map((r) => r.slug as string)) ??
      null;
    return {
      id,
      displayName: mostCommon(items.map((p) => p.listing.companyName)) ?? id,
      ats,
      slug,
      listingCount: items.length,
      sampleTitles: [...new Set(items.map((p) => p.listing.title))].slice(0, 3),
    };
  });
};

const resolvesToCompany = sql`EXISTS (
  SELECT 1 FROM companies c
  WHERE c.normalized_name = ${suggestions.id}
     OR (${suggestions.slug} IS NOT NULL AND c.ats = ${suggestions.ats}
         AND lower(c.slug) = lower(${suggestions.slug}))
     -- A company whose board slug is this name (see resolveCompany)
     OR (c.slug IS NOT NULL AND regexp_replace(lower(c.slug), '[^a-z0-9]', '', 'g')
         = regexp_replace(${suggestions.id}, '[^a-z0-9]', '', 'g'))
)`;

/**
 * Step 9: refresh this aggregator's share of the suggestion rows from its
 * unresolved, matching listings. Each list keeps its own count (one list's
 * poll must not zero what another found); `listing_count` is their sum. A
 * list that only knows "other" never replaces an ATS + slug another found.
 */
export const updateSuggestions = async (
  tx: Tx,
  source: string,
  listings: readonly PreparedListing[],
  registry: Registry,
  now: Date,
): Promise<void> => {
  const groups = groupSuggestions(listings, registry);
  const better = sql`${suggestions.state} = 'open' AND (excluded.ats <> ${OTHER_ATS_ID} OR ${suggestions.ats} = ${OTHER_ATS_ID})`;
  for (const g of groups) {
    const counts = { [source]: g.listingCount };
    await tx
      .insert(suggestions)
      .values({ ...g, listingCounts: counts, lastSeenAt: now, state: "open" })
      .onConflictDoUpdate({
        target: suggestions.id,
        set: {
          listingCounts: sql`${suggestions.listingCounts} || ${JSON.stringify(counts)}::jsonb`,
          sampleTitles: g.sampleTitles,
          lastSeenAt: now,
          displayName: sql`CASE WHEN ${suggestions.state} = 'open' THEN ${g.displayName} ELSE ${suggestions.displayName} END`,
          ats: sql`CASE WHEN ${better} THEN ${g.ats} ELSE ${suggestions.ats} END`,
          slug: sql`CASE WHEN ${better} THEN ${g.slug}::text ELSE ${suggestions.slug} END`,
        },
      });
  }
  const seen = groups.map((g) => g.id);
  // This list no longer has them; only rows that change (most never had this source)
  await tx
    .update(suggestions)
    .set({ listingCounts: sql`${suggestions.listingCounts} - ${source}::text` })
    .where(
      and(
        sql`${suggestions.listingCounts} ->> ${source} IS NOT NULL`,
        seen.length > 0 ? notInArray(suggestions.id, seen) : undefined,
      ),
    );
  const total = sql`COALESCE((SELECT sum(value::int) FROM jsonb_each_text(${suggestions.listingCounts})), 0)::int`;
  await tx
    .update(suggestions)
    .set({ listingCount: total })
    .where(sql`${suggestions.listingCount} <> ${total}`);
  await tx.execute(
    sql`UPDATE suggestions SET state = 'added' WHERE state = 'open' AND ${resolvesToCompany}`,
  );
  await tx.execute(
    sql`UPDATE suggestions SET state = 'open' WHERE state = 'added' AND NOT ${resolvesToCompany}`,
  );
};
