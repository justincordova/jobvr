import { isNull } from "drizzle-orm";
import type { Database } from "./db/client";
import { type CompanyRow, sourceState } from "./db/schema";
import { ConflictError, InvalidError } from "./errors";
import { asUrl, boardInLink, findBoardByName, nameFromLink } from "./find-board";
import type { HttpClient } from "./http";
import { type Logger, silentLogger } from "./logger";
import { createCompany, findCompanyByName } from "./repos/companies";
import { getSettingsState } from "./repos/settings";
import { OTHER_ATS_ID } from "./sources/registry";
import type { Registry } from "./sources/types";

/** Tier a company starts with until it's rated (the AI rater, or someone, changes it). */
export const UNRATED_TIER = "Startup" as const;
/** Same cap as a company created or renamed through the API. */
const MAX_COMPANY_NAME = 200;

export interface AddCompanyOptions {
  database: Database;
  registry: Registry;
  http: HttpClient;
  logger?: Logger;
}

/**
 * Adds a company from one line: a careers or board link, or a name. jobvr
 * looks for its board on every supported ATS itself; without one, the
 * company is still kept, so its jobs on the new-grad lists get its tier. Its
 * tier is `pending` until the AI rater (if configured) rates it.
 */
export const addCompanyFrom = async (
  input: string,
  options: AddCompanyOptions,
): Promise<{ company: CompanyRow; board: boolean }> => {
  const { database, registry, http } = options;
  const { db } = database;
  const log = (options.logger ?? silentLogger).child({ module: "companies" });
  const text = input.trim();
  if (!text) throw new InvalidError("Type a company name or paste a careers link");
  const { settings } = await getSettingsState(db);
  const finder = { registry, http, disabled: settings.disabledSources };

  const url = asUrl(text);
  let name = text;
  let board: { ats: string; slug: string } | null = null;
  if (url) {
    const linked = boardInLink(url, finder);
    name = nameFromLink(url, linked?.slug ?? null);
    if (linked) {
      // A missing board is `found: false`; a throw is the board being down or rate-limiting
      const probe = await linked.adapter.probe?.(linked.slug, { http }).catch((err: unknown) => {
        const why = err instanceof Error ? err.message : String(err);
        throw new InvalidError(
          `Couldn't reach that ${linked.adapter.label} board right now (${why}); try again in a minute`,
        );
      });
      if (!probe?.found) {
        throw new InvalidError(`That ${linked.adapter.label} board (${linked.slug}) doesn't exist`);
      }
      board = { ats: linked.adapter.id, slug: linked.slug };
    }
  }
  if (name.length > MAX_COMPANY_NAME) {
    throw new InvalidError(`A company name can be at most ${MAX_COMPANY_NAME} characters`);
  }
  const existing = await findCompanyByName(db, name);
  if (existing) throw new ConflictError(`${existing.name} is already on the list`);
  board ??= await findBoardByName(name, finder);

  const base = {
    name,
    tier: UNRATED_TIER,
    tierSource: "pending" as const,
    careersUrl: url && !board ? url.href : null,
    notes: "Added by hand",
  };
  // With its stored list jobs linked, and the lists' next poll refetching in
  // full (so their jobs pick it up), all at once
  const company = await db.transaction(async (tx) => {
    const row = board
      ? await createCompany(tx, {
          ...base,
          ats: board.ats,
          slug: board.slug,
          track: true,
          status: "ok",
        })
      : await createCompany(tx, {
          ...base,
          ats: OTHER_ATS_ID,
          slug: null,
          track: false,
          status: "manual_only",
        });
    await tx.update(sourceState).set({ etag: null }).where(isNull(sourceState.companyId));
    return row;
  });
  log.info(
    { ats: company.ats, slug: company.slug },
    board
      ? `added ${company.name} by hand (${board.ats} ${board.slug})`
      : `added ${company.name} by hand (no board found: its jobs come from the new-grad lists)`,
  );
  return { company, board: Boolean(board) };
};
