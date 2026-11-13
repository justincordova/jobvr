import { createHttpClient } from "@jobvr/core";
import { discover } from "../src/discover";
import { adapters } from "../src/sources";

const names = process.argv.slice(2).filter((a) => a !== "--");
if (names.length === 0) {
  console.error('Usage: pnpm discover "<Company Name>" ["<Another>" ...]');
  process.exit(1);
}

const http = createHttpClient();
for (const name of names) {
  const { candidates, hits, errors } = await discover(name, adapters, http);
  console.log(`\n${name}  (${candidates.length} candidates)`);
  if (hits.length === 0) console.log("  not found on Greenhouse, Lever, or Ashby");
  for (const h of hits)
    console.log(`  ${h.ats.padEnd(11)} ${h.slug.padEnd(28)} ${h.jobCount} jobs`);
  for (const e of errors) console.log(`  error: ${e}`);
}
