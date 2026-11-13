import { z } from "@hono/zod-openapi";
import { SettingsPatchSchema, SettingsSchema } from "@jobvr/core";
import { envelope, isoNullable } from "@/lib/routes";

export const SourceHealthSchema = z.object({
  source: z.string(),
  label: z.string(),
  lastAttemptAt: isoNullable,
  lastSuccessAt: isoNullable,
  consecutiveFailures: z.number().int(),
  lastError: z.string().nullable(),
});

export const SourceInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["ats", "aggregator"]),
});

export const SettingsPayload = z
  .object({
    settings: SettingsSchema,
    lastPollAt: isoNullable,
    lastPushAt: isoNullable,
    lastVisitAt: isoNullable,
    sourceHealth: z.array(SourceHealthSchema),
    sources: z.array(SourceInfoSchema),
  })
  .openapi("SettingsPayload");

export const SettingsResponse = envelope(SettingsPayload);

export const SettingsPatchBody = SettingsPatchSchema.refine((b) => Object.keys(b).length > 0, {
  error: "Provide at least one setting to update",
}).openapi("SettingsPatch");
