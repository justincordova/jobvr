import { createRoute } from "@hono/zod-openapi";
import { bodyErrors, commonErrors, json, validationError, writeErrors } from "@/lib/routes";
import { SettingsPatchBody, SettingsResponse } from "./schemas";

const tags = ["settings"];

export const get = createRoute({
  operationId: "getSettings",
  method: "get",
  path: "/",
  tags,
  summary: "Settings, run times, source health, and registered sources",
  responses: {
    200: json(SettingsResponse, "Settings"),
    ...commonErrors,
  },
});

export const update = createRoute({
  operationId: "updateSettings",
  method: "patch",
  path: "/",
  tags,
  summary: "Replace the given settings (arrays are replaced, not merged)",
  request: { body: { ...json(SettingsPatchBody, "Settings to replace"), required: true } },
  responses: {
    200: json(SettingsResponse, "Updated settings"),
    400: validationError,
    ...bodyErrors,
    ...writeErrors,
    ...commonErrors,
  },
});
