import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { createDatabase, runMigrations } from "../db/client";

const MIGRATIONS = new URL("../../drizzle", import.meta.url).pathname;
export const TEMPLATE_DB = "jobvr_template";

declare module "vitest" {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

/** Starts one Postgres 18 container per test run and migrates a template database. */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:18").start();
  const adminUrl = container.getConnectionUri();

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${TEMPLATE_DB}`;
  const template = createDatabase(url.toString(), { max: 1 });
  await runMigrations(template.db, MIGRATIONS);
  await template.close();

  project.provide("pgAdminUrl", adminUrl);
  return async () => {
    await container.stop();
  };
}
