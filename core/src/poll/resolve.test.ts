import { describe, expect, it } from "vitest";
import type { CompanyRow } from "../db/schema";
import { normalizeCompanyName } from "../normalize";
import { indexCompanies, resolveCompany } from "./resolve";

const company = (name: string, ats: string, slug: string | null): CompanyRow =>
  ({ id: name, name, normalizedName: normalizeCompanyName(name), ats, slug }) as CompanyRow;

describe("resolveCompany", () => {
  const index = indexCompanies([
    company("Kira Learning", "ashby", "kira"),
    company("Abnormal AI", "greenhouse", "abnormalsecurity"),
    company("Acme", "lever", "acme"),
    company("Hooli East", "lever", "hooli"),
    company("Hooli West", "greenhouse", "hooli"),
    company("Globex", "other", null),
  ]);

  it("finds a company by board, then name, then its board slug as a name", () => {
    expect(resolveCompany(index, "Whatever", { source: "ashby", slug: "KIRA" })?.name).toBe(
      "Kira Learning",
    );
    expect(resolveCompany(index, "Globex Inc.")?.name).toBe("Globex");
    expect(resolveCompany(index, "Kira")?.name).toBe("Kira Learning");
    expect(resolveCompany(index, "Abnormal Security")?.name).toBe("Abnormal AI");
  });

  it("doesn't guess when two companies share a slug, or for strangers", () => {
    expect(resolveCompany(index, "Acme")?.name).toBe("Acme");
    expect(resolveCompany(index, "Hooli")).toBeNull();
    expect(resolveCompany(index, "Initech")).toBeNull();
  });
});
