import { and, eq, ne } from "drizzle-orm";
import { DAY_MS } from "./constants";
import type { Database } from "./db/client";
import { type CompanyRow, companies, jobSources, jobs } from "./db/schema";
import { ConflictError } from "./errors";
import { findBoardByName } from "./find-board";
import type { HttpClient } from "./http";
import { type Logger, silentLogger } from "./logger";
import { compactName } from "./poll/resolve";
import { updateCompany } from "./repos/companies";
import { getSettingsState } from "./repos/settings";
import { getAdapter, OTHER_ATS_ID, parseAtsUrl } from "./sources/registry";
import type { Registry } from "./sources/types";

/** Companies looked at per run (each search probes a dozen or so slugs per ATS). */
export const HEAL_PER_RUN = 3;
/** A company whose search found nothing is searched again after this long. */
export const HEAL_RETRY_MS = 6 * 60 * 60_000;
/** After this long with a broken board, the company is left to the new-grad lists. */
export const HEAL_GIVE_UP_MS = 3 * DAY_MS;

/**
 * A board found by guessing slugs from the name belongs to the company only
 * when its slug carries the whole name ("initech-io" for Initech): a probe
 * only says the board exists, and a shortened guess ("scale" for Scale AI)
 * can be another company's board.
 */
export const boardFitsCompany = (
  slug: string,
  company: Pick<CompanyRow, "normalizedName" | "aliases">,
): boolean => {
  const board = compactName(slug);
  return [company.normalizedName, ...company.aliases]
    .map(compactName)
    .some((name) => name.length > 0 && board.includes(name));
};

export interface HealOptions {
  database: Database;
  registry: Registry;
  http: HttpClient;
  logger?: Logger;
  now?: () => Date;
  /** Company id → when it was last searched (kept by the caller between runs). */
  attempts?: Map<string, number>;
  /** Stops before the next company once this much time has passed (the rest wait for the next run). */
  budgetMs?: number;
  /** Aborts the board probes in flight (shutdown); nothing else starts. */
  signal?: AbortSignal;
}

/**
 * Fixes companies whose board stopped answering (`needs_review`): usually the
 * company moved boards, so jobvr searches every ATS for its name, trying only
 * slugs that carry the whole name (see `boardFitsCompany`). Found: it
 * switches to the new board. Still nothing HEAL_GIVE_UP_MS after it broke,
 * and on a second search in a row: it stops being polled (`manual_only`); its
 * jobs keep coming from the new-grad lists.
 */
export const runHealCompanies = async (
  options: HealOptions,
): Promise<{ moved: string[]; gaveUp: string[] }> => {
  const { database, registry, http, signal } = options;
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
      .orderBy(companies.needsReviewSince)
  )
    .filter((c) => {
      const at = attempts.get(c.id);
      return at === undefined || now.getTime() - at >= HEAL_RETRY_MS;
    })
    .slice(0, HEAL_PER_RUN);

  const moved: string[] = [];
  const gaveUp: string[] = [];
  const started = performance.now();
  for (const [i, c] of broken.entries()) {
    if (signal?.aborted) break;
    if (options.budgetMs !== undefined && performance.now() - started >= options.budgetMs) {
      log.debug(
        { budgetMs: options.budgetMs, waiting: broken.length - i },
        `board search time budget used up; ${broken.length - i} broken board${broken.length - i === 1 ? " waits" : "s wait"} for the next run`,
      );
      break;
    }
    // Searched before in this process: a single search (right after a restart) never gives up
    const searchedBefore = attempts.has(c.id);
    attempts.set(c.id, now.getTime());
    const hit = await findBoardByName(c.name, {
      registry,
      http,
      disabled: settings.disabledSources,
      signal,
      accept: (slug) => boardFitsCompany(slug, c),
    });
    // Probes cut short by a shutdown prove nothing
    if (signal?.aborted) break;
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
        log.debug(
          { company: c.name, ats: hit.ats, slug: hit.slug },
          `not moving ${c.name} to ${hit.ats} ${hit.slug}: ${err.message}`,
        );
      }
    }
    const brokenSince = c.needsReviewSince ?? now;
    if (searchedBefore && now.getTime() - brokenSince.getTime() >= HEAL_GIVE_UP_MS) {
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

/** List-only companies checked per run (one board request each). */
export const LIST_BOARDS_PER_RUN = 5;

/**
 * Companies kept for their list jobs only (no readable board) whose list jobs
 * link to a board jobvr can read, as when a new ATS is supported: the board
 * with the most of their links is checked, and with open jobs it's polled.
 */
export const runFindListBoards = async (options: HealOptions): Promise<{ moved: string[] }> => {
  const { database, registry, http } = options;
  const { db } = database;
  const log = (options.logger ?? silentLogger).child({ module: "companies" });
  const now = (options.now ?? (() => new Date()))().getTime();
  const attempts = options.attempts ?? new Map<string, number>();
  const { settings } = await getSettingsState(db);
  const disabled = new Set(settings.disabledSources);

  const links = await db
    .select({ id: companies.id, name: companies.name, url: jobSources.url })
    .from(companies)
    .innerJoin(jobs, eq(jobs.companyId, companies.id))
    .innerJoin(jobSources, eq(jobSources.jobId, jobs.id))
    .where(and(eq(companies.ats, OTHER_ATS_ID), eq(companies.status, "manual_only")));

  // Company → board → how many of its links point there
  const boards = new Map<string, { name: string; counts: Map<string, BoardRef> }>();
  for (const l of links) {
    const parsed = parseAtsUrl(registry, l.url);
    if (!parsed?.slug || !parsed.adapter.probe || disabled.has(parsed.adapter.id)) continue;
    const entry = boards.get(l.id) ?? { name: l.name, counts: new Map() };
    boards.set(l.id, entry);
    const key = `${parsed.adapter.id}:${parsed.slug.toLowerCase()}`;
    const ref = entry.counts.get(key) ?? { ats: parsed.adapter.id, slug: parsed.slug, links: 0 };
    ref.links++;
    entry.counts.set(key, ref);
  }
  const due = [...boards]
    .filter(([id]) => {
      const at = attempts.get(id);
      return at === undefined || now - at >= DAY_MS;
    })
    .slice(0, LIST_BOARDS_PER_RUN);

  const moved: string[] = [];
  for (const [id, { name, counts }] of due) {
    if (options.signal?.aborted) break;
    attempts.set(id, now);
    const best = [...counts.values()].sort((a, b) => b.links - a.links)[0];
    const adapter = best && getAdapter(registry, best.ats);
    if (!best || !adapter?.probe) continue;
    let probe: { found: boolean; jobCount: number };
    try {
      probe = await adapter.probe(best.slug, { http, signal: options.signal });
    } catch {
      // Shutting down: checked again on the next start
      if (options.signal?.aborted) {
        attempts.delete(id);
        break;
      }
      // No answer: tried again tomorrow
      continue;
    }
    if (!probe.found || probe.jobCount === 0) continue;
    try {
      await updateCompany(db, id, { ats: best.ats, slug: best.slug, track: true, status: "ok" });
      attempts.delete(id);
      moved.push(name);
      log.info(
        { company: name, ats: best.ats, slug: best.slug },
        `found ${name}'s board from its list jobs: ${adapter.label} ${best.slug} (${probe.jobCount} jobs)`,
      );
    } catch (err) {
      // That board already belongs to another company
      if (!(err instanceof ConflictError)) throw err;
    }
  }
  return { moved };
};

interface BoardRef {
  ats: string;
  slug: string;
  links: number;
}
