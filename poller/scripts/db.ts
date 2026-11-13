import { CORE_MIGRATIONS_DIR, createDatabase, runMigrations } from "@jobvr/core";

/** Connects with DATABASE_URL and applies pending migrations. */
export const openDatabase = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (copy .env.example to .env)");
    process.exit(1);
  }
  const database = createDatabase(url, { max: 4 });
  await runMigrations(database.db, CORE_MIGRATIONS_DIR);
  return database;
};
