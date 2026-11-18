import type { RouteHandler } from "@hono/zod-openapi";
import {
  addCompanyFrom,
  createCompany,
  deleteCompany,
  listCompaniesWithHealth,
  runAutoTier,
  updateCompany,
} from "@jobvr/core";
import type { AppBindings, AppDeps } from "@/lib/create-app";
import { logger } from "@/lib/logger";
import { created, ok } from "@/utils/response";
import type * as routes from "./routes";
import { assertKnownAts, toCompanyDto, withCreateDefaults } from "./services";

const withHealth = async (db: AppDeps["database"]["db"], id: string) => {
  const [found] = await listCompaniesWithHealth(db, id);
  if (!found) throw new Error("company vanished after write");
  return toCompanyDto(found, found.health, found.stats);
};

/** Rates one company now (when a rater is configured), so its tier shows at once. */
const rateNow = (deps: AppDeps, id: string) =>
  runAutoTier({
    database: deps.database,
    rater: deps.tierRater,
    state: deps.tierState,
    logger,
    now: deps.now,
    ids: [id],
  });

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

export const addHandler: RouteHandler<typeof routes.add, AppBindings> = async (c) => {
  const deps = c.var.deps;
  const { company, board } = await addCompanyFrom(c.req.valid("json").query, {
    database: deps.database,
    registry: deps.registry,
    http: deps.http,
    logger,
  });
  await rateNow(deps, company.id);
  return created(
    c,
    await withHealth(deps.database.db, company.id),
    board
      ? `${company.name} added`
      : `${company.name} added; no job board found, so its jobs come from the new-grad lists`,
  );
};

export const updateHandler: RouteHandler<typeof routes.update, AppBindings> = async (c) => {
  const deps = c.var.deps;
  const { autoTier, ...body } = c.req.valid("json");
  assertKnownAts(deps.registry, body.ats);
  const { id } = c.req.valid("param");
  await updateCompany(deps.database.db, id, {
    ...body,
    // A tier someone picks is kept; handing it back lets the AI rate it again
    ...(body.tier && { tierSource: "manual", tierReason: null }),
    ...(autoTier && { tierSource: "pending", tierReason: null }),
  });
  if (autoTier) await rateNow(deps, id);
  return ok(c, await withHealth(deps.database.db, id));
};

export const removeHandler: RouteHandler<typeof routes.remove, AppBindings> = async (c) => {
  await deleteCompany(c.var.deps.database.db, c.req.valid("param").id);
  return ok(c, null, { message: "Company deleted" });
};
