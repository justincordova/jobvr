import { readFileSync } from "node:fs";
import { canonicalId, parseAtsUrl } from "@jobvr/core";
import { fakeHttp } from "@jobvr/core/testing";
import { describe, expect, it } from "vitest";
import { adapters } from "./index";
import { REMOTE_US } from "./shared";
import { parseLocation, parseSalary, SPEEDYAPPLY_URL, speedyapply } from "./speedyapply";

const fixture = readFileSync(new URL("./fixtures/speedyapply.md", import.meta.url), "utf8");
const ok = (data: string) => ({ status: "ok" as const, etag: '"sa1"', data });

describe("speedyapply adapter", () => {
  it("reads every table, with and without a Salary column", async () => {
    const { http } = fakeHttp({ [SPEEDYAPPLY_URL]: ok(fixture) });
    const res = await speedyapply.fetch({ http });
    if (res.status !== "ok") throw new Error("expected ok");
    // The last row has 3 cells for a 5-column table: counted, not fatal
    expect(res.invalidCount).toBe(1);
    expect(res.etag).toBe('"sa1"');
    expect(res.jobs.map((j) => j.companyName)).toEqual([
      "Twitch",
      "Amazon",
      "Adept Consulting Services",
      "Jabil",
      "Affirm",
      "Motorola Solutions",
    ]);
    const [twitch, , adept] = res.jobs;
    expect(twitch).toMatchObject({
      source: "speedyapply",
      title: "Software Engineer I - Payments",
      locations: ["San Francisco, CA"],
      url: "https://job-boards.greenhouse.io/twitch/jobs/8943553002",
      postedAtPrecision: "day",
      salary: { currency: "USD", interval: "year", max: 193_000 },
      meta: { active: true, visible: true, category: "Software Engineering" },
    });
    expect(adept?.salary).toBeUndefined();
    expect(adept?.locations).toEqual(["Harrisburg, PA"]);
    // Ids are stable across polls (same link, same id)
    const again = await speedyapply.fetch({ http });
    if (again.status !== "ok") throw new Error("expected ok");
    expect(again.jobs.map((j) => j.sourceJobId)).toEqual(res.jobs.map((j) => j.sourceJobId));
  });

  it("dates rows from their age in days", async () => {
    const { http } = fakeHttp({ [SPEEDYAPPLY_URL]: ok(fixture) });
    const res = await speedyapply.fetch({ http });
    if (res.status !== "ok") throw new Error("expected ok");
    const twitch = res.jobs[0];
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const age = /\| (\d+)d \|$/.exec(fixture.split("\n").find((l) => l.includes("Twitch")) ?? "");
    expect(twitch?.postedAt.getTime()).toBe(midnight - Number(age?.[1]) * 86_400_000);
  });

  it("links to the posting itself, so board jobs dedupe by URL", async () => {
    const { http } = fakeHttp({ [SPEEDYAPPLY_URL]: ok(fixture) });
    const res = await speedyapply.fetch({ http });
    if (res.status !== "ok") throw new Error("expected ok");
    const twitch = res.jobs[0];
    const parsed = twitch && parseAtsUrl(adapters, twitch.url);
    expect(parsed && canonicalId(parsed.adapter, parsed.sourceJobId)).toBe("gh:8943553002");
  });

  it("normalizes its locations", () => {
    expect(parseLocation("New York City, NY +1")).toEqual(["New York City, NY"]);
    expect(parseLocation("Remote - Austin, TX")).toEqual(["Austin, TX", REMOTE_US]);
    expect(parseLocation("Remote - USA +1")).toEqual([REMOTE_US]);
    expect(parseLocation("Remote - Georgia, USA")).toEqual(["Georgia, USA", REMOTE_US]);
    expect(parseLocation("Remote - Canada +1")).toEqual(["Remote - Canada"]);
  });

  it("reads hourly and yearly pay", () => {
    expect(parseSalary("$193k/yr")).toEqual({ currency: "USD", interval: "year", max: 193_000 });
    expect(parseSalary("$45/hr")).toEqual({ currency: "USD", interval: "hour", max: 45 });
    expect(parseSalary("")).toBeUndefined();
  });

  it("fails loudly when the README has no table (layout changed)", async () => {
    const { http } = fakeHttp({ [SPEEDYAPPLY_URL]: ok("# Moved to a new repo") });
    await expect(speedyapply.fetch({ http })).rejects.toThrow(/no job table/);
  });

  it("returns not_modified on 304", async () => {
    const { http, calls } = fakeHttp({ [SPEEDYAPPLY_URL]: { status: "not_modified" } });
    expect(await speedyapply.fetch({ http, etag: '"sa1"' })).toEqual({ status: "not_modified" });
    expect(calls[0]?.etag).toBe('"sa1"');
  });
});
