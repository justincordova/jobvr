import { isNull } from "drizzle-orm";
import { DAY_MS, type Tier } from "./constants";
import type { Database } from "./db/client";
import { sourceState } from "./db/schema";
import { ConflictError } from "./errors";
import type { HttpClient } from "./http";
import { type Logger, silentLogger } from "./logger";
import { getSettingsState } from "./repos/settings";
import { addSuggestion, listOpenSuggestions } from "./repos/suggestions";
import { getAdapter } from "./sources/registry";
import type { Registry } from "./sources/types";

/** Companies added on their own start here; change it on the Companies page. */
export const AUTO_ADD_TIER: Tier = "Startup";
/** Boards checked per run, so a backlog spreads over a few polls. */
export const AUTO_ADD_PER_RUN = 10;
/** A board that didn't answer (or had no jobs) is tried again after this long. */
export const AUTO_ADD_RETRY_MS = DAY_MS;

export interface AutoAddOptions {
  database: Database;
  registry: Registry;
  http: HttpClient;
  logger?: Logger;
  now?: () => Date;
  /** Suggestion id → when its board last failed the check (kept by the caller between runs). */
  failures?: Map<string, number>;
}

/**
 * Grows the polled companies from the new-grad lists: an unlisted company whose
 * matching listings point at a Greenhouse, Lever or Ashby board is added as a
 * tracked company once that board answers with jobs. Its first poll is a
 * silent baseline, like any new company. Runs when "Add companies
 * automatically" (`suggestCompanies`) is on; dismissed suggestions are skipped.
 */
export const runAutoAddCompanies = async (
  options: AutoAddOptions,
): Promise<{ added: string[]; failed: string[] }> => {
  const { database, registry, http } = options;
  const { db } = database;
  const log = (options.logger ?? silentLogger).child({ module: "companies" });
  const now = (options.now ?? (() => new Date()))().getTime();
  const failures = options.failures ?? new Map<string, number>();
  const { settings } = await getSettingsState(db);
  if (!settings.suggestCompanies) return { added: [], failed: [] };

  const disabled = new Set(settings.disabledSources);
  const candidates = (await listOpenSuggestions(db))
    .filter((s) => {
      const adapter = getAdapter(registry, s.ats);
      if (adapter?.kind !== "ats" || !adapter.probe || !s.slug || disabled.has(adapter.id)) {
        return false;
      }
      const failedAt = failures.get(s.id);
      return failedAt === undefined || now - failedAt >= AUTO_ADD_RETRY_MS;
    })
    .slice(0, AUTO_ADD_PER_RUN);

  const added: string[] = [];
  const failed: string[] = [];
  for (const s of candidates) {
    const adapter = getAdapter(registry, s.ats);
    const probe = await adapter?.probe?.(s.slug ?? "", { http }).catch(() => null);
    if (!probe?.found || probe.jobCount === 0) {
      failures.set(s.id, now);
      failed.push(s.displayName);
      continue;
    }
    failures.delete(s.id);
    const lists = Object.keys(s.listingCounts)
      .map((id) => getAdapter(registry, id)?.label ?? id)
      .join(", ");
    try {
      await addSuggestion(
        db,
        registry,
        s.id,
        AUTO_ADD_TIER,
        `Added automatically from ${lists || "the new-grad lists"} (${adapter?.label} board, ${probe.jobCount} jobs)`,
      );
      added.push(s.displayName);
      log.info(
        { ats: s.ats, slug: s.slug, jobCount: probe.jobCount },
        `added ${s.displayName} (${adapter?.label} ${s.slug}, ${probe.jobCount} jobs) from ${lists || "the new-grad lists"}`,
      );
    } catch (err) {
      // Added meanwhile (or the name or board already belongs to a company)
      if (!(err instanceof ConflictError)) throw err;
    }
  }

  if (added.length > 0) {
    // The lists' next poll refetches in full, so their jobs pick up the new companies
    await db.update(sourceState).set({ etag: null }).where(isNull(sourceState.companyId));
  }
  if (failed.length > 0) {
    log.debug({ failed }, `boards not added yet (no answer or no jobs): ${failed.join(", ")}`);
  }
  return { added, failed };
};
