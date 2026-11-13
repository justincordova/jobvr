import type { HttpClient, Registry } from "@jobvr/core";

const STRIP_SUFFIXES = new Set(["ai", "labs", "inc", "technologies", "software", "robotics", "hq"]);
const LOWER_SUFFIXES = ["hq", "-hq", "-io", "inc"];

/** "EliseAI Labs" → ["Elise", "AI", "Labs"]. */
export const splitWords = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

/** Board slug guesses for a company name, most likely first. */
export const slugCandidates = (name: string): string[] => {
  const all = splitWords(name);
  const bases = [all];
  const trimmed = [...all];
  while (trimmed.length > 0 && STRIP_SUFFIXES.has(trimmed.at(-1)?.toLowerCase() ?? "")) {
    trimmed.pop();
  }
  if (trimmed.length > 0 && trimmed.length !== all.length) bases.push(trimmed);

  const out: string[] = [];
  const lowerForms: string[] = [];
  for (const words of bases) {
    const lower = words.map((w) => w.toLowerCase());
    out.push(words.join(""), lower.join(""), lower.join("-"));
    lowerForms.push(lower.join(""), lower.join("-"));
  }
  for (const form of lowerForms) {
    for (const suffix of LOWER_SUFFIXES) out.push(form + suffix);
  }
  return [...new Set(out.filter(Boolean))];
};

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
