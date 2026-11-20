import { type GetOptions, parseAtsUrl } from "@jobvr/core";
import { fakeHttp } from "@jobvr/core/testing";
import { describe, expect, it } from "vitest";
import { adapters } from "./index";
import { parseSmartRecruitersUrl, smartrecruiters } from "./smartrecruiters";

const page = (offset: number) =>
  `https://api.smartrecruiters.com/v1/companies/AbbVie/postings?country=us&limit=100&offset=${offset}`;
const DETAIL = "https://api.smartrecruiters.com/v1/companies/AbbVie/postings/744000145291599";

const ok = (data: unknown, etag: string | null = 'W/"p1"') => ({
  status: "ok" as const,
  etag,
  data,
});

const posting = (id: number, name = `Role ${id}`, remote = false) => ({
  id: String(id),
  name,
  releasedDate: "2026-11-18T16:27:49.511Z",
  company: { identifier: "AbbVie", name: "AbbVie" },
  location: {
    city: "North Chicago",
    region: "IL",
    country: "us",
    remote,
    fullLocation: "North Chicago, IL, United States",
  },
});

describe("smartrecruiters adapter", () => {
  it("reads every page of US postings and keeps the first page's ETag", async () => {
    const first = [
      posting(744000145291599, " Associate Software Engineer 1 "),
      posting(2, "Data Analyst", true),
    ];
    const { http, calls } = fakeHttp({
      [page(0)]: ok({
        totalFound: 203,
        content: [...first, ...Array.from({ length: 98 }, (_, i) => posting(10 + i))],
      }),
      [page(100)]: ok(
        { totalFound: 203, content: Array.from({ length: 100 }, (_, i) => posting(200 + i)) },
        null,
      ),
      [page(200)]: ok(
        { totalFound: 203, content: [posting(400), { id: "x" }, posting(401)] },
        null,
      ),
    });
    const res = await smartrecruiters.fetch({ slug: "AbbVie", companyName: "AbbVie", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(calls.map((c) => c.url)).toEqual([page(0), page(100), page(200)]);
    expect(res.etag).toBe('W/"p1"');
    expect(res.jobs).toHaveLength(202);
    expect(res.invalidCount).toBe(1);
    expect(res.jobs[0]).toEqual({
      source: "smartrecruiters",
      sourceJobId: "744000145291599",
      companyName: "AbbVie",
      companySlug: "AbbVie",
      title: "Associate Software Engineer 1",
      locations: ["North Chicago, IL, United States"],
      url: "https://jobs.smartrecruiters.com/AbbVie/744000145291599",
      postedAt: new Date("2026-11-18T16:27:49.511Z"),
      postedAtPrecision: "instant",
    });
    expect(res.jobs[1]?.locations).toEqual(["North Chicago, IL, United States", "Remote - US"]);
  });

  it("holds closures (as id-less invalid items) when the board stops at MAX_PAGES", async () => {
    const replies: Record<string, ReturnType<typeof ok>> = {};
    for (let p = 0; p < 25; p++) {
      replies[page(p * 100)] = ok({
        totalFound: 2500,
        content: Array.from({ length: 100 }, (_, i) => posting(1_000_000 + p * 100 + i)),
      });
    }
    const { http, calls } = fakeHttp(replies);
    const res = await smartrecruiters.fetch({ slug: "AbbVie", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(calls).toHaveLength(20);
    expect(res.jobs).toHaveLength(2000);
    expect(res.invalidCount).toBe(500);
    expect(res.invalidIds).toEqual([]);
  });

  it("holds closures when the pages hold fewer postings than totalFound", async () => {
    const { http } = fakeHttp({
      [page(0)]: ok({
        totalFound: 250,
        content: Array.from({ length: 100 }, (_, i) => posting(1_000_000 + i)),
      }),
      // A short page ends the read early
      [page(100)]: ok({ totalFound: 250, content: [posting(2_000_000)] }, null),
    });
    const res = await smartrecruiters.fetch({ slug: "AbbVie", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.jobs).toHaveLength(101);
    expect(res.invalidCount).toBe(149);
    expect(res.invalidIds).toEqual([]);
  });

  it("keeps one copy of a posting seen on two pages, holding closures for the one it hid", async () => {
    const { http } = fakeHttp({
      [page(0)]: ok({
        totalFound: 150,
        content: Array.from({ length: 100 }, (_, i) => posting(1_000_000 + i)),
      }),
      // A new posting on top pushed #1000099 down onto page 2; #1000150 slipped off the end
      [page(100)]: ok(
        {
          totalFound: 150,
          content: Array.from({ length: 50 }, (_, i) => posting(1_000_099 + i)),
        },
        null,
      ),
    });
    const res = await smartrecruiters.fetch({ slug: "AbbVie", http });
    if (res.status !== "ok") throw new Error("expected ok");
    const ids = res.jobs.map((j) => j.sourceJobId);
    expect(ids).toHaveLength(149);
    expect(new Set(ids).size).toBe(149);
    expect(res.invalidCount).toBe(1);
    expect(res.invalidIds).toEqual([]);
  });

  it("closes nothing extra on a complete board", async () => {
    const { http } = fakeHttp({
      [page(0)]: ok({ totalFound: 2, content: [posting(1_000_001), posting(1_000_002)] }),
    });
    const res = await smartrecruiters.fetch({ slug: "AbbVie", http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.invalidCount).toBe(0);
  });

  it("reads pages with the default timeout", async () => {
    const { http } = fakeHttp({
      [page(0)]: ok({
        totalFound: 101,
        content: Array.from({ length: 100 }, (_, i) => posting(1_000_000 + i)),
      }),
      [page(100)]: ok({ totalFound: 101, content: [posting(2_000_000)] }, null),
    });
    const timeouts: Array<number | undefined> = [];
    const spy = {
      ...http,
      getJson: (url: string, options?: GetOptions) => {
        timeouts.push(options?.timeoutMs);
        return http.getJson(url, options);
      },
    };
    await smartrecruiters.fetch({ slug: "AbbVie", http: spy });
    expect(timeouts).toEqual([undefined, undefined]);
  });

  it("returns not_modified when the first page hasn't changed", async () => {
    const { http, calls } = fakeHttp({ [page(0)]: { status: "not_modified" } });
    const res = await smartrecruiters.fetch({ slug: "AbbVie", etag: 'W/"p1"', http });
    expect(res).toEqual({ status: "not_modified" });
    expect(calls).toEqual([{ url: page(0), etag: 'W/"p1"' }]);
  });

  it("fetches one posting's description, without the company blurb", async () => {
    const { http } = fakeHttp({
      [DETAIL]: ok({
        jobAd: {
          sections: {
            companyDescription: { title: "Company", text: "<p>About AbbVie</p>" },
            jobDescription: { title: "Job", text: "<p>Write code &amp; tests.</p>" },
            qualifications: { title: "Qualifications", text: "<ul><li>BS in CS</li></ul>" },
            additionalInformation: { title: "More", text: "" },
          },
        },
      }),
    });
    expect(await smartrecruiters.fetchDetail?.("AbbVie", "744000145291599", { http })).toEqual({
      description: "Write code & tests.\nBS in CS",
    });
    expect(await smartrecruiters.fetchDetail?.("AbbVie", "1", { http })).toBeNull();
  });

  it("counts a company as found only when it has US postings", async () => {
    const { http } = fakeHttp({
      [page(0)]: ok({ totalFound: 1268, content: [posting(1)] }),
      "https://api.smartrecruiters.com/v1/companies/nope/postings?country=us&limit=100&offset=0":
        ok({ totalFound: 0, content: [] }),
    });
    expect(await smartrecruiters.probe?.("AbbVie", { http })).toEqual({
      found: true,
      jobCount: 1268,
    });
    expect(await smartrecruiters.probe?.("nope", { http })).toEqual({ found: false, jobCount: 0 });
    expect(await smartrecruiters.probe?.("gone", { http })).toEqual({ found: false, jobCount: 0 });
  });

  it("parses SmartRecruiters links", () => {
    expect(
      parseSmartRecruitersUrl("https://jobs.smartrecruiters.com/Wabtec/3743990014806166"),
    ).toEqual({ sourceJobId: "3743990014806166", slug: "Wabtec" });
    expect(
      parseSmartRecruitersUrl(
        "https://jobs.smartrecruiters.com/ServiceNow/744000162570099-business-development-representative?oga=true",
      ),
    ).toEqual({ sourceJobId: "744000162570099", slug: "ServiceNow" });
    expect(parseSmartRecruitersUrl("https://careers.smartrecruiters.com/ServiceNow")).toBeNull();
    expect(parseSmartRecruitersUrl("https://jobs.smartrecruiters.com/Acme/about-us")).toBeNull();
    expect(parseSmartRecruitersUrl("https://example.com/Acme/744000162570099")).toBeNull();
    expect(smartrecruiters.boardSlug?.("https://careers.smartrecruiters.com/ServiceNow")).toBe(
      "ServiceNow",
    );
    expect(
      smartrecruiters.boardSlug?.(
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Visa/publication/0b5b2b8e-8f7c-4a3e-9d1a-2f6c1e7b9a10?dcr_ci=Visa",
      ),
    ).toBe("Visa");
    expect(
      smartrecruiters.boardSlug?.("https://jobs.smartrecruiters.com/oneclick-ui/company/Acme%E0/x"),
    ).toBeNull();
    expect(smartrecruiters.boardSlug?.("https://jobs.smartrecruiters.com/oneclick-ui/")).toBeNull();
    // Its posting id is a uuid, not the numeric id the board lists
    expect(
      parseSmartRecruitersUrl(
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Visa/publication/0b5b2b8e-8f7c-4a3e-9d1a-2f6c1e7b9a10",
      ),
    ).toBeNull();
  });

  it("is what the lists' SmartRecruiters links resolve to", () => {
    expect(
      parseAtsUrl(adapters, "https://jobs.smartrecruiters.com/SopraSteria1/744000145341359"),
    ).toMatchObject({
      adapter: { id: "smartrecruiters" },
      sourceJobId: "744000145341359",
      slug: "SopraSteria1",
    });
  });
});
