import type { RouteHandler } from "@hono/zod-openapi";
import { createCompany, deleteCompany, listCompaniesWithHealth, updateCompany } from "@jobvr/core";
import type { AppBindings } from "@/lib/create-app";
import { created, ok } from "@/utils/response";
import type * as routes from "./routes";
import { assertKnownAts, toCompanyDto, withCreateDefaults } from "./services";

const withHealth = async (db: AppBindings["Variables"]["deps"]["database"]["db"], id: string) => {
  const [found] = await listCompaniesWithHealth(db, id);
  if (!found) throw new Error("company vanished after write");
  return toCompanyDto(found, found.health, found.stats);
};

export const listHandler: RouteHandler<typeof routes.list, AppBindings> = async (c) => {
  const { database, now } = c.var.deps;
  const rows = await listCompaniesWithHealth(database.db, undefined, now());
  return ok(
    c,
    rows.map((r) => toCompanyDto(r, r.health, r.stats)),
    { count: rows.length },
  );
};

export const createHandler: RouteHandler<typeof routes.create, AppBindings> = async (c) => {
  const { database, registry } = c.var.deps;
  const body = c.req.valid("json");
  assertKnownAts(registry, body.ats);
  const row = await createCompany(database.db, withCreateDefaults(body));
  return created(c, toCompanyDto(row), "Company created");
};

export const updateHandler: RouteHandler<typeof routes.update, AppBindings> = async (c) => {
  const { database, registry } = c.var.deps;
  const body = c.req.valid("json");
  assertKnownAts(registry, body.ats);
  const { id } = c.req.valid("param");
  await updateCompany(database.db, id, body);
  return ok(c, await withHealth(database.db, id));
};

export const removeHandler: RouteHandler<typeof routes.remove, AppBindings> = async (c) => {
  await deleteCompany(c.var.deps.database.db, c.req.valid("param").id);
  return ok(c, null, { message: "Company deleted" });
};
