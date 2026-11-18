import { and, eq, ne } from "drizzle-orm";
import { DAY_MS } from "./constants";
import type { Database } from "./db/client";
import { companies } from "./db/schema";
import { ConflictError } from "./errors";
import { findBoardByName } from "./find-board";
import type { HttpClient } from "./http";
import { type Logger, silentLogger } from "./logger";
import { updateCompany } from "./repos/companies";
import { getSettingsState } from "./repos/settings";
import { getAdapter } from "./sources/registry";
import type { Registry } from "./sources/types";

/** Companies looked at per run (each search probes a dozen or so slugs per ATS). */
export const HEAL_PER_RUN = 3;
/** A company whose search found nothing is searched again after this long. */
export const HEAL_RETRY_MS = 6 * 60 * 60_000;
/** After this long with a broken board, the company is left to the new-grad lists. */
export const HEAL_GIVE_UP_MS = 3 * DAY_MS;

export interface HealOptions {
  database: Database;
  registry: Registry;
  http: HttpClient;
  logger?: Logger;
  now?: () => Date;
  /** Company id → when it was last searched (kept by the caller between runs). */
  attempts?: Map<string, number>;
}

/**
 * Fixes companies whose board stopped answering (`needs_review`): usually the
 * company moved boards, so jobvr searches every ATS for its name. Found: it
 * switches to the new board. Still nothing after HEAL_GIVE_UP_MS: it stops
 * being polled (`manual_only`); its jobs keep coming from the new-grad lists.
 */
export const runHealCompanies = async (
  options: HealOptions,
): Promise<{ moved: string[]; gaveUp: string[] }> => {
  const { database, registry, http } = options;
  const { db } = database;
  const log = (options.logger ?? silentLogger).child({ module: "companies" });
  const now = (options.now ?? (() => new Date()))();
  const attempts = options.attempts ?? new Map<string, number>();
  const { settings } = await getSettingsState(db);

  const broken = (
    await db
      .select()
      .from(companies)
      .where(and(eq(companies.status, "needs_review"), ne(companies.ats, "other")))
      .orderBy(companies.updatedAt)
  )
    .filter((c) => {
      const at = attempts.get(c.id);
      return at === undefined || now.getTime() - at >= HEAL_RETRY_MS;
    })
    .slice(0, HEAL_PER_RUN);

  const moved: string[] = [];
  const gaveUp: string[] = [];
  for (const c of broken) {
    attempts.set(c.id, now.getTime());
    const hit = await findBoardByName(c.name, {
      registry,
      http,
      disabled: settings.disabledSources,
    });
    const isNew = hit && !(hit.ats === c.ats && hit.slug.toLowerCase() === c.slug?.toLowerCase());
    if (hit && isNew) {
      try {
        await updateCompany(db, c.id, { ats: hit.ats, slug: hit.slug, track: true, status: "ok" });
        attempts.delete(c.id);
        moved.push(c.name);
        const label = getAdapter(registry, hit.ats)?.label ?? hit.ats;
        log.info(
          { company: c.name, ats: hit.ats, slug: hit.slug },
          `found ${c.name}'s new board: ${label} ${hit.slug} (${hit.jobCount} jobs)`,
        );
        continue;
      } catch (err) {
        // That board already belongs to another company
        if (!(err instanceof ConflictError)) throw err;
      }
    }
    if (now.getTime() - c.updatedAt.getTime() >= HEAL_GIVE_UP_MS) {
      await updateCompany(db, c.id, { status: "manual_only", track: false });
      attempts.delete(c.id);
      gaveUp.push(c.name);
      log.info(
        { company: c.name },
        `no working board for ${c.name} in 3 days; its jobs still come from the new-grad lists`,
      );
    }
  }
  return { moved, gaveUp };
};
