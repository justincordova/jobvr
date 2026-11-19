import type { Registry, SourceAdapter } from "./types";

export const OTHER_ATS_ID = "other";

export const getAdapter = (registry: Registry, id: string): SourceAdapter | undefined =>
  registry.find((a) => a.id === id);

export const atsAdapters = (registry: Registry): SourceAdapter[] =>
  registry.filter((a) => a.kind === "ats");

export const aggregatorAdapters = (registry: Registry): SourceAdapter[] =>
  registry.filter((a) => a.kind === "aggregator");

/** Values allowed in `companies.ats` / `suggestions.ats`. */
export const atsValues = (registry: Registry): string[] => [
  ...atsAdapters(registry).map((a) => a.id),
  OTHER_ATS_ID,
];

export const isAts = (registry: Registry, source: string): boolean =>
  getAdapter(registry, source)?.kind === "ats";

/** Canonical job ID: `<idPrefix>:<sourceJobId>`. */
export const canonicalId = (adapter: SourceAdapter, sourceJobId: string): string =>
  `${adapter.idPrefix}:${sourceJobId}`;

/** First ATS adapter whose `parseUrl` recognizes the URL. */
export const parseAtsUrl = (
  registry: Registry,
  url: string,
): { adapter: SourceAdapter; sourceJobId: string; slug?: string } | null => {
  for (const adapter of atsAdapters(registry)) {
    let parsed: ReturnType<NonNullable<SourceAdapter["parseUrl"]>> | undefined;
    try {
      parsed = adapter.parseUrl?.(url);
    } catch {
      // One odd URL (community-edited SimplifyJobs data) must not fail a whole target
      parsed = null;
    }
    if (parsed) return { adapter, ...parsed };
  }
  return null;
};

export const sourceInfo = (registry: Registry) =>
  registry.map((a) => ({ id: a.id, label: a.label, kind: a.kind }));
