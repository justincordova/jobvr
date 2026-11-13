import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { createDatabase, type Database } from "../db/client";

const TEMPLATE_DB = "jobvr_template";

declare module "vitest" {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

/** A fresh, migrated database cloned from the template (isolated per call). */
export const createTestDatabase = async (): Promise<Database & { url: string }> => {
  const adminUrl = inject("pgAdminUrl");
  const name = `t_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return { ...createDatabase(url.toString(), { max: 5 }), url: url.toString() };
};
