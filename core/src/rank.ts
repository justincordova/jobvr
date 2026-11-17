import { DAY_MS, type TierFilter } from "./constants";

/**
 * "Best first" feed order: a small points table, so any position can be
 * explained by reading off the job's age, level, tier, and place.
 *
 * | Part       | Points                                                                  |
 * | ---------- | ----------------------------------------------------------------------- |
 * | Freshness  | under 1 day 30, 3 days 24, 7 days 18, 14 days 12, 30 days 6, older 0    |
 * | Level      | title says entry level 20; SimplifyJobs-listed (new-grad list) 12       |
 * | Experience | asks for 2 years -6 (3+ is hidden by the experience rule)               |
 * | Tier       | S 20, A 15, Mid 8, Startup 8, Corporate 5, Unlisted 0                   |
 * | Place      | in a named place (NYC/NJ/PA, not only Remote-US) 4                      |
 *
 * Ties go to the newer job. Freshness and level weigh most, so a fresh
 * new-grad role always beats a stale plain one, and a months-old "2027 Grads"
 * role at an S-tier firm still sits near a fresh unlisted one.
 */
export interface RankInput {
  effectiveAt: Date;
  tier: TierFilter;
  /** The title says entry level (level keyword or I/1). */
  entryTitle: boolean;
  /** Listed by SimplifyJobs (a curated new-grad list). */
  onNewGradList: boolean;
  /** Smallest experience requirement read from a description (null: none read). */
  requiredYears: number | null;
  /** Matched a named location other than Remote-US. */
  namedPlace: boolean;
}

const FRESHNESS: readonly [maxDays: number, points: number][] = [
  [1, 30],
  [3, 24],
  [7, 18],
  [14, 12],
  [30, 6],
];

const TIER_POINTS: Record<TierFilter, number> = {
  S: 20,
  A: 15,
  Mid: 8,
  Startup: 8,
  Corporate: 5,
  Unlisted: 0,
};

export const rankScore = (j: RankInput, now: Date): number => {
  const ageDays = (now.getTime() - j.effectiveAt.getTime()) / DAY_MS;
  const fresh = FRESHNESS.find(([max]) => ageDays < max)?.[1] ?? 0;
  const level = j.entryTitle ? 20 : j.onNewGradList ? 12 : 0;
  const experience = (j.requiredYears ?? 0) >= 2 ? -6 : 0;
  return fresh + level + experience + TIER_POINTS[j.tier] + (j.namedPlace ? 4 : 0);
};

/** Highest score first, then newest. */
export const byRank = <T extends { score: number; effectiveAt: Date }>(a: T, b: T) =>
  b.score - a.score || b.effectiveAt.getTime() - a.effectiveAt.getTime();
