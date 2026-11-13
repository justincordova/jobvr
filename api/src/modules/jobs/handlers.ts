import type { RouteHandler } from "@hono/zod-openapi";
import { listJobs, markVisit, setJobState } from "@jobvr/core";
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
      lastVisitAt: result.lastVisitAt?.toISOString() ?? null,
      newSinceLastVisit: result.newSinceLastVisit,
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
