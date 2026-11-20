import type { RouteHandler } from "@hono/zod-openapi";
import { addSuggestion, dismissSuggestion, listOpenSuggestions, UNRATED_TIER } from "@jobvr/core";
import type { AppBindings } from "@/lib/create-app";
import { toCompanyDto } from "@/modules/companies/services";
import { created, ok } from "@/utils/response";
import type * as routes from "./routes";
import { toSuggestionDto } from "./services";

export const listHandler: RouteHandler<typeof routes.list, AppBindings> = async (c) => {
  const rows = await listOpenSuggestions(c.var.deps.database.db);
  return ok(c, rows.map(toSuggestionDto), { count: rows.length });
};

export const addHandler: RouteHandler<typeof routes.add, AppBindings> = async (c) => {
  const { database, registry } = c.var.deps;
  const tier = c.req.valid("json")?.tier ?? UNRATED_TIER;
  const company = await addSuggestion(database.db, registry, c.req.valid("param").id, tier);
  return created(c, toCompanyDto(company), "Company added");
};

export const dismissHandler: RouteHandler<typeof routes.dismiss, AppBindings> = async (c) => {
  await dismissSuggestion(c.var.deps.database.db, c.req.valid("param").id);
  return ok(c, null, { message: "Suggestion dismissed" });
};
