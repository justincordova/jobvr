import { parseAtsUrl } from "@jobvr/core";
import { fakeHttp } from "@jobvr/core/testing";
import { describe, expect, it } from "vitest";
import { adapters } from "./index";
import { parseWorkableUrl, workable } from "./workable";

const LIST = "https://apply.workable.com/api/v1/widget/accounts/interimage";
const DETAIL = "https://apply.workable.com/api/v2/accounts/interimage/jobs/1A2B3C4D5E";

const ok = (data: unknown) => ({ status: "ok" as const, etag: null, data });

// Shaped like a real widget response (Nov 2026), trimmed
const board = {
  name: "InterImage",
  jobs: [
    {
      title: "Software Engineer 0",
      shortcode: "1a2b3c4d5e",
      published_on: "2026-11-17",
      telecommuting: false,
      country: "United States",
      city: "Fort Meade",
      state: "Maryland",
      locations: [
        {
          country: "United States",
          countryCode: "US",
          city: "Fort Meade",
          region: "Maryland",
          hidden: false,
        },
        { country: "United States", countryCode: "US", city: "Secret", region: "VA", hidden: true },
      ],
    },
    {
      title: " Full Stack Developer - Entry Level ",
      shortcode: "9F8E7D6C5B",
      published_on: "2026-11-10",
      telecommuting: true,
      country: "United States",
      city: "Columbia",
      state: "Maryland",
      locations: [
        {
          country: "United States",
          countryCode: "US",
          city: "Columbia",
          region: "Maryland",
          hidden: false,
        },
      ],
    },
    {
      title: "Graduate Engineer",
      shortcode: "AB12CD34EF",
      published_on: "2026-11-11",
      telecommuting: true,
      country: "United Kingdom",
      city: "London",
      state: "England",
    },
    { title: "Broken", shortcode: "!!", published_on: "nope" },
  ],
};

describe("workable adapter", () => {
  it("maps jobs: visible places, Remote - US for US remote roles, day dates", async () => {
    const { http } = fakeHttp({ [LIST]: ok(board) });
    const res = await workable.fetch({ slug: "interimage", companyName: "InterImage", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.etag).toBeNull();
    expect(res.invalidCount).toBe(1);
    expect(res.jobs[0]).toEqual({
      source: "workable",
      sourceJobId: "1A2B3C4D5E",
      companyName: "InterImage",
      companySlug: "interimage",
      title: "Software Engineer 0",
      locations: ["Fort Meade, Maryland, United States"],
      url: "https://apply.workable.com/interimage/j/1A2B3C4D5E/",
      postedAt: new Date("2026-11-17T00:00:00Z"),
      postedAtPrecision: "day",
    });
    expect(res.jobs[1]?.title).toBe("Full Stack Developer - Entry Level");
    expect(res.jobs[1]?.locations).toEqual(["Columbia, Maryland, United States", "Remote - US"]);
    // Remote in the UK isn't Remote - US; no locations array falls back to the job's own place
    expect(res.jobs[2]?.locations).toEqual(["London, England, United Kingdom"]);
  });

  it("fetches one job's description and pay", async () => {
    const { http } = fakeHttp({
      [DETAIL]: ok({
        description: "<p>Build things&nbsp;daily.</p>",
        requirements: "<ul><li>0-2 years of experience</li></ul>",
        benefits: "",
        salary_from: 85000,
        salary_to: 105000,
        salary_currency_iso_code: "USD",
        salary_frequency: "year",
      }),
    });
    expect(await workable.fetchDetail?.("interimage", "1A2B3C4D5E", { http })).toEqual({
      description: "Build things daily.\n0-2 years of experience",
      salary: { currency: "USD", interval: "year", min: 85000, max: 105000 },
    });
    expect(await workable.fetchDetail?.("interimage", "GONE000000", { http })).toBeNull();
  });

  it("probes accounts: 404 is not found", async () => {
    const { http } = fakeHttp({ [LIST]: ok(board) });
    expect(await workable.probe?.("interimage", { http })).toEqual({ found: true, jobCount: 4 });
    expect(await workable.probe?.("nope", { http })).toEqual({ found: false, jobCount: 0 });
  });

  it("parses Workable links", () => {
    expect(parseWorkableUrl("https://apply.workable.com/bask-health-1/j/70814EFA9B/apply")).toEqual(
      { sourceJobId: "70814EFA9B", slug: "bask-health-1" },
    );
    expect(parseWorkableUrl("https://apply.workable.com/rokt/j/236521b2c0/")).toEqual({
      sourceJobId: "236521B2C0",
      slug: "rokt",
    });
    expect(parseWorkableUrl("https://apply.workable.com/j/212FC0AB03")).toEqual({
      sourceJobId: "212FC0AB03",
    });
    expect(parseWorkableUrl("https://acme.workable.com/j/212FC0AB03")).toEqual({
      sourceJobId: "212FC0AB03",
      slug: "acme",
    });
    expect(parseWorkableUrl("https://apply.workable.com/rokt")).toBeNull();
    expect(parseWorkableUrl("https://apply.workable.com/rokt/j/212FC0AB03/apply/x")).toBeNull();
    expect(parseWorkableUrl("https://www.workable.com/j/212FC0AB03")).toBeNull();
    expect(workable.boardSlug?.("https://apply.workable.com/rokt/")).toBe("rokt");
    expect(workable.boardSlug?.("https://apply.workable.com/j/212FC0AB03")).toBeNull();
  });

  it("is what the lists' Workable links resolve to", () => {
    expect(
      parseAtsUrl(adapters, "https://apply.workable.com/coldquanta/j/DA0D4B3975/apply"),
    ).toMatchObject({ adapter: { id: "workable" }, sourceJobId: "DA0D4B3975", slug: "coldquanta" });
  });
});
