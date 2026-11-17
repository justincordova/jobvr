import { createConsoleLogger, createHttpClient, envLogLevel, runPoll } from "@jobvr/core";
import { adapters } from "../src/sources";
import { openDatabase } from "./db";

// Debug by default: one line per board, then the summary. LOG_LEVEL=info for just the changes.
const logger = createConsoleLogger({ level: envLogLevel("debug"), hide: ["target"] });

const database = await openDatabase();
try {
  const summary = await runPoll({
    database,
    registry: adapters,
    http: createHttpClient(),
    force: true,
    logger,
  });
  if (summary.ran && summary.targets.some((t) => t.status === "failed")) process.exitCode = 1;
} finally {
  await database.close();
}
