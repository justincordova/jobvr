import { describe, expect, it } from "vitest";
import { adjustedPostedAt, initialEffectiveAt, mergedEffectiveAt } from "./freshness";
import {
  annualUsd,
  isEntryLevelTitle,
  isRemoteUs,
  isVisible,
  matchedLocationLabels,
  passesExperienceRule,
  passesKeywordRule,
  passesPollFilter,
  passesSalaryRule,
} from "./matching";
import { DEFAULT_SETTINGS as S, type Settings } from "./settings";

describe("keyword rule", () => {
  const ats = (t: string, settings: Settings = S) => passesKeywordRule(t, "ats", settings);

  it("a role phrase that contains an exclude word still passes; seniority still rejects", () => {
    // "staff" is an exclude; OpenAI and Anthropic post new-grad roles under this title
    expect(ats("Member of Technical Staff, New Grad")).toBe(true);
    expect(ats("Member of Technical Staff - Applied AI")).toBe(true);
    expect(ats("Senior Member of Technical Staff")).toBe(false);
    expect(ats("Staff Software Engineer")).toBe(false);
  });

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
      "AI Forward Deployed Engineer",
      "Forward Deployed Software Engineer, New Grad - Warp Speed",
      "Software Engineer, Smart Contracts",
      "Software Engineer, Contracts Platform",
      "Software Engineer (L1)",
      "Software Engineer I/II",
      // Google hires new grads at L3; Amazon's SDE I is L4
      "Software Engineer, L3",
      "Software Development Engineer I (L4)",
      "SDE I, L4 - Payments",
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
      // A requisition code isn't a level ("AMZ27480.1" isn't "1")
      "Software Dev Engineer II - AMZ27480.1",
      // Level codes count like numbers (Twilio's L2 isn't entry level)
      "Software Engineer, Platform Access (L2)",
      "Software Engineer - IC3",
      "SDE2, Payments",
      // A level word or a stray "I" / "1" doesn't outrank a numbered level
      "Software Engineer III – Storage I/O",
      "Software Engineer II, Tier 1 Tools",
      "Software Engineer II (Associate)",
      "Software Engineer II, University Recruiting Platform",
      "Software Engineer L6",
      // L4 without level I is past entry level, as is any other numbered level beside L3
      "Software Engineer (L4)",
      "Software Engineer II (L4)",
      "Software Engineer III, L3",
      "Software Engineer VI",
      "Software Engineer – Contract",
      "Software Engineer - Contract, Remote",
      "Staff Software Engineer (AI Agents)",
      "Field Engineer, Healthcare",
      "Analytics Engineer",
      "Associate Legal Engineer",
      "Junior Electrical Engineer",
      "Head of Engineering",
      "Research Engineer / Scientist, Reinforcement Learning",
      "Technical Curriculum Developer, Technical Enablement",
      "Developer Advocate",
      // Real titles that got through before (Nov 2026)
      "Forward Deployed UX Designer",
      "Forward Deployed Strategist",
      "Forward Deployed Finance Engineer, Private Credit",
      "Forward Deployed AI Accelerator, Marketing",
      "Software Engineer - 2027 Interns",
      "Mid-Level Software Engineer",
      "Applications Development Intermediate Programmer Analyst - Officer",
      "Machine Learning Researcher",
      "Machine Learning Educator",
      "Campus Recruiter, Machine Learning and Quantitative Research",
      "Software Engineer (Part-Time)",
      "Temporary Manager - Python Developer - Risk Technology & AI",
      // From the wider board scan (Nov 2026)
      "Developer Engagement Team  (Contract)",
      "Software Engineer - Contractor",
      "Customer Support Developer (Databases)",
      "Associate GTM Engineer",
      "Lifecycle Services Engineer I",
      // Explicit new-grad board roles that aren't software (Nov 2026)
      "Design Verification (DV) Engineer - 2027 Grads",
      "Algorithm Developer (Quant Research & Trading) – 2027 PhDs",
      "AI Research Engineer, New PhD Graduate",
    ]) {
      expect(ats(t), t).toBe(false);
    }
  });

  it("always rejects senior titles the editable excludes miss (Nov 2026 QA)", () => {
    for (const t of [
      "Consulting Member of Technical Staff",
      "Software Engineering Team Leader",
      "Tech Leader, Payments",
      "Software Engineer (Mid)",
      "Mid-Senior Backend Developer",
      "Advisory Software Engineer",
      "Expert Software Engineer",
      "Experienced Software Engineer",
      "Software Engineer, E5",
      "Software Engineer VII",
    ]) {
      expect(ats(t), t).toBe(false);
    }
    for (const t of [
      "Software Engineer, Mid-Market Payments",
      "Software Engineer, E3 (New Grad)",
      "Software Engineer - Mid-Atlantic",
    ]) {
      expect(ats(t), t).toBe(true);
    }
  });

  it("only a clear entry-level title waives the experience cutoff", () => {
    const years = (title: string) => passesExperienceRule({ title, requiredYears: 5 }, S);
    expect(years("Software Engineer, New Grad")).toBe(true);
    expect(years("Junior Software Engineer")).toBe(true);
    // Banks' "Associate" is often several years in
    expect(years("Associate, Software Engineer")).toBe(false);
  });

  it("a keyword's last word also matches its plural", () => {
    expect(isEntryLevelTitle("Software Engineer, New Grads", S)).toBe(true);
    expect(isEntryLevelTitle("Software Engineer - 2027 New Grads", S)).toBe(true);
    expect(ats("Software Engineering Leads")).toBe(false);
    // Only whole words: "ios" doesn't become "io", "grad" doesn't match "gradient"
    expect(isEntryLevelTitle("Gradient Boosting Engineer", S)).toBe(false);
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
    // Another discipline's word only elsewhere in the title (a program name) doesn't count
    expect(sj("Engineer New Grad - Evolve - An Apple Services Rotation Program", "Software")).toBe(
      true,
    );
    expect(sj("Electrical Engineer New Grad - Rotation Program", "Software")).toBe(false);
    expect(ats("Field Services Engineer, New Grad")).toBe(false);
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
  it("hides board jobs asking for 3+ years unless the title says entry level", () => {
    const kindOf = (s: string) => (s === "simplify" ? "aggregator" : "ats");
    type Row = {
      source: string;
      title: string;
      category: string | null;
      requiredYears?: number | null;
    };
    const row = (title: string, requiredYears: number | null): Row => ({
      source: "ashby",
      title,
      category: null,
      requiredYears,
    });
    const job = (...sources: Row[]) => ({
      locations: ["New York, NY"],
      salaryMinUsd: null,
      salaryMaxUsd: null,
      closedAt: null,
      sources,
    });
    // Ramp "Software Engineer, Frontend": "5 years of frontend engineering experience"
    expect(isVisible(job(row("Software Engineer, Frontend", 5)), S, kindOf)).toBe(false);
    expect(isVisible(job(row("Software Engineer, Backend, Credit", 2)), S, kindOf)).toBe(true);
    expect(isVisible(job(row("Software Engineer", 0)), S, kindOf)).toBe(true);
    // Not checked yet (Greenhouse detail pending): shown
    expect(isVisible(job(row("Software Engineer", null)), S, kindOf)).toBe(true);
    expect(isVisible(job(row("Software Engineer, New Grad", 3)), S, kindOf)).toBe(true);
    expect(
      isVisible(
        job(row("Software Engineer, Frontend", 5)),
        { ...S, experienceCutoffYears: 0 },
        kindOf,
      ),
    ).toBe(true);
    expect(
      isVisible(
        job(row("Software Engineer, Frontend", 5)),
        { ...S, experienceCutoffYears: 6 },
        kindOf,
      ),
    ).toBe(true);
    // A SimplifyJobs row (curated new grad, no description) keeps a merged job visible
    const sj = { source: "simplify", title: "Software Engineer", category: "Software" };
    expect(isVisible(job(row("Software Engineer", 5), sj), S, kindOf)).toBe(true);
  });

  it("the store window follows the setting", () => {
    const old = { ...listing, postedAt: new Date("2026-09-20T00:00:00Z") };
    expect(passesPollFilter(old, "ats", S, now)).toBe(false);
    expect(passesPollFilter(old, "ats", { ...S, storeWindowDays: 60 }, now)).toBe(true);
  });

  it("keeps explicit new-grad roles on company boards for 180 days", () => {
    // HRT posted its 2027 Grads role in July; it was still open in November
    const hrt = {
      ...listing,
      title: "Software Engineer (C++ or Python) – 2027 Grads",
      postedAt: new Date("2026-07-13T00:00:00Z"),
    };
    expect(passesPollFilter(hrt, "ats", S, now)).toBe(true);
    // Not SimplifyJobs (no closure check to trust), not plain titles, not past 180 days
    expect(passesPollFilter(hrt, "aggregator", S, now)).toBe(false);
    expect(passesPollFilter({ ...hrt, title: "Software Engineer" }, "ats", S, now)).toBe(false);
    expect(
      passesPollFilter({ ...hrt, postedAt: new Date("2026-05-01T00:00:00Z") }, "ats", S, now),
    ).toBe(false);
  });
});
