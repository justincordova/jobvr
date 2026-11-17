import { readFile } from "node:fs/promises";
import { createHttpClient } from "@jobvr/core";
import { z } from "zod";
import { SeedEntrySchema, seedCompanies } from "../src/seed";
import { adapters } from "../src/sources";
import { openDatabase } from "./db";

const file = new URL("../data/companies.json", import.meta.url);
const entries = z.array(SeedEntrySchema).parse(JSON.parse(await readFile(file, "utf8")));

const database = await openDatabase();
try {
  const outcomes = await seedCompanies(database.db, adapters, createHttpClient(), entries);
  for (const o of outcomes) {
    const detail =
      o.result !== "skipped"
        ? `${o.status}${o.track ? ", tracked" : ""}${o.jobCount !== undefined ? `, ${o.jobCount} jobs` : ""}`
        : "already exists";
    console.log(`${o.result.padEnd(8)} ${o.name.padEnd(24)} ${detail}`);
  }
  const count = (r: string) => outcomes.filter((o) => o.result === r).length;
  console.log(
    `\n${count("inserted")} inserted, ${count("upgraded")} moved to a supported board, ${count("skipped")} skipped`,
  );
} finally {
  await database.close();
}
