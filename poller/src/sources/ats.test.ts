import { HttpError, SchemaDriftError } from "@jobvr/core";
import { fakeHttp } from "@jobvr/core/testing";
import { describe, expect, it } from "vitest";
import { ashby, parseAshbyUrl } from "./ashby";
import ashbyFixture from "./fixtures/ashby.json" with { type: "json" };
import greenhouseFixture from "./fixtures/greenhouse.json" with { type: "json" };
import leverFixture from "./fixtures/lever.json" with { type: "json" };
import { greenhouse, parseGreenhouseUrl } from "./greenhouse";
import { lever, parseLeverUrl } from "./lever";

const GH = "https://boards-api.greenhouse.io/v1/boards/airtable/jobs";
const LV = "https://api.lever.co/v0/postings/gopuff?mode=json";
const AB = "https://api.ashbyhq.com/posting-api/job-board/livekit?includeCompensation=true";

const ok = (data: unknown, etag = '"v1"') => ({ status: "ok" as const, etag, data });

describe("greenhouse adapter", () => {
  it("maps jobs, skips invalid items, and returns the etag", async () => {
    const { http, calls } = fakeHttp({ [GH]: ok(greenhouseFixture) });
    const res = await greenhouse.fetch({ slug: "airtable", companyName: "Airtable", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.etag).toBe('"v1"');
    expect(res.invalidCount).toBe(1);
    expect(res.jobs).toHaveLength(4);
    const ng = res.jobs.find((j) => j.sourceJobId === "9000000001");
    expect(ng).toEqual({
      source: "greenhouse",
      sourceJobId: "9000000001",
      companyName: "Airtable",
      companySlug: "airtable",
      title: "Software Engineer, New Grad",
      locations: ["New York, NY"],
      url: "https://job-boards.greenhouse.io/airtable/jobs/9000000001",
      postedAt: new Date("2026-11-12T14:00:00Z"),
      postedAtPrecision: "instant",
    });
    // first_published, never updated_at
    const first = res.jobs[0];
    expect(first?.postedAt).toEqual(new Date("2026-03-03T11:25:37-05:00"));
    expect(calls[0]?.etag).toBeUndefined();
  });

  it("passes the etag and returns not_modified on 304", async () => {
    const { http, calls } = fakeHttp({ [GH]: { status: "not_modified" } });
    const res = await greenhouse.fetch({ slug: "airtable", etag: '"v1"', http });
    expect(res).toEqual({ status: "not_modified" });
    expect(calls[0]?.etag).toBe('"v1"');
  });

  it("throws on 404 and when most items are invalid", async () => {
    const { http } = fakeHttp({
      [GH]: ok({ jobs: [{ id: 1 }, { id: 2 }, greenhouseFixture.jobs[0]] }),
    });
    await expect(greenhouse.fetch({ slug: "nope", http })).rejects.toBeInstanceOf(HttpError);
    await expect(greenhouse.fetch({ slug: "airtable", http })).rejects.toBeInstanceOf(
      SchemaDriftError,
    );
  });

  it("treats an empty board as success", async () => {
    const { http } = fakeHttp({ [GH]: ok({ jobs: [] }) });
    const res = await greenhouse.fetch({ slug: "airtable", http });
    expect(res).toMatchObject({ status: "ok", jobs: [], invalidCount: 0 });
  });

  it("probes slugs", async () => {
    const { http } = fakeHttp({ [GH]: ok(greenhouseFixture) });
    expect(await greenhouse.probe?.("airtable", { http })).toEqual({ found: true, jobCount: 5 });
    expect(await greenhouse.probe?.("nope", { http })).toEqual({ found: false, jobCount: 0 });
  });

  it("fetches one job's description (HTML escaped twice) and pay range", async () => {
    const url = "https://boards-api.greenhouse.io/v1/boards/nyt/jobs/42?pay_transparency=true";
    const { http } = fakeHttp({
      [url]: ok({
        content:
          "&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;You&amp;rsquo;ll need 2+ years of experience &amp;amp; curiosity.&lt;/p&gt;",
        pay_input_ranges: [
          {
            min_cents: 8_900_000,
            max_cents: 12_000_000,
            currency_type: "USD",
            title: "The annual base pay range for this role is between:",
          },
        ],
      }),
    });
    expect(await greenhouse.fetchDetail?.("nyt", "42", { http })).toEqual({
      description: "About\nYou'll need 2+ years of experience & curiosity.",
      salary: { currency: "USD", interval: "year", min: 89_000, max: 120_000 },
    });
    const hourly = fakeHttp({
      [url]: ok({
        content: "",
        pay_input_ranges: [
          { min_cents: 2500, max_cents: 3000, currency_type: "USD", title: "Hourly pay" },
        ],
      }),
    });
    expect((await greenhouse.fetchDetail?.("nyt", "42", { http: hourly.http }))?.salary).toEqual({
      currency: "USD",
      interval: "hour",
      min: 25,
      max: 30,
    });
    // A job that's gone is null, not an error
    expect(await greenhouse.fetchDetail?.("nyt", "43", { http })).toBeNull();
  });

  it("parses every Greenhouse URL form", () => {
    for (const host of [
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "job-boards.eu.greenhouse.io",
      "job-boards.anz.greenhouse.io",
    ]) {
      expect(parseGreenhouseUrl(`https://${host}/acme/jobs/123?gh_src=x`)).toEqual({
        sourceJobId: "123",
        slug: "acme",
      });
    }
    expect(
      parseGreenhouseUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=77"),
    ).toEqual({ sourceJobId: "77" });
    expect(parseGreenhouseUrl("https://careers.acme.com/jobs/?gh_jid=4455")).toEqual({
      sourceJobId: "4455",
    });
    expect(parseGreenhouseUrl("https://acme.com/careers")).toBeNull();
    expect(parseGreenhouseUrl("https://job-boards.greenhouse.io/acme")).toBeNull();
  });
});

describe("lever adapter", () => {
  it("maps locations, Remote-US, and salary", async () => {
    const { http } = fakeHttp({ [LV]: ok(leverFixture) });
    const res = await lever.fetch({ slug: "gopuff", companyName: "Gopuff", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.invalidCount).toBe(1);
    const [remote, hybrid, gb, noAll] = res.jobs;
    expect(remote?.locations).toContain("Remote - US");
    expect(hybrid?.locations).not.toContain("Remote - US");
    expect(hybrid?.locations).toEqual(leverFixture[1]?.categories?.allLocations);
    expect(hybrid?.salary).toEqual({ currency: "USD", interval: "year", min: 110000, max: 140000 });
    expect(gb?.salary).toEqual({ currency: "GBP", interval: "hour", min: 20, max: 25 });
    expect(gb?.locations).not.toContain("Remote - US");
    expect(noAll?.locations).toEqual([leverFixture[3]?.categories?.location]);
    expect(noAll?.salary).toBeUndefined();
    expect(remote?.postedAt).toEqual(new Date(leverFixture[0]?.createdAt ?? 0));
    expect(remote?.url).toBe(leverFixture[0]?.hostedUrl);
    expect(remote?.companyName).toBe("Gopuff");
    // Description = intro + lists (HTML to text) + closing
    expect(remote?.description).toBe(
      "Gopuff is building the future of instant commerce.\nWhat you'll need\n5+ years managing engineering teams\nExperience with Kotlin & Swift\nGopuff is an equal opportunity employer.",
    );
    expect(hybrid?.description).toBeUndefined();
  });

  it("sends the slug with its original case", async () => {
    const { http, calls } = fakeHttp({});
    await expect(lever.fetch({ slug: "BlueMatrix", http })).rejects.toThrow();
    expect(calls[0]?.url).toBe("https://api.lever.co/v0/postings/BlueMatrix?mode=json");
  });

  it("parses Lever URLs", () => {
    const id = "bfa7bc15-793e-486c-a3f5-b27d84c53025";
    expect(parseLeverUrl(`https://jobs.lever.co/gopuff/${id}`)).toEqual({
      sourceJobId: id,
      slug: "gopuff",
    });
    expect(parseLeverUrl(`https://jobs.lever.co/BlueMatrix/${id}/apply?source=x`)).toEqual({
      sourceJobId: id,
      slug: "BlueMatrix",
    });
    expect(parseLeverUrl(`https://jobs.eu.lever.co/gopuff/${id}`)).toBeNull();
    expect(parseLeverUrl("https://jobs.lever.co/gopuff")).toBeNull();
    expect(parseLeverUrl(`https://jobs.lever.co/gopuff/${id}/other`)).toBeNull();
  });
});

describe("ashby adapter", () => {
  it("drops unlisted jobs and only tags true remote US jobs", async () => {
    const { http } = fakeHttp({ [AB]: ok(ashbyFixture) });
    const res = await ashby.fetch({ slug: "livekit", companyName: "LiveKit", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.invalidCount).toBe(0);
    expect(res.jobs).toHaveLength(3);
    const [namer, hybrid, usRemote] = res.jobs;
    expect(namer?.locations).toEqual(["North America", "EMEA"]);
    expect(namer?.salary).toEqual({ currency: "USD", interval: "year", min: 135000, max: 300000 });
    // Hybrid with isRemote = true and a US address must not get Remote - US
    expect(ashbyFixture.jobs[1]?.isRemote).toBe(true);
    expect(hybrid?.locations).not.toContain("Remote - US");
    expect(usRemote?.locations).toEqual(["Remote", "Remote - US"]);
    expect(usRemote?.salary).toEqual({ currency: "USD", interval: "hour", min: 50, max: 60 });
    expect(namer?.description).toContain("3+ years of experience");
    expect(hybrid?.description).toBeUndefined();
    expect(res.jobs.map((j) => j.sourceJobId)).not.toContain(
      "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
    );
  });

  it("parses Ashby URLs", () => {
    const id = "1757f49e-7e19-4c45-85f7-e4637dff66fb";
    expect(parseAshbyUrl(`https://jobs.ashbyhq.com/livekit/${id}/application?embed=true`)).toEqual({
      sourceJobId: id,
      slug: "livekit",
    });
    expect(parseAshbyUrl(`https://jobs.ashbyhq.com/livekit/${id}`)).toEqual({
      sourceJobId: id,
      slug: "livekit",
    });
    expect(parseAshbyUrl("https://jobs.ashbyhq.com/livekit")).toBeNull();
    expect(parseAshbyUrl(`https://example.com/livekit/${id}`)).toBeNull();
  });
});
