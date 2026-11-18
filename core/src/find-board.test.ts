import { describe, expect, it } from "vitest";
import { asUrl, boardInLink, findBoardByName, nameFromLink, slugCandidates } from "./find-board";
import type { Registry, SourceAdapter } from "./sources/types";
import { fakeHttp } from "./testing";

const board = (
  id: string,
  jobs: Record<string, number>,
  failing: string[] = [],
): SourceAdapter => ({
  id,
  label: id,
  kind: "ats",
  idPrefix: id.slice(0, 2),
  concurrency: 1,
  fetch: async () => ({ status: "not_modified" }),
  boardSlug: (url) => (url.startsWith(`https://${id}.test/`) ? (url.split("/")[3] ?? null) : null),
  probe: async (slug) => {
    if (failing.includes(slug)) throw new Error("HTTP 500");
    const n = jobs[slug];
    return n === undefined ? { found: false, jobCount: 0 } : { found: true, jobCount: n };
  },
});
const { http } = fakeHttp({});

describe("finding a company's board", () => {
  it("reads links with or without a scheme, and leaves names alone", () => {
    expect(asUrl("acme.com/careers")?.href).toBe("https://acme.com/careers");
    expect(asUrl("https://jobs.lever.co/acme")?.hostname).toBe("jobs.lever.co");
    expect(asUrl("Acme Robotics")).toBeNull();
    expect(asUrl("Acme Inc.")).toBeNull();
  });

  it("names a company from its board slug or its site", () => {
    expect(nameFromLink(new URL("https://jobs.lever.co/blue-matrix"), "blue-matrix")).toBe(
      "Blue Matrix",
    );
    expect(nameFromLink(new URL("https://careers.acme.com/jobs"), null)).toBe("Acme");
    expect(nameFromLink(new URL("https://www.initech.io"), null)).toBe("Initech");
  });

  it("finds the ATS a link points at, skipping switched-off sources", () => {
    const registry: Registry = [board("gh", {}), board("lv", {})];
    expect(boardInLink(new URL("https://lv.test/acme/123"), { registry, http })).toMatchObject({
      adapter: { id: "lv" },
      slug: "acme",
    });
    expect(
      boardInLink(new URL("https://lv.test/acme"), { registry, http, disabled: ["lv"] }),
    ).toBeNull();
    expect(boardInLink(new URL("https://acme.com/careers"), { registry, http })).toBeNull();
  });

  it("picks the guessed board with the most jobs, ignoring empty boards and errors", async () => {
    expect(slugCandidates("Acme Labs")).toContain("acme");
    const registry: Registry = [
      board("gh", { acme: 0, AcmeLabs: 3 }),
      board("lv", { "acme-labs": 9 }, ["acmelabs"]),
    ];
    expect(await findBoardByName("Acme Labs", { registry, http })).toEqual({
      ats: "lv",
      slug: "acme-labs",
      jobCount: 9,
    });
    expect(await findBoardByName("Nobody", { registry, http })).toBeNull();
  });
});
