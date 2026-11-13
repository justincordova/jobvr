import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; repository functions accept either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export const createDatabase = (url: string, options: { max?: number } = {}): Database => {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  // An idle client error (e.g. Postgres restarted) must not crash the process
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
};

export const runMigrations = (db: Db, migrationsFolder: string) =>
  migrate(db, { migrationsFolder });

/** Absolute path of core's migrations folder when running from source. */
export const CORE_MIGRATIONS_DIR = new URL("../../drizzle", import.meta.url).pathname;
