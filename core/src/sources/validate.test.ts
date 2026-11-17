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

  it("reports the ids of invalid items that have one", () => {
    const Raw = z.object({ id: z.union([z.string(), z.number()]), title: z.string().min(1) });
    const ok = (id: string) => ({ id, title: "SWE" });
    const items = [ok("a"), ok("b"), ok("c"), { id: "B2", title: "" }, { id: 7 }, { title: "" }];
    const out = validateItems("ashby", items, Raw, (r) => job(`https://x.test/${r.id}`));
    expect(out.jobs).toHaveLength(3);
    expect(out.invalidCount).toBe(3);
    expect(out.invalidIds).toEqual(["b2", "7"]);
  });
});
