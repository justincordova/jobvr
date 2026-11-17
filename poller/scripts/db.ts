import { readFileSync } from "node:fs";
import path from "node:path";
import { CORE_MIGRATIONS_DIR, createDatabase, runMigrations } from "@jobvr/core";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

/** Migrations this checkout has, and how many the database has applied. */
const migrationLevels = async (pool: ReturnType<typeof createDatabase>["pool"]) => {
  const journal = JSON.parse(
    readFileSync(path.join(CORE_MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  const exists = await pool.query<{ t: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations')::text as t",
  );
  const applied = exists.rows[0]?.t
    ? (
        await pool.query<{ n: number }>(
          "select count(*)::int as n from drizzle.__drizzle_migrations",
        )
      ).rows[0]?.n
    : 0;
  return { local: journal.entries.length, applied: applied ?? 0 };
};

/**
 * Connects with DATABASE_URL. A local (dev) database gets pending migrations
 * applied; a remote one (the PC, through the tailnet) never does, since that
 * would put this checkout's schema on production before it's deployed. Its
 * schema must match this checkout instead.
 */
export const openDatabase = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set (copy .env.example to .env)");
  const database = createDatabase(url as string, { max: 4 });
  const host = URL.canParse(url as string) ? new URL(url as string).hostname : "";
  if (LOCAL_HOSTS.has(host)) {
    await runMigrations(database.db, CORE_MIGRATIONS_DIR);
    return database;
  }
  const { local, applied } = await migrationLevels(database.pool);
  if (applied !== local) {
    await database.close();
    fail(
      applied < local
        ? `${host} has ${applied} of this checkout's ${local} migrations: deploy first (on the PC: git pull && docker compose up -d --build), then rerun`
        : `${host} has ${applied} migrations but this checkout has ${local}: git pull, then rerun`,
    );
  }
  return database;
};
