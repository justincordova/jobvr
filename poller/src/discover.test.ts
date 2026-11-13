import { fakeHttp } from "@jobvr/core/testing";
import { describe, expect, it } from "vitest";
import { discover, slugCandidates, splitWords } from "./discover";
import { adapters } from "./sources";

describe("slugCandidates", () => {
  it("splits on case boundaries and punctuation", () => {
    expect(splitWords("EliseAI")).toEqual(["Elise", "AI"]);
    expect(splitWords("Apprentice.io")).toEqual(["Apprentice", "io"]);
    expect(splitWords("Two Sigma")).toEqual(["Two", "Sigma"]);
  });

  it("generates forms in the specified order", () => {
    expect(slugCandidates("EliseAI")).toEqual([
      "EliseAI",
      "eliseai",
      "elise-ai",
      "Elise",
      "elise",
      "eliseaihq",
      "eliseai-hq",
      "eliseai-io",
      "eliseaiinc",
      "elise-aihq",
      "elise-ai-hq",
      "elise-ai-io",
      "elise-aiinc",
      "elisehq",
      "elise-hq",
      "elise-io",
      "eliseinc",
    ]);
  });

  it("dedupes single-word names", () => {
    const c = slugCandidates("Rilla");
    expect(c.slice(0, 2)).toEqual(["Rilla", "rilla"]);
    expect(new Set(c).size).toBe(c.length);
    expect(c).toContain("rillahq");
  });

  it("strips every trailing generic word", () => {
    expect(slugCandidates("Gecko Robotics")).toContain("gecko");
    expect(slugCandidates("Ellipsis Labs")).toContain("ellipsis");
  });
});

describe("discover", () => {
  it("reports which boards respond", async () => {
    const { http } = fakeHttp({
      "https://api.lever.co/v0/postings/Rilla?mode=json": { status: "ok", etag: null, data: [{}] },
      "https://api.ashbyhq.com/posting-api/job-board/rilla?includeCompensation=true": {
        status: "ok",
        etag: null,
        data: { jobs: [] },
      },
    });
    const { hits, errors } = await discover("Rilla", adapters, http);
    expect(hits).toEqual([
      { ats: "lever", slug: "Rilla", jobCount: 1 },
      { ats: "ashby", slug: "rilla", jobCount: 0 },
    ]);
    expect(errors).toEqual([]);
  });
});
