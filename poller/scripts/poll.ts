import { consoleLogger, createHttpClient, runPoll } from "@jobvr/core";
import { adapters } from "../src/sources";
import { openDatabase } from "./db";

const database = await openDatabase();
try {
  const summary = await runPoll({
    database,
    registry: adapters,
    http: createHttpClient(),
    force: true,
    logger: consoleLogger,
  });
  if (!summary.ran) {
    console.log(`Poll did not run: ${summary.reason}`);
  } else {
    for (const t of summary.targets) {
      const detail =
        t.status === "failed"
          ? t.error
          : t.status === "skipped"
            ? "skipped (budget)"
            : t.stats.abandoned
              ? "abandoned (company changed)"
              : `+${t.stats.inserted} new, ${t.stats.merged} merged, ${t.stats.closed} closed${t.stats.baseline ? " (baseline)" : ""}`;
      console.log(`${t.status.padEnd(12)} ${t.label.padEnd(36)} ${detail}`);
    }
  }
} finally {
  await database.close();
}
