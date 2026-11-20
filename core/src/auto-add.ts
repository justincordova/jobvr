import { eq, isNull } from "drizzle-orm";
import { UNRATED_TIER } from "./add-company";
import { DAY_MS, type Tier } from "./constants";
import type { Database } from "./db/client";
import { type SuggestionRow, sourceState, suggestions } from "./db/schema";
import { ConflictError } from "./errors";
import type { HttpClient } from "./http";
import { type Logger, silentLogger } from "./logger";
import { indexCompanies, resolveCompany } from "./poll/resolve";
import { AUTO_ADDED_NOTE, listCompanies } from "./repos/companies";
import { getSettingsState } from "./repos/settings";
import { addSuggestion, listOpenSuggestions } from "./repos/suggestions";
import { getAdapter } from "./sources/registry";
import type { Registry } from "./sources/types";

/** Companies added on their own start here, until the AI rater (if configured) rates them. */
export const AUTO_ADD_TIER: Tier = UNRATED_TIER;
/** Companies added per run, so a backlog spreads over a few polls. */
export const AUTO_ADD_PER_RUN = 10;
/** A board that didn't answer is tried again after this long. */
export const AUTO_ADD_RETRY_MS = DAY_MS;

export interface AutoAddOptions {
  database: Database;
  registry: Registry;
  http: HttpClient;
  logger?: Logger;
  now?: () => Date;
  /** Suggestion id → when its board last failed the check (kept by the caller between runs). */
  failures?: Map<string, number>;
  /** Aborts the board check in flight (shutdown); nothing else starts. */
  signal?: AbortSignal;
}

/**
 * Grows the companies from the new-grad lists, so no job stays Unlisted: an
 * unlisted company whose listings point at a supported ATS board
 * with jobs is added and polled (its first poll is a silent baseline); any
 * other is added for its list jobs only (`manual_only`). Either way
 * `runAutoTier` rates its tier. A name that's another company's board slug
 * ("Kira" for Kira Learning's `kira`) is that company, not a new one. Runs when
 * "Add companies automatically" (`suggestCompanies`) is on; dismissed
 * suggestions are skipped.
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
  const known = indexCompanies(await listCompanies(db));
  const boardOf = (s: SuggestionRow) => {
    const adapter = getAdapter(registry, s.ats);
    return adapter?.kind === "ats" && adapter.probe && s.slug && !disabled.has(adapter.id)
      ? adapter
      : null;
  };
  const candidates = (await listOpenSuggestions(db))
    .filter((s) => {
      // A board on a source switched off in Settings waits until it's back on
      if (disabled.has(s.ats)) return false;
      const failedAt = failures.get(s.id);
      return failedAt === undefined || now - failedAt >= AUTO_ADD_RETRY_MS;
    })
    .slice(0, AUTO_ADD_PER_RUN);

  const added: string[] = [];
  const failed: string[] = [];
  for (const s of candidates) {
    if (options.signal?.aborted) break;
    // Already on the list under another name ("Kira" is Kira Learning, board "kira"),
    // or its board already belongs to a company with another name
    const owner = resolveCompany(
      known,
      s.displayName,
      s.slug ? { source: s.ats, slug: s.slug } : undefined,
    );
    if (owner) {
      await db.update(suggestions).set({ state: "added" }).where(eq(suggestions.id, s.id));
      log.debug(
        { suggestion: s.displayName, company: owner.name },
        `not adding ${s.displayName}: it's ${owner.name}, already on the list`,
      );
      continue;
    }
    const lists =
      Object.keys(s.listingCounts)
        .map((id) => getAdapter(registry, id)?.label ?? id)
        .join(", ") || "the new-grad lists";
    const board = boardOf(s);
    let probe: { found: boolean; jobCount: number } | null = null;
    if (board) {
      try {
        probe = (await board.probe?.(s.slug ?? "", { http, signal: options.signal })) ?? null;
      } catch {
        // Shutting down: not the board's fault
        if (options.signal?.aborted) break;
        // No answer: maybe a blip, so the board gets another chance tomorrow
        failures.set(s.id, now);
        failed.push(s.displayName);
        continue;
      }
    }
    failures.delete(s.id);
    // A board with jobs is polled; anything else is kept for its list jobs (and its tier)
    const polled = Boolean(board && probe?.found && probe.jobCount > 0);
    try {
      await addSuggestion(
        db,
        registry,
        s.id,
        AUTO_ADD_TIER,
        polled
          ? `${AUTO_ADDED_NOTE} from ${lists} (${board?.label} board, ${probe?.jobCount} jobs)`
          : `${AUTO_ADDED_NOTE} from ${lists} (no readable job board)`,
        "pending",
        !polled,
      );
      added.push(s.displayName);
      log.info(
        { ats: s.ats, slug: s.slug, jobCount: probe?.jobCount },
        polled
          ? `added ${s.displayName} (${board?.label} ${s.slug}, ${probe?.jobCount} jobs) from ${lists}`
          : `added ${s.displayName} from ${lists} (no readable job board: its jobs come from the lists)`,
      );
    } catch (err) {
      // Added meanwhile (or the name or board already belongs to a company)
      if (!(err instanceof ConflictError)) throw err;
      log.debug(
        { suggestion: s.displayName, ats: s.ats, slug: s.slug },
        `not adding ${s.displayName}: ${err.message}`,
      );
    }
  }

  if (added.length > 0) {
    // The lists' next poll refetches in full, so their jobs pick up the new companies
    await db.update(sourceState).set({ etag: null }).where(isNull(sourceState.companyId));
  }
  if (failed.length > 0) {
    log.debug({ failed }, `boards not added yet (no answer): ${failed.join(", ")}`);
  }
  return { added, failed };
};
