import {
  adjustedPostedAt,
  createHttpClient,
  getSettings,
  isEntryLevelTitle,
  listCompanies,
  matchesAnyKeyword,
  maxStoreWindowMs,
  passesExperienceRule,
  passesKeywordRule,
  passesLocationRule,
  requiredYears,
  type SourceJob,
  storeWindowMs,
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

// "experience": the description asks for too many years (Ashby/Lever only;
// Greenhouse descriptions need a request per job, which the poller makes)
type Reason = "pass" | "old" | "inactive" | "location" | "keyword" | "experience";
type Row = {
  reason: Reason;
  oldMatch: boolean;
  /** Passes the keyword rule (whatever the final reason). */
  titleOk: boolean;
  years: number | null;
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
  const titleOk = passesKeywordRule(j.title, kind, settings, j.meta?.category);
  const years = j.description === undefined ? null : requiredYears(j.description);
  if (
    reason === "pass" &&
    !passesExperienceRule({ title: j.title, requiredYears: years }, settings)
  )
    reason = "experience";
  const window =
    kind === "ats" && isEntryLevelTitle(j.title, settings)
      ? maxStoreWindowMs(settings)
      : storeWindowMs(settings);
  const old = posted < now - window;
  return {
    reason: old ? ("old" as const) : reason,
    oldMatch: old && reason === "pass",
    titleOk,
    years,
    ageDays,
  };
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
const reasons: Reason[] = ["pass", "old", "inactive", "location", "keyword", "experience"];
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
  `\npassing (in the store window): ats ${pass.filter(isAts).length} (in tracked tiers ${pass.filter((x) => isAts(x) && tracked.has(x.tier as never)).length}), simplify ${pass.filter((x) => !isAts(x)).length}`,
);
for (const d of [45, 60, 90]) {
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
  `asks for ${settings.experienceCutoffYears}+ years (hidden)`,
  rows
    .filter((x) => x.reason === "experience")
    .map((x) => ({ ...x, title: `${x.title} [${x.years}+ yrs]` })),
  80,
);
// Location strings of title-matching listings that the location rule dropped,
// most common first: a quick way to spot an unparsed "New York" variant
const locCounts = new Map<string, number>();
for (const x of rows.filter((r) => r.reason === "location" && r.titleOk))
  for (const l of x.locations) locCounts.set(l, (locCounts.get(l) ?? 0) + 1);
const topLocs = [...locCounts].sort((a, b) => b[1] - a[1]);
console.log(`\n== locations of title matches rejected by location (${topLocs.length}) ==`);
for (const [l, n] of topLocs.slice(0, 150)) console.log(`  ${String(n).padStart(4)}  ${l}`);
show(
  "older matches (ATS, <=30d)",
  rows.filter((x) => x.oldMatch && isAts(x) && x.ageDays <= 30),
  40,
);
