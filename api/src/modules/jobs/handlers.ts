import type { RouteHandler } from "@hono/zod-openapi";
import { getJobDetails, listJobs, markVisit, setJobStage, setJobState } from "@jobvr/core";
import type { AppBindings } from "@/lib/create-app";
import { ok } from "@/utils/response";
import type * as routes from "./routes";
import { toJobDto } from "./services";

export const listHandler: RouteHandler<typeof routes.list, AppBindings> = async (c) => {
  const { database, registry, now } = c.var.deps;
  const result = await listJobs(database.db, registry, c.req.valid("query"), now());
  return ok(
    c,
    {
      jobs: result.jobs.map(toJobDto),
      total: result.total,
      lastVisitAt: result.lastVisitAt?.toISOString() ?? null,
      newSinceLastVisit: result.newSinceLastVisit,
      newJobs: result.newJobs.map(toJobDto),
    },
    { count: result.jobs.length },
  );
};

export const visitHandler: RouteHandler<typeof routes.visit, AppBindings> = async (c) => {
  const { database, now } = c.var.deps;
  await markVisit(database.db, now());
  return ok(c, null);
};

export const setStateHandler: RouteHandler<typeof routes.setState, AppBindings> = async (c) => {
  const { database, now } = c.var.deps;
  await setJobState(database.db, c.req.valid("param").id, c.req.valid("json").state, now());
  return ok(c, null);
};

export const detailsHandler: RouteHandler<typeof routes.details, AppBindings> = async (c) => {
  const { database } = c.var.deps;
  return ok(c, await getJobDetails(database.db, c.req.valid("param").id));
};

export const setStageHandler: RouteHandler<typeof routes.setStage, AppBindings> = async (c) => {
  const { database, now } = c.var.deps;
  await setJobStage(database.db, c.req.valid("param").id, c.req.valid("json").stage, now());
  return ok(c, null);
};
