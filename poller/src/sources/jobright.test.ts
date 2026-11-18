import { readFileSync } from "node:fs";
import { fakeHttp } from "@jobvr/core/testing";
import { describe, expect, it } from "vitest";
import { JOBRIGHT_URL, jobright, parseLocations, parsePostedDate } from "./jobright";
import { REMOTE_US } from "./shared";

const fixture = readFileSync(new URL("./fixtures/jobright.md", import.meta.url), "utf8");
const ok = (data: string) => ({ status: "ok" as const, etag: '"jr1"', data });

describe("jobright adapter", () => {
  it("maps rows, carrying the company down to ↳ rows", async () => {
    const { http } = fakeHttp({ [JOBRIGHT_URL]: ok(fixture) });
    const res = await jobright.fetch({ http });
    if (res.status !== "ok") throw new Error("expected ok");
    // The last row has 4 cells for a 5-column table: counted, not fatal
    expect(res.invalidCount).toBe(1);
    expect(res.jobs.map((j) => j.companyName)).toEqual([
      "Oracle",
      "Oracle",
      "Beast Code",
      "Sony Pictures Imageworks",
      "Amazon",
    ]);
    const amazon = res.jobs.at(-1);
    expect(amazon).toMatchObject({
      source: "jobright",
      sourceJobId: "6afcd0bbe8a9612f4e0dbd32",
      title: "Software Development Engineer",
      locations: ["Cambridge, MA, United States"],
      // Tracking parameters dropped
      url: "https://jobright.ai/jobs/info/6afcd0bbe8a9612f4e0dbd32",
      postedAtPrecision: "day",
      meta: { active: true, visible: true, category: "Software Engineering" },
    });
    expect(jobright.indirectLinks).toBe(true);
  });

  it("keeps one row per repeated role (same company, title and place)", async () => {
    const amazon = fixture.split("\n").find((l) => l.includes("[Amazon]")) ?? "";
    const repeat = amazon.replace("6afcd0bbe8a9612f4e0dbd32", "6afcd0bbe8a9612f4e0dbd99");
    const { http } = fakeHttp({
      [JOBRIGHT_URL]: ok(fixture.replace(amazon, `${amazon}\n${repeat}`)),
    });
    const res = await jobright.fetch({ http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.jobs.filter((j) => j.companyName === "Amazon").map((j) => j.sourceJobId)).toEqual([
      "6afcd0bbe8a9612f4e0dbd32",
    ]);
  });

  it("adds Remote - US only for remote roles in the US", () => {
    expect(parseLocations("Fort Walton Beach, FL, United States", "Remote")).toEqual([
      "Fort Walton Beach, FL, United States",
      REMOTE_US,
    ]);
    expect(parseLocations("United States", "Remote")).toEqual(["United States", REMOTE_US]);
    expect(parseLocations("Toronto, ON, Canada", "Remote")).toEqual(["Toronto, ON, Canada"]);
    expect(parseLocations("New York, NY, United States", "Hybrid")).toEqual([
      "New York, NY, United States",
    ]);
  });

  it("infers the year of a month-day date", () => {
    const nov = new Date("2026-11-17T20:00:00Z");
    expect(parsePostedDate("Nov 17", nov)).toEqual(new Date("2026-11-17T00:00:00Z"));
    expect(parsePostedDate("Nov 18", nov)).toEqual(new Date("2026-11-18T00:00:00Z"));
    expect(parsePostedDate("Dec 30", nov)).toEqual(new Date("2025-12-30T00:00:00Z"));
    const jan = new Date("2027-01-02T12:00:00Z");
    expect(parsePostedDate("Dec 30", jan)).toEqual(new Date("2026-12-30T00:00:00Z"));
    expect(() => parsePostedDate("yesterday", nov)).toThrow();
  });

  it("fails loudly when the README has no table (layout changed)", async () => {
    const { http } = fakeHttp({ [JOBRIGHT_URL]: ok("# Moved") });
    await expect(jobright.fetch({ http })).rejects.toThrow(/no job table/);
  });

  it("returns not_modified on 304", async () => {
    const { http } = fakeHttp({ [JOBRIGHT_URL]: { status: "not_modified" } });
    expect(await jobright.fetch({ http, etag: '"jr1"' })).toEqual({ status: "not_modified" });
  });
});
