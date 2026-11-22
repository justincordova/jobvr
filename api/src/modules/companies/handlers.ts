import type { RouteHandler } from "@hono/zod-openapi";
import {
  addCompanyFrom,
  createCompany,
  deleteCompany,
  findCompanyByName,
  listCompaniesWithHealth,
  NotFoundError,
  runAutoTier,
  updateCompany,
} from "@jobvr/core";
import type { AppBindings, AppDeps } from "@/lib/create-app";
import { logger } from "@/lib/logger";
import { created, ok } from "@/utils/response";
import type * as routes from "./routes";
import { assertKnownAts, toCompanyDto, withCreateDefaults, withHealth } from "./services";

/**
 * Rates one company now (when a rater is configured), so its tier shows at once,
 * and returns it. Rating is best effort; when the AI finds it's a company already
 * listed under another name, it's merged and that company is returned.
 */
const rateNow = async (deps: AppDeps, company: { id: string; name: string }) => {
  try {
    await runAutoTier({
      database: deps.database,
      rater: deps.tierRater,
      state: deps.tierState,
      logger,
      now: deps.now,
      ids: [company.id],
    });
  } catch (err) {
    logger.warn({ err, company: company.name }, `couldn't rate ${company.name} now`);
  }
  const { db } = deps.database;
  const [found] = await listCompaniesWithHealth(db, company.id);
  if (found) return toCompanyDto(found, found.health, found.stats);
  const into = await findCompanyByName(db, company.name);
  if (!into) throw new NotFoundError(`Company ${company.name} not found`);
  return withHealth(db, into.id);
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
  // Creating links its unlinked list jobs, so the stats aren't zero
  return created(c, await withHealth(database.db, row.id), "Company created");
};

export const addHandler: RouteHandler<typeof routes.add, AppBindings> = async (c) => {
  const deps = c.var.deps;
  const { company, board } = await addCompanyFrom(c.req.valid("json").query, {
    database: deps.database,
    registry: deps.registry,
    http: deps.http,
    logger,
  });
  const dto = await rateNow(deps, company);
  return created(
    c,
    dto,
    dto.id !== company.id
      ? `${company.name} is already listed as ${dto.name}`
      : board
        ? `${company.name} added`
        : `${company.name} added; no job board found, so its jobs come from the new-grad lists`,
  );
};

export const updateHandler: RouteHandler<typeof routes.update, AppBindings> = async (c) => {
  const deps = c.var.deps;
  const { autoTier, ...body } = c.req.valid("json");
  assertKnownAts(deps.registry, body.ats);
  const { id } = c.req.valid("param");
  const row = await updateCompany(deps.database.db, id, {
    ...body,
    // A tier someone picks is kept; handing it back lets the AI rate it again
    ...(body.tier && { tierSource: "manual", tierReason: null }),
    ...(autoTier && { tierSource: "pending", tierReason: null }),
  });
  return ok(c, autoTier ? await rateNow(deps, row) : await withHealth(deps.database.db, id));
};

export const removeHandler: RouteHandler<typeof routes.remove, AppBindings> = async (c) => {
  await deleteCompany(c.var.deps.database.db, c.req.valid("param").id);
  return ok(c, null, { message: "Company deleted" });
};
