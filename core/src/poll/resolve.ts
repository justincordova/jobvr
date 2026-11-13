import type { CompanyRow } from "../db/schema";
import { matchedLocationLabels } from "../matching";
import { normalizeCompanyName, urlKey } from "../normalize";
import type { Settings } from "../settings";
import { canonicalId, getAdapter, parseAtsUrl } from "../sources/registry";
import type { Registry, SourceAdapter, SourceJob } from "../sources/types";

export interface CompanyIndex {
  byId: Map<string, CompanyRow>;
  byAtsSlug: Map<string, CompanyRow>;
  byName: Map<string, CompanyRow>;
}

const atsSlugKey = (ats: string, slug: string) => `${ats}\u0000${slug.toLowerCase()}`;

export const indexCompanies = (rows: readonly CompanyRow[]): CompanyIndex => {
  const index: CompanyIndex = { byId: new Map(), byAtsSlug: new Map(), byName: new Map() };
  for (const c of rows) {
    index.byId.set(c.id, c);
    if (c.slug) index.byAtsSlug.set(atsSlugKey(c.ats, c.slug), c);
    index.byName.set(c.normalizedName, c);
  }
  return index;
};

/** Simplify jobs: same ats + slug (case-insensitive), else same normalized name, else none. */
export const resolveCompany = (
  index: CompanyIndex,
  name: string,
  ats?: { source: string; slug?: string },
): CompanyRow | null => {
  if (ats?.slug) {
    const bySlug = index.byAtsSlug.get(atsSlugKey(ats.source, ats.slug));
    if (bySlug) return bySlug;
  }
  return index.byName.get(normalizeCompanyName(name)) ?? null;
};

export interface SourceKey {
  source: string;
  sourceJobId: string;
}

export interface PreparedListing {
  listing: SourceJob;
  adapter: SourceAdapter;
  canonicalId: string;
  /** (source, sourceJobId) plus the ATS posting its URL identifies, if any. */
  sourceKeys: SourceKey[];
  urlKey: string | null;
  /** The ATS posting the listing's URL points at (or the listing itself for ATS sources). */
  atsRef: (SourceKey & { slug?: string }) | null;
  company: CompanyRow | null;
  companyNorm: string;
  labels: string[];
}

export const prepareListing = (
  listing: SourceJob,
  registry: Registry,
  companies: CompanyIndex,
  settings: Settings,
  polledCompany: CompanyRow | null,
): PreparedListing => {
  const adapter = getAdapter(registry, listing.source);
  if (!adapter) throw new Error(`Unknown source ${listing.source}`);
  const sourceKeys: SourceKey[] = [{ source: listing.source, sourceJobId: listing.sourceJobId }];
  const parsed = parseAtsUrl(registry, listing.url);
  if (parsed) {
    const key = { source: parsed.adapter.id, sourceJobId: parsed.sourceJobId };
    if (key.source !== listing.source || key.sourceJobId !== listing.sourceJobId) {
      sourceKeys.push(key);
    }
  }

  let id: string;
  let atsRef: PreparedListing["atsRef"];
  if (adapter.kind === "ats") {
    id = canonicalId(adapter, listing.sourceJobId);
    atsRef = {
      source: listing.source,
      sourceJobId: listing.sourceJobId,
      slug: listing.companySlug,
    };
  } else if (parsed) {
    id = canonicalId(parsed.adapter, parsed.sourceJobId);
    atsRef = { source: parsed.adapter.id, sourceJobId: parsed.sourceJobId, slug: parsed.slug };
  } else {
    id = canonicalId(adapter, listing.sourceJobId);
    atsRef = null;
  }

  const company =
    polledCompany ??
    resolveCompany(
      companies,
      listing.companyName,
      atsRef?.slug ? { source: atsRef.source, slug: atsRef.slug } : undefined,
    );

  return {
    listing,
    adapter,
    canonicalId: id,
    sourceKeys,
    urlKey: urlKey(listing.url),
    atsRef,
    company,
    companyNorm: normalizeCompanyName(company?.name ?? listing.companyName),
    labels: matchedLocationLabels(listing.locations, settings),
  };
};

/** Same company_id, or the same normalized name when either side has none. */
export const sameCompany = (
  a: { companyId: string | null; companyNorm: string },
  b: { companyId: string | null; companyNorm: string },
): boolean => {
  if (a.companyId && b.companyId) return a.companyId === b.companyId;
  return a.companyNorm === b.companyNorm;
};
