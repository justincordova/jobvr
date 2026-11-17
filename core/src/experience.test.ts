import { describe, expect, it } from "vitest";
import { requiredYears } from "./experience";

// Phrases from real postings on tracked boards (Nov 2026)
describe("requiredYears", () => {
  it("reads common requirement shapes", () => {
    const cases: [string, number][] = [
      ["WHAT YOU NEED - 5+ years of experience in software engineering", 5],
      ["- 5 years of frontend engineering experience", 5],
      ["What we're looking for - 4+ years experience of professional backend software", 4],
      ["WHAT WE'RE LOOKING FOR Required - 2+ years of software engineering experience", 2],
      ["What We Require 4+ years of professional software engineering experience", 4],
      ["2-5 years of experience in a fast-paced startup", 2],
      ["6-10+ years of professional experience in solutions or forward deployed roles", 6],
      ["2-12+ years of industry software engineering experience", 2],
      ["3 or more years of industry experience", 3],
      ["- 3+ Years of experience building and operating production infrastructure", 3],
      ["2+ years of Java, C#, Go or Python experience", 2],
      ["- 2+ years working with robotics software", 2],
      ["You've spent 6+ years in Solutions Architecture, Deployment Strategy", 6],
      ["- 3+ years on the investment or underwriting team at a direct lender", 3],
      ["Minimum 1 year of experience in mobile development", 1],
      ["1+ years of relevant, post-college work experience.", 1],
      ["Must also have five (5) years of experience in each of the following", 5],
      ["at least three years of hands-on experience with distributed systems", 3],
    ];
    for (const [text, years] of cases) expect(requiredYears(text), text).toBe(years);
  });

  it("uses the first (headline) requirement", () => {
    expect(
      requiredYears(
        "What You Need - Minimum of 5 years of experience building software - Minimum of 2 years of experience focused on security",
      ),
    ).toBe(5);
    expect(requiredYears("3+ years of experience required; 5+ years of experience preferred")).toBe(
      3,
    );
  });

  it("ignores degree alternatives, company history, and other numbers", () => {
    for (const text of [
      "Bachelor's degree in CS or 4 years of equivalent experience",
      "BS in Computer Science or 4 years of relevant experience",
      "Our founders have 10+ years of experience at Google",
      "We've been building for 10 years and have experience across industries",
      "The salary range for this position is $135,000 - $200,000/year.",
      "2 weeks paid time off built into the end of each year",
      "Over the next 5 years, you will grow with the team",
      "4 years in enablement. Sales backgrounds preferred. - Experience with Gong",
      "Software Engineer, Early Career. No prior experience required.",
    ]) {
      expect(requiredYears(text), text).toBeNull();
    }
    // A separate bullet after "(or equivalent practical experience)" still counts
    expect(
      requiredYears(
        "BS in Computer Science, Engineering, or related field (or equivalent practical experience) - 5+ years of experience in software testing",
      ),
    ).toBe(5);
  });

  it("stays fast on long runs of long words (no catastrophic backtracking)", () => {
    const text = `In 2 years ${"observability/monitoring/alerting ".repeat(40)}done`;
    const start = performance.now();
    expect(requiredYears(text)).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });
});
