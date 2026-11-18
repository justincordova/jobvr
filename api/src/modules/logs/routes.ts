import { createRoute } from "@hono/zod-openapi";
import { commonErrors, json, validationError } from "@/lib/routes";
import { LogListQuery, LogListResponse } from "./schemas";

const tags = ["logs"];

export const list = createRoute({
  operationId: "listLogs",
  method: "get",
  path: "/",
  tags,
  summary: "Recent log lines (info and above, secrets removed) since the server started",
  request: { query: LogListQuery },
  responses: {
    200: json(LogListResponse, "Entries after the cursor, oldest first"),
    400: validationError,
    ...commonErrors,
  },
});
