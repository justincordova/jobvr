import {
  buildPush,
  createConsoleLogger,
  createNtfyNotifier,
  envLogLevel,
  getSettings,
  runNotify,
} from "@jobvr/core";
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
  if (summary.sent === false && summary.reason === "dry_run" && summary.jobs.length > 0) {
    // The push exactly as it would be sent
    const settings = await getSettings(database.db);
    const push = buildPush(summary.jobs, settings, adapters, new Date(), process.env.PUBLIC_URL);
    const indent = (s: string) => s.replace(/^/gm, "  │ ");
    console.log(`\n${indent(`${push.title}\n\n${push.body}`)}`);
    if (push.clickUrl) console.log(`  tap: ${push.clickUrl}`);
    for (const a of push.actions ?? []) console.log(`  button "${a.label}": ${a.url}`);
    console.log("");
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
