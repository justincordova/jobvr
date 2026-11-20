import { describe, expect, it } from "vitest";
import { collapseReposts, type JobRecord } from "./jobs";

const job = (id: string, extra: Partial<JobRecord> = {}): JobRecord => ({
  id,
  title: "Software Engineer",
  companyId: null,
  companyName: "H2O.ai",
  tier: "Unlisted",
  locations: ["Remote in USA"],
  url: `https://example.com/${id}`,
  primarySource: "simplify",
  firstSeenAt: new Date("2026-11-13T00:00:00Z"),
  effectiveAt: new Date("2026-11-13T00:00:00Z"),
  salaryMinUsd: null,
  salaryMaxUsd: null,
  state: "new",
  appliedAt: null,
  baseline: false,
  closedAt: null,
  notifiedAt: null,
  sources: [],
  ...extra,
});

// Real feed examples (Nov 2026)
describe("collapseReposts", () => {
  it("shows one row for the same role posted several times, newest first", () => {
    const out = collapseReposts([job("sj:1"), job("sj:2"), job("sj:3")]);
    expect(out.map((j) => [j.id, j.duplicateIds])).toEqual([["sj:1", ["sj:2", "sj:3"]]]);
  });

  it("ignores case and punctuation, but keeps different places and titles apart", () => {
    const harvey = { companyName: "Harvey", title: "Research Engineer, Infrastructure" };
    const out = collapseReposts([
      job("ab:1", { ...harvey, locations: ["Remote", "Remote - US"] }),
      job("ab:2", { ...harvey, locations: ["New York"] }),
      job("ab:3", {
        ...harvey,
        title: "research engineer - infrastructure",
        locations: ["New York"],
      }),
      job("ab:4", { ...harvey, title: "Research Engineer, Data", locations: ["New York"] }),
      job("ab:5", { ...harvey, companyName: "Ramp", locations: ["New York"] }),
    ]);
    expect(out.map((j) => [j.id, j.duplicateIds])).toEqual([
      ["ab:1", []],
      ["ab:2", ["ab:3"]],
      ["ab:4", []],
      ["ab:5", []],
    ]);
  });

  it("names the US one way: Jobright's two copies of one MJH role are one row", () => {
    const mjh = { companyName: "MJH Life Sciences®", title: "Associate Product Engineer" };
    const out = collapseReposts([
      job("jr:1", { ...mjh, locations: ["United States, US", "Remote - US"] }),
      job("jr:2", { ...mjh, locations: ["United States", "Remote - US"] }),
      job("jr:3", { ...mjh, locations: ["Austin, TX, United States"] }),
    ]);
    expect(out.map((j) => [j.id, j.duplicateIds])).toEqual([
      ["jr:1", ["jr:2"]],
      ["jr:3", []],
    ]);
  });
});
