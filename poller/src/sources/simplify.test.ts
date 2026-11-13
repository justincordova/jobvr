import { canonicalId, parseAtsUrl, SchemaDriftError } from "@jobvr/core";
import { fakeHttp } from "@jobvr/core/testing";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/simplify.json" with { type: "json" };
import { adapters } from "./index";
import { SIMPLIFY_URL, simplify } from "./simplify";

const ok = (data: unknown) => ({ status: "ok" as const, etag: 'W/"sj1"', data });

describe("simplify adapter", () => {
  it("maps listings and detects date precision", async () => {
    const { http } = fakeHttp({ [SIMPLIFY_URL]: ok(fixture) });
    const res = await simplify.fetch({ http });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.invalidCount).toBe(1);
    expect(res.jobs).toHaveLength(fixture.length - 1);
    const [day, instant] = res.jobs;
    expect(day).toMatchObject({
      source: "simplify",
      sourceJobId: fixture[0]?.id,
      companyName: fixture[0]?.company_name,
      postedAtPrecision: "day",
      meta: { active: true, visible: true, category: "Software" },
    });
    expect(day?.postedAt).toEqual(new Date(1783987200 * 1000));
    expect(instant?.postedAtPrecision).toBe("instant");
    expect(res.jobs.find((j) => j.meta?.active === false)).toBeDefined();
  });

  it("returns not_modified on 304", async () => {
    const { http, calls } = fakeHttp({ [SIMPLIFY_URL]: { status: "not_modified" } });
    expect(await simplify.fetch({ http, etag: 'W/"sj1"' })).toEqual({ status: "not_modified" });
    expect(calls[0]?.etag).toBe('W/"sj1"');
  });

  it("rejects a response that is mostly invalid", async () => {
    const { http } = fakeHttp({ [SIMPLIFY_URL]: ok([{ id: 1 }, { id: 2 }, fixture[0]]) });
    await expect(simplify.fetch({ http })).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it("gets canonical ATS ids from apply URLs via the registry", async () => {
    const { http } = fakeHttp({ [SIMPLIFY_URL]: ok(fixture) });
    const res = await simplify.fetch({ http });
    if (res.status !== "ok") throw new Error("expected ok");
    const ids = res.jobs.map((j) => {
      const parsed = parseAtsUrl(adapters, j.url);
      return parsed
        ? canonicalId(parsed.adapter, parsed.sourceJobId)
        : canonicalId(simplify, j.sourceJobId);
    });
    expect(ids).toEqual([
      `sj:${fixture[0]?.id}`,
      "gh:7669159003",
      "gh:5157866008",
      "lv:d770926d-1d32-40d2-a43d-7fc4c6fd9350",
      expect.stringMatching(/^ab:83b78d23-/),
      `sj:${fixture[5]?.id}`,
      `sj:${fixture[6]?.id}`,
    ]);
  });
});
