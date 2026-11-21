import { z } from "@hono/zod-openapi";
import { SUGGESTION_STATES, TIERS } from "@jobvr/core";
import { envelope } from "@/lib/routes";

export const SuggestionSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    ats: z.string(),
    slug: z.string().nullable(),
    listingCount: z.number().int(),
    sampleTitles: z.array(z.string()),
    lastSeenAt: z.iso.datetime(),
    state: z.enum(SUGGESTION_STATES),
  })
  .openapi("Suggestion");

export const SuggestionListResponse = envelope(z.array(SuggestionSchema));

export const AddSuggestionBody = z
  // Without one, the company starts unrated (C) and the AI rates it when configured
  .object({ tier: z.enum(TIERS).optional() })
  .openapi("AddSuggestionBody");

export const SuggestionParams = z.object({
  id: z
    .string()
    .min(1)
    .max(300)
    .openapi({ param: { name: "id", in: "path" }, example: "bask health" }),
});
