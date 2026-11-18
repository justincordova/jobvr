import type { RouteHandler } from "@hono/zod-openapi";
import type { AppBindings } from "@/lib/create-app";
import { iso } from "@/lib/routes";
import { ok } from "@/utils/response";
import type * as routes from "./routes";

export const listHandler: RouteHandler<typeof routes.list, AppBindings> = async (c) => {
  const { activity } = c.var.deps;
  const { after, limit } = c.req.valid("query");
  // Live data: never kept by the browser or a proxy
  c.header("Cache-Control", "no-store");
  return ok(c, {
    entries: activity.list(after, limit),
    latestSeq: activity.latestSeq,
    startedAt: iso(activity.startedAt),
    capacity: activity.capacity,
  });
};
