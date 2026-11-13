import type { z } from "@hono/zod-openapi";
import {
  aggregatorAdapters,
  type Db,
  getSettingsState,
  getSourceHealth,
  InvalidError,
  type Registry,
  type SettingsPatch,
  sourceInfo,
} from "@jobvr/core";
import { isoOrNull } from "@/lib/routes";
import type { SettingsPayload } from "./schemas";

export const loadSettingsPayload = async (
  db: Db,
  registry: Registry,
): Promise<z.infer<typeof SettingsPayload>> => {
  const state = await getSettingsState(db);
  const aggregators = aggregatorAdapters(registry);
  const health = await getSourceHealth(
    db,
    aggregators.map((a) => a.id),
  );
  return {
    settings: state.settings,
    lastPollAt: isoOrNull(state.lastPollAt),
    lastPushAt: isoOrNull(state.lastPushAt),
    lastVisitAt: isoOrNull(state.lastVisitAt),
    sourceHealth: aggregators.map((a) => {
      const h = health.get(a.id);
      return {
        source: a.id,
        label: a.label,
        lastAttemptAt: isoOrNull(h?.lastAttemptAt ?? null),
        lastSuccessAt: isoOrNull(h?.lastSuccessAt ?? null),
        consecutiveFailures: h?.consecutiveFailures ?? 0,
        lastError: h?.lastError ?? null,
      };
    }),
    sources: sourceInfo(registry),
  };
};

export const assertKnownSources = (registry: Registry, patch: SettingsPatch) => {
  const known = new Set(registry.map((a) => a.id));
  const unknown = patch.enabledSources?.filter((s) => !known.has(s)) ?? [];
  if (unknown.length > 0) throw new InvalidError(`Unknown sources: ${unknown.join(", ")}`);
};
