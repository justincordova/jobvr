import { describe, expect, it } from "vitest";
import { adjustedPostedAt, initialEffectiveAt, mergedEffectiveAt } from "./freshness";
import {
  annualUsd,
  isRemoteUs,
  isVisible,
  matchedLocationLabels,
  passesKeywordRule,
  passesPollFilter,
  passesSalaryRule,
} from "./matching";
import { DEFAULT_SETTINGS as S, type Settings } from "./settings";

describe("keyword rule", () => {
  it("ATS: role AND level AND NOT exclude", () => {
    expect(passesKeywordRule("Software Engineer, New Grad", "ats", S)).toBe(true);
    expect(passesKeywordRule("Junior Backend Developer", "ats", S)).toBe(true);
    expect(passesKeywordRule("Software Engineer I", "ats", S)).toBe(true);
    // Level-only titles don't pass (the "Renewals Associate" case)
    expect(passesKeywordRule("Renewals Associate", "ats", S)).toBe(false);
    expect(passesKeywordRule("Software Engineer", "ats", S)).toBe(false);
    // Exclude wins over level
    expect(passesKeywordRule("Software Engineer I/II", "ats", S)).toBe(false);
    expect(passesKeywordRule("Sr. Software Engineer, New Grad", "ats", S)).toBe(false);
    expect(passesKeywordRule("Software Engineering Intern", "ats", S)).toBe(false);
  });

  it("aggregator: exclude only, level when enabled", () => {
    expect(passesKeywordRule("Software Engineer", "aggregator", S)).toBe(true);
    expect(passesKeywordRule("Senior Software Engineer", "aggregator", S)).toBe(false);
    const strict = { ...S, applyLevelToSimplify: true };
    expect(passesKeywordRule("Software Engineer", "aggregator", strict)).toBe(false);
    expect(passesKeywordRule("Software Engineer, Early Career", "aggregator", strict)).toBe(true);
  });
});

describe("location rule", () => {
  it("matches the Remote-US rule", () => {
    for (const l of [
      "Remote",
      "Remote - US",
      "Remote in USA",
      "United States (Remote)",
      "Remote, U.S.",
    ]) {
      expect(isRemoteUs(l), l).toBe(true);
    }
    for (const l of [
      "Remote in UK",
      "Remote - Europe",
      "Remote (EMEA)",
      "Remote - Latin America",
      "New York, NY (Remote)",
      "United States",
    ]) {
      expect(isRemoteUs(l), l).toBe(false);
    }
  });

  it("returns every matched enabled label", () => {
    expect(matchedLocationLabels(["New York, NY (Remote)"], S)).toEqual(["NYC"]);
    expect(matchedLocationLabels(["Jersey City, NJ", "Remote in USA"], S)).toEqual([
      "NJ",
      "Remote-US",
    ]);
    expect(matchedLocationLabels(["Pittsburgh, PA"], S)).toEqual(["PA"]);
    expect(matchedLocationLabels(["San Francisco, CA", "Remote in UK"], S)).toEqual([]);
    const noRemote: Settings = {
      ...S,
      locations: S.locations.map((l) => (l.builtin ? { ...l, enabled: false } : l)),
    };
    expect(matchedLocationLabels(["Remote - US"], noRemote)).toEqual([]);
  });
});

describe("salary", () => {
  it("annualizes USD only", () => {
    expect(annualUsd({ currency: "USD", interval: "hour", min: 50, max: 60 })).toEqual({
      min: 104000,
      max: 124800,
    });
    expect(annualUsd({ currency: "usd", interval: "month", max: 10000 })).toEqual({
      min: null,
      max: 120000,
    });
    expect(annualUsd({ currency: "GBP", interval: "year", min: 50000 })).toEqual({
      min: null,
      max: null,
    });
    expect(annualUsd(undefined)).toEqual({ min: null, max: null });
  });

  it("uses max, else min; unlisted passes", () => {
    const s = { minSalaryUsd: 100000 };
    expect(passesSalaryRule(null, null, s)).toBe(true);
    expect(passesSalaryRule(90000, 110000, s)).toBe(true);
    expect(passesSalaryRule(90000, null, s)).toBe(false);
    expect(passesSalaryRule(null, 99999, s)).toBe(false);
  });
});

describe("freshness", () => {
  it("treats day precision as end of the UTC day", () => {
    const midnight = new Date("2026-11-12T00:00:00Z");
    expect(adjustedPostedAt(midnight, "day")).toEqual(new Date("2026-11-12T23:59:59.999Z"));
    expect(adjustedPostedAt(midnight, "instant")).toEqual(midnight);
  });

  it("effective_at is the earlier date and never moves later", () => {
    const seen = new Date("2026-11-12T10:00:00Z");
    expect(initialEffectiveAt(seen, new Date("2026-11-12T23:59:59Z"))).toEqual(seen);
    const older = new Date("2026-11-10T00:00:00Z");
    expect(initialEffectiveAt(seen, older)).toEqual(older);
    expect(mergedEffectiveAt(older, seen)).toEqual(older);
  });
});

describe("poll filter and visibility", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const listing = {
    title: "Software Engineer",
    locations: ["New York, NY"],
    postedAt: new Date("2026-11-12T00:00:00Z"),
    postedAtPrecision: "day" as const,
    meta: { active: true, visible: true, category: "software engineering" },
  };

  it("checks aggregator meta, category, and the 7-day window", () => {
    expect(passesPollFilter(listing, "aggregator", S, now)).toBe(true);
    expect(
      passesPollFilter(
        { ...listing, meta: { ...listing.meta, active: false } },
        "aggregator",
        S,
        now,
      ),
    ).toBe(false);
    expect(
      passesPollFilter(
        { ...listing, meta: { ...listing.meta, category: "Data Science" } },
        "aggregator",
        S,
        now,
      ),
    ).toBe(false);
    expect(
      passesPollFilter(
        { ...listing, postedAt: new Date("2026-11-04T00:00:00Z") },
        "aggregator",
        S,
        now,
      ),
    ).toBe(false);
    // Day-precision 7 days ago still counts (end of that day is within the window)
    expect(
      passesPollFilter(
        { ...listing, postedAt: new Date("2026-11-05T00:00:00Z") },
        "aggregator",
        S,
        now,
      ),
    ).toBe(true);
    // The ATS rule is stricter
    expect(passesPollFilter(listing, "ats", S, now)).toBe(false);
  });

  it("applies V: any source row passing keeps a merged job visible", () => {
    const kindOf = (s: string) =>
      s === "simplify" ? "aggregator" : s === "greenhouse" ? "ats" : undefined;
    const gh = { source: "greenhouse", title: "Software Engineer", category: null };
    const sj = { source: "simplify", title: "Software Engineer", category: "Software" };
    const job = {
      locations: ["New York, NY"],
      salaryMinUsd: null,
      salaryMaxUsd: null,
      closedAt: null,
      sources: [gh, sj],
    };
    expect(isVisible(job, S, kindOf)).toBe(true);
    expect(isVisible({ ...job, sources: [gh] }, S, kindOf)).toBe(false);
    expect(isVisible({ ...job, closedAt: now }, S, kindOf)).toBe(false);
    const simplifyOnly = { ...job, sources: [sj] };
    expect(isVisible(simplifyOnly, S, kindOf)).toBe(true);
    expect(isVisible(simplifyOnly, { ...S, showSimplifyJobs: false }, kindOf)).toBe(false);
    expect(isVisible(simplifyOnly, { ...S, simplifyCategories: ["Data"] }, kindOf)).toBe(false);
    expect(isVisible({ ...job, salaryMaxUsd: 50000 }, { ...S, minSalaryUsd: 60000 }, kindOf)).toBe(
      false,
    );
  });
});
