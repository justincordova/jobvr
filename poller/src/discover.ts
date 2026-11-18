import { type HttpClient, type Registry, slugCandidates } from "@jobvr/core";

export { slugCandidates, splitWords } from "@jobvr/core";

export interface DiscoverHit {
  ats: string;
  slug: string;
  jobCount: number;
}

/** Probes every registered ATS for every candidate; writes nothing. */
export const discover = async (
  name: string,
  registry: Registry,
  http: HttpClient,
): Promise<{ candidates: string[]; hits: DiscoverHit[]; errors: string[] }> => {
  const candidates = slugCandidates(name);
  const hits: DiscoverHit[] = [];
  const errors: string[] = [];
  for (const adapter of registry) {
    if (adapter.kind !== "ats" || !adapter.probe) continue;
    const probe = adapter.probe.bind(adapter);
    // A few at a time per ATS to stay polite
    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
      const results = await Promise.allSettled(batch.map((slug) => probe(slug, { http })));
      results.forEach((r, j) => {
        const slug = batch[j] as string;
        if (r.status === "rejected") errors.push(`${adapter.id}/${slug}: ${String(r.reason)}`);
        else if (r.value.found) hits.push({ ats: adapter.id, slug, jobCount: r.value.jobCount });
      });
    }
  }
  return { candidates, hits, errors };
};
