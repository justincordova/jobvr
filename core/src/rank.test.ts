import { describe, expect, it } from "vitest";
import { byRank, type RankInput, rankScore } from "./rank";

const NOW = new Date("2026-11-17T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const job = (extra: Partial<RankInput>): RankInput => ({
  effectiveAt: daysAgo(0.5),
  tier: "Unlisted",
  entryTitle: false,
  onNewGradList: false,
  requiredYears: null,
  namedPlace: false,
  ...extra,
});

// Real feed rows, Nov 2026
describe("rankScore", () => {
  it("adds up freshness, level, experience, tier, and place", () => {
    // CrossCountry "Junior Forward Deployed Software Engineer", Philadelphia, today
    expect(rankScore(job({ tier: "B", entryTitle: true, namedPlace: true }), NOW)).toBe(
      30 + 20 + 10 + 4,
    );
    // HRT "Software Engineer – 2027 Grads", four months old
    expect(
      rankScore(
        job({ tier: "S", entryTitle: true, namedPlace: true, effectiveAt: daysAgo(126) }),
        NOW,
      ),
    ).toBe(0 + 20 + 20 + 4);
    // A plain board title asking for 2 years
    expect(rankScore(job({ tier: "C", requiredYears: 2, effectiveAt: daysAgo(5) }), NOW)).toBe(
      18 - 6 + 6,
    );
    // SimplifyJobs-only row, title doesn't say new grad
    expect(rankScore(job({ onNewGradList: true, effectiveAt: daysAgo(2) }), NOW)).toBe(24 + 12);
  });

  it("puts a fresh new-grad role above a stale plain one, and breaks ties by age", () => {
    const fresh = { ...job({ entryTitle: true }), id: "fresh" };
    const stale = { ...job({ tier: "S", effectiveAt: daysAgo(20) }), id: "stale" };
    const older = { ...job({ entryTitle: true, effectiveAt: daysAgo(0.9) }), id: "older" };
    const ranked = [stale, older, fresh]
      .map((j) => ({ ...j, score: rankScore(j, NOW) }))
      .sort(byRank)
      .map((j) => j.id);
    expect(ranked).toEqual(["fresh", "older", "stale"]);
  });
});
