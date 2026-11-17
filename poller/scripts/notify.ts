import { createConsoleLogger, createNtfyNotifier, envLogLevel, runNotify } from "@jobvr/core";
import { adapters } from "../src/sources";
import { openDatabase } from "./db";

const dryRun = process.argv.includes("--dry-run");
const ntfyUrl = process.env.NTFY_URL?.trim();

const database = await openDatabase();
try {
  const summary = await runNotify({
    database,
    registry: adapters,
    notifier: ntfyUrl ? createNtfyNotifier(ntfyUrl) : null,
    publicUrl: process.env.PUBLIC_URL,
    force: true,
    dryRun,
    logger: createConsoleLogger({ level: envLogLevel("debug"), hide: ["target"] }),
  });
  if ("jobs" in summary) {
    for (const j of summary.jobs) console.log(`  ${j.companyName}: ${j.title}  (${j.url})`);
  }
  // This is the script's result, not a log line
  console.log(
    summary.sent
      ? `Sent: ${summary.jobs.length} jobs`
      : `Not sent: ${summary.reason.replaceAll("_", " ")}`,
  );
} finally {
  await database.close();
}
