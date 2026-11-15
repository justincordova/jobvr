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
  const ats = (t: string, settings: Settings = S) => passesKeywordRule(t, "ats", settings);

  it("company boards: role keyword, no seniority; level is optional by default", () => {
    for (const t of [
      "Software Engineer, New Grad",
      "Junior Backend Developer",
      "Software Engineer I",
      "Software Engineer",
      "Software Engineer, Full Stack",
      "Forward Deployed Engineer",
      "Security & Infrastructure Engineer",
      "Machine Learning Engineer, Transaction Risk",
      "Software Engineer 1/2",
      "Engineer 2, New Grad",
      "New Grad Engineer",
      "Machine Learning Compiler Engineer",
    ]) {
      expect(ats(t), t).toBe(true);
    }
    for (const t of [
      "Renewals Associate",
      "Senior Software Engineer",
      "Sr. Software Engineer, New Grad",
      "Software Engineering Intern",
      "Software Engineer II",
      "Software Engineer 3",
      "Staff Software Engineer (AI Agents)",
      "Field Engineer, Healthcare",
      "Analytics Engineer",
      "Associate Legal Engineer",
      "Junior Electrical Engineer",
      "Head of Engineering",
      "Research Engineer / Scientist, Reinforcement Learning",
      "Technical Curriculum Developer, Technical Enablement",
      "Developer Advocate",
    ]) {
      expect(ats(t), t).toBe(false);
    }
  });

  it("company boards can require a level keyword", () => {
    const strict = { ...S, requireLevelOnBoards: true };
    expect(ats("Software Engineer", strict)).toBe(false);
    expect(ats("Software Engineer I", strict)).toBe(true);
    expect(ats("Software Engineer, Early Career", strict)).toBe(true);
  });

  it("SimplifyJobs: trusted categories pass, others need a role keyword", () => {
    const sj = (t: string, category: string, settings: Settings = S) =>
      passesKeywordRule(t, "aggregator", settings, category);
    expect(sj("Engineer 2 New Grad - Multiple Teams", "Software")).toBe(true);
    expect(sj("Entry Level Engineer - Multiple Teams", "Software")).toBe(true);
    expect(sj("Application Development Analyst New Grad", "Software")).toBe(true);
    // Trusted category still needs an engineering-sounding title
    expect(sj("AI Acceleration Specialist", "Software")).toBe(false);
    expect(sj("Associate Application Consultant", "Software")).toBe(false);
    expect(sj("AI Engineer", "AI/ML/Data")).toBe(true);
    expect(sj("Associate Data Engineer", "AI/ML/Data")).toBe(true);
    expect(sj("Data Analyst - Transplant Nephrology", "AI/ML/Data")).toBe(false);
    expect(sj("Junior Electrical Engineer", "Hardware")).toBe(false);
    expect(passesKeywordRule("Associate - Technology Transactions", "ats", S)).toBe(false);
    expect(sj("Senior Software Engineer", "Software")).toBe(false);
    const strict = { ...S, applyLevelToSimplify: true };
    expect(sj("Software Engineer", "Software", strict)).toBe(false);
    expect(sj("Software Engineer, Early Career", "Software", strict)).toBe(true);
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
      "United States",
      "USA",
      "US-Remote",
    ]) {
      expect(isRemoteUs(l), l).toBe(true);
    }
    for (const l of [
      "Remote in UK",
      "Remote - Europe",
      "Remote (EMEA)",
      "Remote - Latin America",
      "New York, NY (Remote)",
      "Austin, TX, United States",
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
    expect(matchedLocationLabels(["SF", "NY"], S)).toEqual(["NYC"]);
    expect(matchedLocationLabels(["New York, New York, United States"], S)).toEqual(["NYC"]);
    expect(matchedLocationLabels(["San Francisco, Seattle, New York"], S)).toEqual(["NYC"]);
    expect(matchedLocationLabels(["Seattle, WA; New York City, NY (HQ)"], S)).toEqual(["NYC"]);
    // NJ and PA are statewide; NYC is the city only
    expect(matchedLocationLabels(["Mt Laurel Township, NJ"], S)).toEqual(["NJ"]);
    expect(matchedLocationLabels(["Philadelphia, Pennsylvania"], S)).toEqual(["PA"]);
    for (const elsewhere of ["Brooklyn Park, MN", "Manhattan, KS", "Buffalo, NY", "Newark, DE"]) {
      expect(matchedLocationLabels([elsewhere], S), elsewhere).toEqual([]);
    }
    expect(matchedLocationLabels(["Hoboken"], S)).toEqual(["NJ"]);
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

  it("checks aggregator meta, category, and the 30-day window", () => {
    expect(passesPollFilter(listing, "aggregator", S, now)).toBe(true);
    expect(
      passesPollFilter(
        { ...listing, meta: { ...listing.meta, active: false } },
        "aggregator",
        S,
        now,
      ),
    ).toBe(false);
    // Untrusted category: needs a role keyword in the title
    expect(
      passesPollFilter(
        { ...listing, meta: { ...listing.meta, category: "Data Science" } },
        "aggregator",
        S,
        now,
      ),
    ).toBe(true);
    expect(
      passesPollFilter(
        { ...listing, title: "Data Analyst", meta: { ...listing.meta, category: "Data Science" } },
        "aggregator",
        S,
        now,
      ),
    ).toBe(false);
    expect(
      passesPollFilter(
        { ...listing, postedAt: new Date("2026-10-12T00:00:00Z") },
        "aggregator",
        S,
        now,
      ),
    ).toBe(false);
    // Day-precision 30 days ago still counts (end of that day is within the window)
    expect(
      passesPollFilter(
        { ...listing, postedAt: new Date("2026-10-13T00:00:00Z") },
        "aggregator",
        S,
        now,
      ),
    ).toBe(true);
    expect(passesPollFilter(listing, "ats", S, now)).toBe(true);
    expect(passesPollFilter(listing, "ats", { ...S, requireLevelOnBoards: true }, now)).toBe(false);
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
    const strict = { ...S, requireLevelOnBoards: true };
    expect(isVisible(job, strict, kindOf)).toBe(true);
    expect(isVisible({ ...job, sources: [gh] }, strict, kindOf)).toBe(false);
    expect(isVisible({ ...job, closedAt: now }, S, kindOf)).toBe(false);
    const simplifyOnly = { ...job, sources: [sj] };
    expect(isVisible(simplifyOnly, S, kindOf)).toBe(true);
    expect(isVisible(simplifyOnly, { ...S, showSimplifyJobs: false }, kindOf)).toBe(false);
    const builder = { ...sj, title: "Entry Level Engineer" };
    expect(isVisible({ ...job, sources: [builder] }, S, kindOf)).toBe(true);
    expect(
      isVisible({ ...job, sources: [builder] }, { ...S, simplifyCategories: ["Data"] }, kindOf),
    ).toBe(false);
    expect(isVisible({ ...job, salaryMaxUsd: 50000 }, { ...S, minSalaryUsd: 60000 }, kindOf)).toBe(
      false,
    );
  });
});
