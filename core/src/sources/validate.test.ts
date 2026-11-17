import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateItems } from "./validate";

const job = (url: string) => ({
  source: "simplify",
  sourceJobId: url,
  title: "Software Engineer",
  companyName: "Acme",
  locations: ["NYC"],
  url,
  postedAt: new Date("2026-11-17T12:00:00Z"),
  postedAtPrecision: "instant" as const,
});

describe("validateItems", () => {
  it("drops listings whose link isn't http(s)", () => {
    const urls = [
      "https://x.test/1",
      "javascript:alert(1)",
      "http://x.test/2",
      "data:text/html,hi",
    ];
    const out = validateItems("simplify", urls, z.string(), job);
    expect(out.jobs.map((j) => j.url)).toEqual(["https://x.test/1", "http://x.test/2"]);
    expect(out.invalidCount).toBe(2);
  });
});
