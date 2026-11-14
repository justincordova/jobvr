import {
  adjustedPostedAt,
  createHttpClient,
  getSettings,
  listCompanies,
  matchesAnyKeyword,
  passesKeywordRule,
  passesLocationRule,
  type SourceJob,
  STORE_WINDOW_MS,
  tokenize,
} from "@jobvr/core";
import { adapters } from "../src/sources";
import { openDatabase } from "./db";

/**
 * Read-only: fetches every board with a slug plus SimplifyJobs, runs each
 * listing through the matching rules, and reports why listings were rejected.
 */
const database = await openDatabase();
const settings = await getSettings(database.db);
const companies = (await listCompanies(database.db)).filter((c) => c.slug && c.ats !== "other");
const http = createHttpClient();
const now = Date.now();

type Reason = "pass" | "old" | "inactive" | "location" | "keyword";
type Row = {
  reason: Reason;
  oldMatch: boolean;
  ageDays: number;
  source: string;
  company: string;
  tier: string;
  title: string;
  locations: string[];
  category?: string;
};
const rows: Row[] = [];

const classify = (j: SourceJob, kind: "ats" | "aggregator") => {
  const posted = adjustedPostedAt(j.postedAt, j.postedAtPrecision).getTime();
  const ageDays = (now - posted) / 86_400_000;
  let reason: Reason = "pass";
  if (kind === "aggregator" && (j.meta?.active !== true || j.meta?.visible !== true))
    reason = "inactive";
  else if (!passesLocationRule(j.locations, settings)) reason = "location";
  else if (!passesKeywordRule(j.title, kind, settings, j.meta?.category)) reason = "keyword";
  const old = posted < now - STORE_WINDOW_MS;
  return { reason: old ? ("old" as const) : reason, oldMatch: old && reason === "pass", ageDays };
};

const byId = new Map(adapters.map((a) => [a.id, a]));
let failed = 0;
const queue = [...companies];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const adapter = byId.get(c.ats);
      if (!adapter || !c.slug) continue;
      try {
        const res = await adapter.fetch({ slug: c.slug, companyName: c.name, http });
        if (res.status !== "ok") continue;
        for (const j of res.jobs)
          rows.push({
            ...classify(j, "ats"),
            source: c.ats,
            company: c.name,
            tier: c.tier,
            title: j.title,
            locations: j.locations,
          });
      } catch {
        failed++;
      }
    }
  }),
);
const sj = await byId.get("simplify")?.fetch({ http });
if (sj?.status === "ok") {
  for (const j of sj.jobs)
    rows.push({
      ...classify(j, "aggregator"),
      tier: "-",
      source: "simplify",
      company: j.companyName,
      title: j.title,
      locations: j.locations,
      category: j.meta?.category,
    });
}
await database.close();

const count = (r: Reason, src?: "ats" | "simplify") =>
  rows.filter(
    (x) =>
      x.reason === r &&
      (!src || (src === "ats" ? x.source !== "simplify" : x.source === "simplify")),
  ).length;
const reasons: Reason[] = ["pass", "old", "inactive", "location", "keyword"];
console.log(
  `boards fetched: ${companies.length - failed}/${companies.length}, listings: ${rows.length}`,
);
console.log("reason        ats   simplify");
for (const r of reasons)
  console.log(
    `${r.padEnd(12)} ${String(count(r, "ats")).padStart(5)} ${String(count(r, "simplify")).padStart(9)}`,
  );
const tracked = new Set(settings.tiersToTrack);
const isAts = (x: Row) => x.source !== "simplify";
const pass = rows.filter((x) => x.reason === "pass");
console.log(
  `\npassing (<=7d): ats ${pass.filter(isAts).length} (in tracked tiers ${pass.filter((x) => isAts(x) && tracked.has(x.tier as never)).length}), simplify ${pass.filter((x) => !isAts(x)).length}`,
);
for (const d of [14, 30, 60]) {
  const old = rows.filter((x) => x.oldMatch && x.ageDays <= d);
  console.log(
    `older matches within ${d}d: ats ${old.filter(isAts).length}, simplify ${old.filter((x) => !isAts(x)).length}`,
  );
}
const show = (label: string, list: Row[], n = 40) => {
  console.log(`\n== ${label} (${list.length}) ==`);
  for (const x of list.slice(0, n))
    console.log(
      `  [${x.source}/${x.tier}] ${x.company} | ${x.title} | ${x.locations.slice(0, 3).join("; ")}${x.category ? ` | cat=${x.category}` : ""}`,
    );
};
show("passing ATS", pass.filter(isAts), 150);
show(
  "passing simplify",
  pass.filter((x) => !isAts(x)),
  80,
);
const SWE = ["software", "engineer", "developer", "swe"];
show(
  "keyword rejects, SWE-ish",
  rows.filter((x) => x.reason === "keyword" && matchesAnyKeyword(tokenize(x.title), SWE)),
  80,
);
show(
  "older matches (ATS, <=30d)",
  rows.filter((x) => x.oldMatch && isAts(x) && x.ageDays <= 30),
  40,
);
