import type { RouteHandler } from "@hono/zod-openapi";
import { updateSettings } from "@jobvr/core";
import type { AppBindings } from "@/lib/create-app";
import { ok } from "@/utils/response";
import type * as routes from "./routes";
import { assertKnownSources, loadSettingsPayload } from "./services";

export const getHandler: RouteHandler<typeof routes.get, AppBindings> = async (c) => {
  const { database, registry, now } = c.var.deps;
  return ok(c, await loadSettingsPayload(database.db, registry, now()));
};

export const updateHandler: RouteHandler<typeof routes.update, AppBindings> = async (c) => {
  const { database, registry } = c.var.deps;
  const patch = c.req.valid("json");
  assertKnownSources(registry, patch);
  await updateSettings(database.db, patch);
  return ok(c, await loadSettingsPayload(database.db, registry, c.var.deps.now()));
};
