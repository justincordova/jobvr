import { describe, expect, it } from "vitest";
import { matchesKeyword, normalizeCompanyName, titleJaccard, tokenize, urlKey } from "./normalize";

describe("tokenize / matchesKeyword", () => {
  const t = (s: string) => tokenize(s);
  it("matches token sequences, not substrings", () => {
    expect(matchesKeyword(t("Sr. Software Engineer"), "sr.")).toBe(true);
    expect(matchesKeyword(t("Sr Software Engineer"), "sr.")).toBe(true);
    expect(matchesKeyword(t("Full-Stack Developer"), "full stack")).toBe(true);
    expect(matchesKeyword(t("Software Engineer II"), "software engineer i")).toBe(false);
    expect(matchesKeyword(t("Software Engineer I"), "software engineer i")).toBe(true);
    expect(matchesKeyword(t("Leadership Program"), "lead")).toBe(false);
    expect(matchesKeyword(t("anything"), "  ")).toBe(false);
  });
});

describe("normalizeCompanyName", () => {
  it("drops corporate suffixes and punctuation", () => {
    expect(normalizeCompanyName("The Regal Co., Inc.")).toBe("regal");
    expect(normalizeCompanyName("Regal")).toBe(normalizeCompanyName("Regal Inc"));
    expect(normalizeCompanyName("AT&T")).toBe("at and t");
    expect(normalizeCompanyName("Apprentice.io")).toBe("apprentice io");
  });
});

describe("urlKey", () => {
  it("normalizes host, trailing segments, and query", () => {
    expect(urlKey("https://www.Jobs.Lever.co/acme/abc-123/apply?lever-source=x#top")).toBe(
      "https://jobs.lever.co/acme/abc-123",
    );
    expect(urlKey("https://jobs.ashbyhq.com/acme/uuid/application?embed=true")).toBe(
      "https://jobs.ashbyhq.com/acme/uuid",
    );
    expect(urlKey("https://acme.com/careers/role/?gh_jid=123&utm=x")).toBe(
      "https://acme.com/careers/role?gh_jid=123",
    );
    expect(urlKey("https://boards.greenhouse.io/embed/job_app?token=55")).toBe(
      "https://boards.greenhouse.io/embed/job_app?token=55",
    );
  });

  it("is null for generic or invalid URLs", () => {
    expect(urlKey("https://acme.com/careers")).toBeNull();
    expect(urlKey("https://acme.com/careers?gh_jid=1")).toBeNull();
    expect(urlKey("https://acme.com/")).toBeNull();
    expect(urlKey("not a url")).toBeNull();
    expect(urlKey("mailto:jobs@acme.com")).toBeNull();
  });
});

describe("titleJaccard", () => {
  it("compares token sets", () => {
    expect(titleJaccard("Software Engineer, New Grad", "New Grad Software Engineer")).toBe(1);
    expect(titleJaccard("Software Engineer", "Software Engineer II")).toBeCloseTo(2 / 3);
  });
});
