import { companies } from "@jobvr/core/schema";
import { createTestDatabase, fakeHttp } from "@jobvr/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedCompanies } from "./seed";
import { adapters } from "./sources";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

describe("seedCompanies", () => {
  it("probes slugs, applies the tier rule, and is insert-only", async () => {
    const { http } = fakeHttp({
      "https://api.lever.co/v0/postings/BlueMatrix?mode=json": {
        status: "ok",
        etag: null,
        data: [{}, {}],
      },
      "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs": {
        status: "ok",
        etag: null,
        data: { jobs: [] },
      },
    });
    const entries = [
      {
        name: "BlueMatrix",
        city: "NYC/Remote",
        state: "NY",
        tier: "Mid",
        ats: "lever",
        slug: "BlueMatrix",
      },
      { name: "Duolingo", tier: "A", ats: "greenhouse", slug: "duolingo" },
      { name: "Valon", tier: "Startup", ats: "greenhouse", slug: "valon" },
      { name: "Aurora Innovation", tier: "Mid", ats: "greenhouse" },
      { name: "Bloomberg", tier: "Corporate", ats: "other" },
    ] as const;
    const first = await seedCompanies(database.db, adapters, http, entries);
    expect(first).toEqual([
      { name: "BlueMatrix", result: "inserted", status: "ok", track: true, jobCount: 2 },
      { name: "Duolingo", result: "inserted", status: "ok", track: false, jobCount: 0 },
      { name: "Valon", result: "inserted", status: "needs_review", track: true },
      { name: "Aurora Innovation", result: "inserted", status: "needs_review", track: false },
      { name: "Bloomberg", result: "inserted", status: "manual_only", track: false },
    ]);
    const rows = await database.db.select().from(companies);
    expect(rows.find((c) => c.name === "BlueMatrix")).toMatchObject({
      slug: "BlueMatrix",
      city: "NYC/Remote",
    });

    const again = await seedCompanies(database.db, adapters, http, [
      { name: "bluematrix inc", tier: "S", ats: "lever", slug: "x" },
    ]);
    expect(again).toEqual([{ name: "bluematrix inc", result: "skipped" }]);
  });
});
