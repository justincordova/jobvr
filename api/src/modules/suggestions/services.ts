import type { z } from "@hono/zod-openapi";
import type { SuggestionRow, SuggestionState } from "@jobvr/core";
import { iso } from "@/lib/routes";
import type { SuggestionSchema } from "./schemas";

export const toSuggestionDto = (s: SuggestionRow): z.infer<typeof SuggestionSchema> => ({
  id: s.id,
  displayName: s.displayName,
  ats: s.ats,
  slug: s.slug,
  listingCount: s.listingCount,
  sampleTitles: s.sampleTitles,
  lastSeenAt: iso(s.lastSeenAt),
  state: s.state as SuggestionState,
});
