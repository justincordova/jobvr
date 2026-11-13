import type { RouteHandler } from "@hono/zod-openapi";
import {
  createApplication,
  deleteApplication,
  listApplications,
  updateApplication,
} from "@jobvr/core";
import type { AppBindings } from "@/lib/create-app";
import { created, ok } from "@/utils/response";
import type * as routes from "./routes";
import { toApplicationDto } from "./services";

export const listHandler: RouteHandler<typeof routes.list, AppBindings> = async (c) => {
  const rows = await listApplications(c.var.deps.database.db);
  return ok(c, rows.map(toApplicationDto), { count: rows.length });
};

export const createHandler: RouteHandler<typeof routes.create, AppBindings> = async (c) => {
  const { database, now } = c.var.deps;
  const body = c.req.valid("json");
  const row = await createApplication(
    database.db,
    { ...body, appliedAt: body.appliedAt ? new Date(body.appliedAt) : undefined },
    now(),
  );
  return created(c, toApplicationDto(row), "Application created");
};

export const updateHandler: RouteHandler<typeof routes.update, AppBindings> = async (c) => {
  const { database, now } = c.var.deps;
  const body = c.req.valid("json");
  const row = await updateApplication(
    database.db,
    c.req.valid("param").id,
    { ...body, appliedAt: body.appliedAt ? new Date(body.appliedAt) : undefined },
    now(),
  );
  return ok(c, toApplicationDto(row));
};

export const removeHandler: RouteHandler<typeof routes.remove, AppBindings> = async (c) => {
  const { database, now } = c.var.deps;
  await deleteApplication(database.db, c.req.valid("param").id, now());
  return ok(c, null, { message: "Application deleted" });
};
