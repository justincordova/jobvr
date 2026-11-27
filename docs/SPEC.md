# jobvr

## Vision

A personal, single-user job-hunting app that polls company job boards
(Greenhouse, Lever, Ashby, SmartRecruiters, Workable) and three public new-grad
lists (SimplifyJobs, SpeedyApply, Jobright) for new-grad software engineering
roles, shows them in a web feed, and sends one bundled phone push per interval.
The company list looks after itself: companies the lists name are added, tiered
(optionally by an AI rater) and moved to a new board when theirs breaks. It runs
24/7 in Docker on a home Windows PC, and is structured so it can later move to
AWS serverless with minimal change.

## Goals

- New matching roles appear in the feed within one poll interval (default 10
  min) and are pushed within one push interval (default 30 min), outside quiet hours.
- One bundled push ("5 new jobs") per interval; no push when nothing is new.
- No duplicate jobs across sources; direct ATS data wins over SimplifyJobs data.
- "Applied" is a one-click mark that moves a job out of the feed and pushes into
  the Applied view, dated. No application tracking (statuses, notes, board):
  applying is the goal, not tracking.
- Hands-off companies: no job should stay Unlisted and no company needs a
  person. Companies the new-grad lists name are added on their own (polled when
  they have a readable board), rated by the AI rater when `OPENAI_API_KEY` is
  set, healed when their board breaks, and folded into an existing company when
  they're the same one under another name (see [Company upkeep](#company-upkeep)).
  Guards: a tier someone picked or the seed set is never overwritten, the AI can
  only merge an auto-added company into a lookalike, a removed company stays
  removed, and AI calls are capped at 200 a day. A person can still add a
  company by link or name, pick a tier, or remove one.
- Every user preference (filters, schedules, notifications, sources) is a
  setting stored in the DB and editable in the UI. Operational constants live in
  code and are listed under [Constants](#constants).
- Adding a new job source = one adapter file + one registry entry.
- Usable from Mac and phone anywhere via Tailscale.
- Cost: $0/month while running on the PC, plus optional OpenAI usage for tier
  ratings (about $0.0003 a company, at most 200 calls a day; without a key,
  new companies stay C, unrated).

## Non-Goals

- Multi-user, signup, or public internet access.
- Sources beyond the five ATS APIs (Greenhouse, Lever, Ashby, SmartRecruiters,
  Workable) and the public new-grad lists (SimplifyJobs, SpeedyApply, Jobright's
  GitHub list): no Workday, Amazon Jobs, iCIMS, Avature, custom career sites,
  other ATS platforms, HN, headless scraping, or anything requiring login or
  forbidden by terms (LinkedIn, Indeed, Glassdoor, Handshake).
- SMS and email digests (push covers alerts; the unbuilt setting was removed in Nov 2026).
- AWS deployment in the MVP (see [Future: AWS](#future-aws)).
- AI beyond company tiers: matching, ranking, dedupe and pushes stay rule-based.
  The rater's "same company" answer is only trusted inside the merge guards.
- A Track switch or a review queue: whether a company is polled follows from its
  board and tier, and nothing waits on a click (the Suggested page was removed).

## Architecture

pnpm workspace monorepo. One Node process (Hono) serves the API and the built web
SPA, and runs an in-process scheduler. Postgres 18 runs beside it. Both run via
`docker compose` on the Windows PC (Docker Desktop + WSL2, `restart:
unless-stopped`).

Access is over Tailscale, and the tailnet is the auth boundary
(`AUTH_MODE=none`). A `tailscale/tailscale` sidecar container joins the tailnet
as node `jobvr` and applies a serve config (`TS_SERVE_CONFIG`):

- HTTPS `https://jobvr.<tailnet>.ts.net` → app:3000 (valid TLS cert; the PWA
  service worker and phone install require a secure context).
- TCP 5432 → postgres:5432, for Mac access (TablePlus / Drizzle Studio).

No ports are published on the PC host, so nothing is reachable from the LAN
(required because `AUTH_MODE=none`). Prerequisites: MagicDNS and HTTPS
certificates enabled in the Tailscale admin console; `TS_AUTHKEY` in `.env`.

```
jobvr/                       pnpm 12, Node 26
├── core/      @jobvr/core   Zod schemas, Drizzle schema + migrations, repositories,
│                            SourceAdapter interface, matching, freshness, dedupe,
│                            runPoll(), runNotify(), runCleanup(), ntfy notifier,
│                            company upkeep (auto-add, tiering, heal-companies,
│                            find-board, add-company)
├── poller/    @jobvr/poller src/sources/{greenhouse,lever,ashby,smartrecruiters,
│                            workable,simplify,speedyapply,jobright}.ts,
│                            src/sources/index.ts (registry), scripts/{poll,notify,
│                            discover,seed,match-report}.ts, data/companies.json,
│                            fixtures
├── api/       @jobvr/api    from hono-starter; modules/{jobs,companies,
│                            suggestions,settings,logs}; src/index.ts (API + web/dist),
│                            src/scheduler, src/lib/activity-log.ts
├── web/       @jobvr/web    from react-starter; TanStack Router/Query,
│                            Tailwind + shadcn/ui, vite-plugin-pwa
├── docker-compose.yml       PC: app + postgres + tailscale + backup; no host ports
├── docker-compose.dev.yml   Mac: postgres only, published on 127.0.0.1:5432
└── Dockerfile               multi-stage: builds web, bundles api
```

Dependency direction: `core` ← `poller` ← `api`; `web` imports only the typed
client exported by `api` (`@jobvr/api/client`). `core` never imports `poller`:
`runPoll` receives the adapter registry as an argument (dependency injection),
and `api/src/index.ts` / `poller/scripts/poll.ts` wire them together.

`core` and `poller` are internal packages consumed as TypeScript source (no
build step): api's tsdown bundles them into `dist`, Vitest resolves them
directly, and poller scripts run with `tsx`. The web app's types come from
api's built `dist/client.d.ts` (the template's bundled-declarations approach,
which avoids leaking api's `@/*` aliases), so root `typecheck`/`build` build
the api client before the web app.

### Key Components

- **Source adapters** (`poller/src/sources/`): one file per source, each
  returning Zod-validated `SourceJob`s; registered in `sources/index.ts`.
- **runPoll** (`core`): fetch → normalize → filter → dedupe/merge → baseline →
  persist → closures → suggestions → health.
- **runNotify** (`core`): selects pushable jobs, sends one ntfy push, marks them notified.
- **runCleanup** (`core`): daily retention delete.
- **Company upkeep** (`core`): runAutoAddCompanies, runAutoTier,
  runHealCompanies, runFindListBoards (see [Company upkeep](#company-upkeep)).
- **Scheduler** (`api/src/scheduler`, started by `api/src/index.ts`): a tick every 5 min plus one tick 10 s after
  boot, never two at once (a tick that finds the previous one running logs a
  warning and returns). Each tick runs, in order: poll, notify (right after
  the poll, so company upkeep never delays a push), auto-add, tiers, heal, list
  boards, cleanup, backup check, poll check. Each step checks whether it is due
  (or has work) and returns at once if not; a step that throws is logged and the
  next step still runs. The tiers and heal steps each start new work for at
  most 60 s per tick (`UPKEEP_BUDGET_MS`; a call or search in flight finishes,
  the rest waits for the next tick). Disabled with
  `SCHEDULER_ENABLED=false`. Timers pause while the PC sleeps, so a wake check
  reads the wall clock every 15 s (`WAKE_CHECK_MS`); a gap more than 60 s
  (`WAKE_GAP_MS`) past that means it just woke, and it logs "woke after …" and
  ticks at once instead of waiting out the paused interval. (On AWS this becomes an EventBridge Scheduler rule
  invoking the same functions.) On SIGTERM the scheduler stops ticking and
  aborts a shared stop signal: a running poll's fetches abort (an aborted poll
  writes nothing and restores `last_poll_at`, so the next start polls again),
  as do the auto-add, tiers, heal and list-board probes and AI calls (none of
  them counts against the board or company); no later step starts, and shutdown
  waits for the tick to end. A push being sent finishes and is
  marked (ntfy timeout 5 s, under the 8 s grace), so it's never sent twice.
- **Locks**: runPoll and runNotify each take their own Postgres
  `pg_try_advisory_lock` (distinct keys) on a dedicated connection held for the
  run; if not acquired, they return immediately. The lock is released when the run
  ends or the connection drops. This prevents overlap between the server's tick
  and a manual `pnpm poll` / `pnpm notify`. The step order inside each run is
  defined in [Poll](#poll-runpoll) and [Notify](#notify-runnotify). The manual
  scripts pass `force: true` to skip the due check (and quiet hours for notify); `pnpm notify --dry-run` prints the
  pushable jobs without sending or marking anything.
- **Ports** (interfaces with swappable implementations): repositories (Postgres),
  `Notifier` (ntfy), auth middleware (`AUTH_MODE`: `none`; later `cognito`),
  scheduler (in-process; later EventBridge).
- **API**: Hono + `@hono/zod-openapi`; typed `hc` client consumed by web.
- **Web**: React + Vite SPA. Pages: Feed (views Feed, Saved, Applied, Hidden),
  Companies, Settings, Logs.

### Data Flow

```
tick (5 min) ─┬─> runPoll ─> adapters (HTTP, ETag) ─> filter ─> dedupe ─> Postgres
              ├─> runNotify ─> Postgres (pushable jobs) ─> ntfy ─> phone
              ├─> auto-add / tiers / heal / list boards ─> ATS probes, OpenAI ─> Postgres
              ├─> runCleanup ─> Postgres
              └─> backup check / poll check ─> ntfy (alerts)
phone/Mac ── Tailscale HTTPS ──> Hono (API + SPA) ──> Postgres
```

## Sources

Verified 2026-11-12: Greenhouse, Lever, Ashby and SimplifyJobs respond, return
ETags, and return 304 on a matching `If-None-Match`; those three ATS APIs return
404 for unknown slugs. SmartRecruiters and Workable (added Nov 2026) differ:
SmartRecruiters returns an ETag on its first page, but an unknown company
answers 200 with 0 postings (so its `probe` counts a board as found only when it
has US postings); Workable sends no ETag, so every poll reads its whole list
(about 1 KB a job, no descriptions). The GitHub
lists (SimplifyJobs, then SpeedyApply and Jobright in Nov 2026) are "aggregators": the ATS
APIs can't read most mid-size and large companies (Workday, Oracle, iCIMS), and
the lists name many of them. SpeedyApply and Jobright are markdown READMEs
fetched with `getText` (same retries, ETag and size cap). Jobright has no public
API (its site needs a login); its public GitHub list is the feed used.

| Source       | Endpoint                                                                                      | Posted date                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greenhouse   | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` (no `content`)                               | `first_published` (`updated_at` only when it's null, as on a few HRT jobs)                          | `updated_at` changes on every edit, so it's never used when `first_published` exists. The list has no description or pay (`content=true` is ~50x larger and uncompressed), so they come from `/jobs/{id}?pay_transparency=true` per matching job (see Poll step 3).                                                                                                                                                                 |
| Lever        | `api.lever.co/v0/postings/{slug}?mode=json`                                                   | `createdAt` (epoch ms)                                                                              | Large uncompressed payloads (Gopuff 7.8 MB) → 304s matter. `salaryRange` exists but is rare.                                                                                                                                                                                                                                                                                           |
| Ashby        | `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`                       | `publishedAt`                                                                                       | Structured compensation. Only `isListed` jobs are kept.                                                                                                                                                                                                                                                                                                                                |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{slug}/postings?country=us&limit=100&offset={n}`     | `releasedDate`                                                                                      | US postings only (big employers list thousands worldwide: Bosch ~5,000, 360 in the US). Pages of 100, newest first, at most 20 pages (2,000 postings). Only the first page is conditional: unchanged means the board is, so a posting closing deeper down with nothing new on top waits for the next change. No description in the list: `/postings/{id}` per matching job (see Poll step 3). |
| Workable     | `apply.workable.com/api/v1/widget/accounts/{slug}`                                            | the earlier of `published_on` and `created_at` (day precision; a republished role isn't new)        | No ETag. No description or pay in the list: `apply.workable.com/api/v2/accounts/{slug}/jobs/{shortcode}` per matching job (see Poll step 3).                                                                                                                                                                                                                                            |
| SimplifyJobs | `raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json` | `date_posted` (epoch s; ~30–50% are exact midnight UTC = day precision, the rest are real instants) | ~12 MB (~2 MB gzip), ~19k listings, committed ~every 30 min. Fields: `id, company_name, title, url, locations[], category, active, is_visible, date_posted, date_updated, sponsorship, degrees, source, company_url`. Categories are inconsistent ("Software", "Software Engineering"). Locations look like `NYC`, `New York, NY`, `Jersey City, NJ`, `Remote in USA`, `Remote in UK`. |

### Adapter interface (defined in `core`)

```ts
type SourceId = string; // validated against the registry at runtime

interface SourceAdapter {
  id: SourceId; // greenhouse, lever, ashby, smartrecruiters, workable, simplify, speedyapply, jobright today
  label: string; // UI name, e.g. "SimplifyJobs"
  kind: "ats" | "aggregator"; // ats: one fetch per company slug; aggregator: one global fetch
  idPrefix: string; // canonical ID prefix: "gh" | "lv" | "ab" | "sr" | "wk" | "sj" | "sa" | "jr"
  concurrency: number; // max in-flight fetches for this source
  fetch(ctx: FetchCtx): Promise<FetchResult>; // ctx: { slug?, companyName?, etag?, signal, http }
  parseUrl?(url: string): { sourceJobId: string; slug?: string } | null; // ats only
  boardSlug?(url: string): string | null; // ats only: the board a board or job link is on (find-board)
  probe?(slug: string, ctx: ProbeCtx): Promise<{ found: boolean; jobCount: number }>; // ats only; discover, seed, upkeep
  // Sources whose list has no description (Greenhouse, SmartRecruiters, Workable): one job's description and pay; null when gone
  fetchDetail?(
    slug: string,
    sourceJobId: string,
    ctx: ProbeCtx,
  ): Promise<{ description: string; salary?: Salary } | null>;
  indirectLinks?: boolean; // aggregators whose links go to their own page (Jobright)
}

type FetchResult =
  | { status: "not_modified" }
  | {
      status: "ok";
      etag: string | null;
      jobs: SourceJob[];
      invalidCount: number;
      invalidIds?: string[]; // lowercased ids of invalid items that had one (see Poll step 8)
    };

interface SourceJob {
  source: SourceId;
  sourceJobId: string;
  companyName: string;
  companySlug?: string;
  title: string;
  locations: string[]; // raw strings + adapter-added "Remote - US" (see below)
  url: string; // job/apply URL
  postedAt: Date; // required: items without one are invalid (every source always supplies it)
  postedAtPrecision: "instant" | "day";
  salary?: {
    min?: number;
    max?: number;
    currency: string;
    interval: "hour" | "week" | "month" | "year";
  };
  description?: string; // plain text, when the list endpoint includes one
  meta?: { active?: boolean; visible?: boolean; category?: string }; // aggregators only
}
```

Everything source-specific is derived from the registry (`poller/src/sources/index.ts`):
valid `SourceId`s, the ATS values allowed in `companies.ats` / `suggestions.ats`
(each `kind: "ats"` adapter's `id`, plus `other`), the "Enabled sources" options,
canonical ID prefixes, and per-source concurrency. `ats` and `source` columns are
`text` validated against the registry, so adding a source needs no migration.
Rules below that say "ATS" or "aggregator" apply by `kind`; the aggregators
today are SimplifyJobs, SpeedyApply and Jobright (the "new-grad lists").

### Field mapping per adapter

| Adapter      | title                            | locations                                                                                                                                                                                                                                                  | url                                                            | postedAt (precision)                                           | salary                                                                                                                                                                                                     |
| ------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greenhouse   | `title`                          | [`location.name`]; when it names no place (empty, "Hybrid", "In-Office", "On-site", "Multiple Locations", "Various"), the value(s) of the first `metadata` field whose name says "location(s)" (Cloudflare's "Job Posting Location"), else the vague name | `absolute_url`                                                 | `first_published`, else `updated_at` (instant)                 | none                                                                                                                                                                                                       |
| Lever        | `text`                           | `categories.allLocations`, else [`categories.location`]; + `Remote - US` when `workplaceType = "remote"` and `country = "US"`                                                                                                                              | `hostedUrl`                                                    | `createdAt` (instant)                                          | `salaryRange` {min, max, currency, interval: `per-hour-wage` → hour, `per-week-salary` → week, `per-month-salary` → month, `per-year-salary` → year; any other interval or a missing `salaryRange` → none} |
| Ashby        | `title` (only `isListed = true`) | [`location`, ...`secondaryLocations[].location`]; + `Remote - US` when `workplaceType = "Remote"` and `address.postalAddress.addressCountry` ∈ {USA, US, United States, United States of America} (`isRemote` is not used: it is true for Hybrid jobs too) | `jobUrl`                                                       | `publishedAt` (instant)                                        | first `compensation.summaryComponents` item with `compensationType = "Salary"`; interval `1 HOUR`/`1 WEEK`/`1 MONTH`/`1 YEAR` → hour/week/month/year; other intervals → none                               |
| SmartRecruiters | `name`                        | [`location.fullLocation`, else `city, region, country`]; + `Remote - US` when `location.remote` (every posting asked for is in the US)                                                                                                                      | `jobs.smartrecruiters.com/{company.identifier}/{id}`            | `releasedDate` (instant)                                       | none                                                                                                                                                                                                       |
| Workable     | `title`                          | each `locations[]` place not marked `hidden`, as `city, region, country`; without `locations[]`, the top-level `city, state, country` (when every place is hidden, none); + `Remote - US` when `telecommuting` and a shown place is in the US (`countryCode` US, or country "United States"/"USA") | `apply.workable.com/{slug}/j/{SHORTCODE}/`                      | earlier of `published_on` / `created_at` (day)                 | from the detail: `salary_from`/`salary_to` in `salary_currency_iso_code`, `salary_frequency` hour/week/month/year; anything missing → none                                                                  |
| SimplifyJobs | `title`                          | `locations`                                                                                                                                                                                                                                                | `url`                                                          | `date_posted` (day if `date_posted % 86400 = 0`, else instant) | none                                                                                                                                                                                                       |
| SpeedyApply  | Position cell text               | Location cell: a trailing `+N` dropped; `Remote - City, ST` / `Remote - USA` → the place + `Remote - US`; other `Remote - X` kept as written                                                                                                               | Posting link (the ATS posting itself), tracking params removed | Age `Nd` → midnight UTC N days ago (day)                       | Salary cell `$193k/yr` / `$45/hr` → USD `max` (one figure)                                                                                                                                                 |

Descriptions: Ashby `descriptionPlain`; Lever `descriptionPlain` + each
`lists[]` heading and content (HTML to text) + `additionalPlain`; Greenhouse via
`fetchDetail` (`content`, HTML escaped twice, to text; pay from the first
`pay_input_ranges` item, cents / 100, `hour` when its title says hourly, else
`year`); SmartRecruiters via `fetchDetail` (`jobAd.sections` `jobDescription`,
`qualifications`, `additionalInformation`, HTML to text; the company blurb is
skipped); Workable via `fetchDetail` (`description`, `requirements`,
`benefits`, HTML to text, plus pay); the new-grad lists none.

**SmartRecruiters paging**: pages after the first are read until a short page
or page 20. Postings published mid-read shift the pages, so duplicates are
dropped by id; when fewer unique postings came back than the first page's
`totalFound` (past 2,000, a short page, shifted pages), the shortfall is
counted as invalid items without an id, which holds that poll's closures and
skips saving the ETag (Poll step 8), so a partial read never closes postings
it missed.

**Workable**: a role in several cities is listed once per city under one
shortcode; the adapter merges those into one listing with every place.
Invalid items are reported by `shortcode` (`validateItems`' `idKey`), so one
bad item holds only its own job's closure. The account slug is lowercased in
API URLs (the API is case-sensitive).

For ATS adapters `companyName` = `ctx.companyName` (the company record's name;
Lever/Ashby responses don't include one). For SimplifyJobs it is
`company_name`, and `meta` = {`active`, `visible` ← `is_visible`, `category`}.

**SpeedyApply** (`raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md`,
~900 rows, updated daily): every pipe table in the README (FAANG+, Quant and
Other; only the first two have a Salary column), cells read by header name.
`companyName` is the Company cell's text, `sourceJobId` the first 16 hex of the
SHA-1 of the apply link (rows have no id; the link is stable; tracking params
and fragments are dropped, except route-style fragments with a `/`, which carry
Oracle's job ids), and a row whose link id repeats an earlier row's is dropped
(a shared careers page would otherwise overwrite one job), `meta` =
{`active`: true, `visible`: true, `category`: `Software Engineering`} (a
new-grad SWE list: listed means open). A row whose cell count doesn't match
its table counts as invalid; a README with no table at all throws (the layout
changed). Its links point at the postings, so board jobs dedupe by URL.

**Jobright** (`raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md`,
~640 rows, daily): columns Company, Job Title, Location, Work Model, Date
Posted. A `↳` company cell repeats the row above. The list repeats some
roles under a second id (51 of ~640 in Nov 2026): only the first row per
company + title + location is kept. `sourceJobId` is the id in
the title's `jobright.ai/jobs/info/<id>` link (tracking params removed; that
link is the job's `url`). Locations are the cell as is (`City, ST, United
States`; the country suffix is ignored by matching), plus `Remote - US` when
Work Model is Remote and the location is in the US. Date Posted (`Nov 17`, no
year) is midnight UTC of the latest such date not after tomorrow (so `Dec 30`
read on Jan 2 is last year's). Same `meta` as SpeedyApply. Its links go to
Jobright's page, not the posting (`indirectLinks`), so its jobs dedupe by
company and title (fuzzy rule), and a Jobright-found job with no ATS row takes
the link (and `primary_source`) of the first other list that merges into it.

- Adapters throw on transport errors, non-2xx/304 statuses (including 404), and
  when more than 50% of a non-empty response's items fail Zod validation (likely
  a schema change). Individual invalid items are logged, counted, and skipped.
  An empty job list is a valid success.
- Adapters append `Remote - US` per the mapping table above.
- Adapters apply no matching filters; all filtering happens in runPoll. The one
  exception: the Ashby adapter drops `isListed = false` items (unlisted jobs
  are treated as absent, so closures see them as removed).

### URL parsing (`parseUrl`)

Greenhouse job IDs, Lever posting UUIDs, Ashby job UUIDs, SmartRecruiters
posting ids and Workable shortcodes are globally unique, so canonical keys
don't need a slug.

**Slug case**: slugs are stored and sent to the APIs exactly as given (Lever is
case-sensitive: `BlueMatrix` → 200, `bluematrix` → 404). Only comparisons
(company matching, uniqueness) are case-insensitive.

Query strings and fragments are ignored except the ID parameters named below.

- Greenhouse: hosts `boards.greenhouse.io`, `job-boards.greenhouse.io`,
  `job-boards.eu.greenhouse.io`, `job-boards.anz.greenhouse.io` with path
  `/{slug}/jobs/{id}`; `boards.greenhouse.io/embed/job_app?token={id}` (slug
  unknown); and any URL with a `gh_jid={id}` query parameter (company career
  pages embedding Greenhouse; slug unknown; 43 of 1,190 active Simplify
  software listings on 2026-11-12).
- Lever: `jobs.lever.co/{slug}/{uuid}` with optional `/apply`. (`jobs.eu.lever.co`
  is not recognized: the EU API is out of scope, so those become `sj:` jobs.)
- Ashby: `jobs.ashbyhq.com/{slug}/{uuid}` with optional `/application`.
- SmartRecruiters: `jobs.smartrecruiters.com` or `careers.smartrecruiters.com`
  `/{Company}/{id}` where the last segment starts with the numeric posting id
  (`/Acme/744000145291599-software-engineer`); nothing after it.
- Workable: `apply.workable.com/j/{code}` (slug unknown; shortcodes work
  without the account), `apply.workable.com/{account}/j/{code}`, and old-style
  `{account}.workable.com/j/{code}`, each with optional `/apply`; a code is 6 to
  12 letters or digits, stored uppercase. Subdomains that aren't boards (`apply`,
  `www`, `jobs`, `api`, `help`, `resources`) and non-job paths are not recognized.

**Board links** (`boardSlug`, used when adding a company by link and by
`find-board`): the board slug in a board or job link on that ATS, unchecked.
The first path segment on the hosts above (`jobs.lever.co/acme`), never
`embed`; Greenhouse embedded boards name it in `for`
(`/embed/job_board?for=acme`, `/embed/job_app?for=acme`), read only on those
two embed paths; SmartRecruiters apply links
`/oneclick-ui/company/{Company}/publication/{uuid}`; Workable the account as
in job links (`apply.workable.com/{account}`, `{account}.workable.com/j/...`).

### HTTP helper

15 s timeout per request by default; a whole Greenhouse, Lever or Ashby board
gets 60 s (`BOARD_TIMEOUT_MS`: big ones such as Anduril's ~2.6 MB take 20 to 30 s
to serve), while SmartRecruiters pages, the Workable list, details and probes
keep 15 s. One retry after 1–3 s jitter on network errors, 5xx,
and 429 (honoring `Retry-After` up to 30 s), except that a request given its own
timeout is not retried once that runs out (a hung board costs one wait); no
retry on other 4xx; sends
`If-None-Match` when an ETag is known and `Accept-Encoding: gzip`;
`User-Agent: jobvr (personal job alerts)`; aborts responses over 50 MB.

## Data Model (Postgres 18, Drizzle)

All timestamps are `timestamptz`. Migrations (`core/drizzle`, 0000 to 0014)
run automatically on app start (retried every 2 s for up to a minute while
Postgres is still starting). The latest four: 0011 added `tier_source`
(existing rows `seed`, auto-added ones `pending`), `tier_reason`, `tiered_at`,
and turned `track` on for every company with a working board (the Track switch
was removed; it had left 8 S/A boards off); 0012 added `aliases`; 0013 added
`needs_review_since` (existing `needs_review` companies start the clock at the
migration, so none gives up early); 0014 (`letter_tiers`) renamed stored tiers
Mid → B, Startup → C, Corporate → D and set AI-rated (`auto`) companies back to
`pending`, so the AI rates them again on the new scale (without a key they keep
the mapped letter; seed and manual tiers keep theirs).

| Table          | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`     | single row (`id = 1`): `data` JSONB (Zod `Settings`, parsed with defaults on read so new fields need no migration), `last_visit_at`, `last_poll_at` (poll started), `last_poll_ok_at` (poll finished), `poll_stall_alert_at`, `last_push_at`, `last_cleanup_at`, backup status (`last_backup_at`, `backup_error`, `backup_error_at`, `backup_alert_at`)                                                                                                                                                                                                                                                                                        |
| `companies`    | `id` uuid, `name`, `normalized_name` (unique; see Normalization helpers; so "Regal" and "Regal Inc" can't coexist), `aliases` text[] (other normalized names it goes by on the lists, from AI merges; default empty), `city`, `state` (free text, e.g. city "Pittsburgh/NYC", state "PA/NY"), `tier` (S/A/B/C/D, see [Tiers](#tiers)), `tier_source` (seed: the starter list; auto: the AI rater; manual: picked by a person, never overwritten; pending: not rated yet), `tier_reason` (the rater's one-line reason, else null), `tiered_at` (when the rater set it), `track` bool (polled; see Company invariants), `ats` (text: a registered ATS adapter id or `other`), `slug` (nullable, case preserved; unique per `ats`, case-insensitive), `careers_url`, `notes` (auto-added companies start with "Added automatically"), `status` (ok/needs_review/manual_only), `needs_review_since` (when it last became `needs_review`; null in every other status; the heal clock), `created_at`, `updated_at` |
| `source_state` | `key` text PK (`<aggregator id>` or `company:<uuid>`), `source`, `company_id` (FK, cascade delete, nullable), `slug` (the slug this state belongs to; null for aggregators), `etag`, `filters_hash`, `last_attempt_at`, `last_success_at`, `consecutive_failures`, `last_error`, `baselined_at`                                                                                                                                                                                                                                                                                                                                                |
| `jobs`         | `id` text PK (canonical ID), `company_id` (FK, set null), `company_name`, `title`, `locations` text[], `url`, `primary_source`, `first_seen_at`, `effective_at`, `salary_min_usd`, `salary_max_usd` (annual), `state` (new/saved/hidden/applied), `applied_at` (set the first time it's marked applied and only when empty; kept when it leaves applied, so undoing "Not applied" restores the date; the API shows it only while applied; migration 0010 backfilled earlier marks from `updated_at`), `baseline` bool, `notified_at`, `closed_at`, `updated_at`                                                                                                                                                                                                                                                                                                                                    |
| `job_sources`  | PK (`source`, `source_job_id`); `job_id` (FK, cascade delete; indexed); `url`, `url_key` (normalized URL or null; indexed), `title`, `category` (aggregators; else null), `posted_at`, `posted_at_precision` (instant/day), `removed_at`, `required_years` (years of experience the description asks for: null = not checked, 0 = none named; see Experience rule), `description` (plain text, capped at 20k characters; kept when a later listing has none; never loaded by the feed list, pushes or the poll's in-memory window). A job can have several rows, including several from the same source (SimplifyJobs has duplicate listings). |
| `suggestions`  | `id` text PK (normalized company name), `display_name`, `ats` (registered ATS id or `other`), `slug` (nullable, case preserved), `listing_counts` JSONB (matching listings per aggregator), `listing_count` (their sum), `sample_titles` text[] (≤ 3), `last_seen_at`, `state` (open/dismissed/added)                                                                                                                                                                                                                                                                                                                                          |

Indexes: `jobs(effective_at desc)`; partial `jobs(effective_at) where notified_at
is null`; `jobs(company_id)`.

Enum-like text columns carry CHECK constraints built from the code's
constant lists (`jobs.state`, `companies.tier`/`status`/`tier_source`, `suggestions.state`,
`job_sources.posted_at_precision`; `required_years` ≥ 0), so a manual edit
can't store a value the code doesn't know.

### Company invariants (enforced by the API and seed script)

- `ats = other` ⇒ `status = manual_only` and `track = false`.
- Supported `ats` with no `slug` ⇒ `track = false` (cannot be polled).
- Changing a company's `ats` or `slug` deletes its `source_state` row, so the
  next poll starts fresh with a new baseline. Changing `ats` (without an
  explicit `status`) also sets the status: onto a supported ATS → `ok` (a board
  left `manual_only` would never be polled); onto `other` → `manual_only` and
  `track = false`.
- When a company's `ats` changes or its board is switched off (`track` true →
  false), its old board's source rows are marked removed and its jobs with no
  live source left are closed, since no poll scans that board anymore.
- Renaming a company keeps the old normalized name as an alias (the lists
  still use it, and auto-add would otherwise bring it back).
- `track` is no longer a user choice (the web app has no Track switch; the
  API still accepts it). It means "has a working board": set true whenever a
  company gets a supported board (create defaults it to true when there's a
  slug and the status isn't `manual_only`; add by link or name, auto-add, heal,
  list boards, seed), false when heal gives up or the company is list-only. A
  company is polled when `track`, a slug, a status other than `manual_only`,
  and a tier in "Tiers to track" (see Poll step 2).
- Every write that changes `status` sets `needs_review_since` with it: kept
  while it stays `needs_review`, now when it becomes `needs_review`, null
  otherwise.

### Canonical job IDs

`<idPrefix>:<sourceJobId>` of the adapter that identifies the job:

- `gh:<id>`, `lv:<uuid>`, `ab:<uuid>`, `sr:<posting id>`, `wk:<SHORTCODE>` for
  direct ATS listings, and for list listings whose URL an ATS adapter's
  `parseUrl` recognizes.
- `sj:<simplify id>`, `sa:<link hash>`, `jr:<jobright id>` for list listings
  whose URL isn't recognized.

The canonical ID is fixed when the job is inserted and never changes. Because a
fuzzy merge can attach an ATS listing to an `sj:` job, lookups go through
`job_sources` (see Dedupe), not only `jobs.id`.

### Normalization helpers

- **Company name**: lowercase; `&` → `and`; non-alphanumerics → spaces; drop the
  tokens `the, inc, llc, ltd, corp, corporation, co, company`; then drop
  trailing `technologies, technology, international, group, holdings,
  incorporated, limited, plc` while another token is left (the lists say
  "Palantir Technologies" and "CACI International Inc"; migration 0009
  recomputed stored names); collapse spaces.
- **URL key**: lowercase scheme + host with a leading `www.` removed; path with
  a trailing `/`, `/apply`, or `/application` removed; query and fragment
  dropped except `gh_jid` / `token`. The key is **null** (not used for matching)
  when the remaining path has fewer than 2 segments (e.g. `company.com/careers`),
  so generic career-page URLs never merge different roles.
- **Keyword text** (titles and keywords alike): lowercase; every character other
  than `a–z` and `0–9` becomes a space; split into tokens. A keyword matches when
  its token sequence appears contiguously in the title's tokens. So `sr.` matches
  "Sr." and "Sr"; `full stack` matches "Full-Stack"; `software engineer i`
  doesn't match "Software Engineer II"; `lead` doesn't match "Leadership". A
  keyword's last word also matches its plural (`intern` matches "2027 Interns",
  `new grad` matches "New Grads").
- **Company for a job**: ATS jobs → the polled company. List jobs → the
  company with the same `ats` + `slug` (case-insensitive, when `parseUrl` returned
  a slug), else the company with the same normalized name or alias (a
  company's own name wins over another's alias), else the company whose board
  slug is the name compared as letters and digits only ("Kira" on Jobright is
  Kira Learning, board Ashby `kira`; "Abnormal Security" is Abnormal AI, board
  `abnormalsecurity`; skipped when two companies share that slug), else none
  (tier `Unlisted`). Resolved on insert, and re-resolved on every later poll
  match while `company_id` is null. Creating a company also links, in the same
  transaction, stored jobs with no company whose `company_name` normalizes to
  its name or an alias (an unchanged list isn't re-read, so the poll alone
  would not adopt them). Tier is never copied onto jobs; it is joined from
  `companies` at read time.

## Matching Rules

### Keyword rule

A title passes the keyword rule for a source when:

- **All sources**: 0 exclude keywords, AND no contract tag ("(Contract)", "-
  Contractor", "– Contract,"; "Smart Contracts" as a subject is fine), AND no
  built-in reject (below), AND no numbered experienced level. Experienced
  levels: `ii` to `viii`, `2`-`5` (bare 6 to 9 aren't levels: "24/7", "Series
  7"), Meta-style `E4` and up (new grads start at E3), and level codes read
  as their number (`L`, `IC`, `P`, `SDE`, `SWE` + a digit: "L2", "IC3", "SDE2";
  6 and up count as 5), with two exceptions for big-company ladders: `L3` is
  neutral (Google hires new grads at L3), and `L4` is experienced unless the
  title also says level I ("SDE I (L4)" is Amazon's entry level). Dotted codes
  are ignored ("AMZ27480.1" isn't level 1). A numbered level still passes when
  it's a range from entry (the entry number right before it: "Engineer 1/2",
  "I/II") or the title says `new grad`, `new graduate`, `grads`, `entry level`
  or `early career` ("Engineer 2, New Grad"); other level keywords
  ("Associate", "University") don't outrank it. "Entry level" means ≥ 1 level
  keyword, or a level token `i` / `1` (also `L1`, `IC1`, ...; not "I/O" or
  "Tier 1"). So "Software Engineer 3" and "Associate Software Engineer II" are out,
  "Software Engineer 1/2" and "Engineer 2 New Grad" are in.
- **Built-in rejects** (`core/src/matching.ts`; always on, whatever the
  editable exclude list says, since stored lists don't pick up new defaults):
  `ALWAYS_EXPERIENCED` ("leader", "expert", "experienced", "advisory
  software", "advisory engineer", "consulting member of technical staff",
  "senior member of technical staff"), "mid" as a level ("Engineer (Mid)",
  "Mid-Senior"; not "Mid-Market", "Mid-Atlantic", "Mid-West"), and
  `ALWAYS_PRESALES` ("solution(s) engineer", "sales engineer", "presales"),
  matched against the whole title.
- **Exclude-check masks** (the exclude check reads the title with two kinds of
  words blanked; the other checks read it whole):
  - `maskAlternatives`: an excluded word offered as one alternative beside one
    that isn't, across a `/`, `&`, `or` or `and` join, doesn't reject
    ("Software Engineer (Embedded/Backend)", "C++ or Python"; "Embedded Software
    Engineer" still rejects). The word must sit directly against the join (a
    word fenced off by a bracket, "Tester (Freelance) / Test …", still rejects),
    both sides excluded ("Senior/Staff") still rejects, and a job noun
    (`engineer`, `engineering`, `developer`, `programmer`) on the other side
    next to the join means two jobs, not two tracks ("Research Engineer /
    Scientist" still rejects).
  - `maskRolePhrases`: multi-word role keywords found in the title are blanked,
    so an exclude word inside one ("Member of Technical Staff") doesn't reject
    it; a phrase that is itself on the exclude list isn't blanked.
- **Any source**: ≥ 1 role keyword passes ("Software Engineer", "AI Engineer").
  A level keyword is only required when "Require a level keyword on company
  boards" (ATS) or "Apply level keywords to Simplify" (aggregator) is on; by
  default plain "Software Engineer" counts, since boards rarely say "new grad".
- **Without a role keyword**, a generic engineering title (`engineer`,
  `engineering`, `developer`, `programmer`) with no other discipline word
  (electrical, mechanical, civil, sales, legal, compliance, field, support,
  solution(s), customer, network, services, verification, design, asic, fpga,
  physical, ...)
  passes when it's entry level on a board ("New Grad Engineer"), or in a
  SimplifyJobs "Trusted category" ("Engineer 2 New Grad - Multiple Teams").
  A title also counts as generic engineering when one of its parts (split on
  " - ", " – ", " | " and brackets; `newGradEngineeringPart`) has a generic
  engineering word and a new-grad word (`new grad`, `new graduate`, `grads`,
  `entry level`, `early career`) and no discipline word: "Engineer New Grad -
  Evolve - An Apple Services Rotation Program" names a program, not a
  discipline, in its other parts.
  "AI Acceleration Specialist" and "Associate Application Consultant" never
  pass, even under SimplifyJobs' Software category.

### Location rule

A job passes when any of its location strings matches any enabled named location:

- Location strings are split into places on `;` and `|`, and each place is
  parsed: "City, ST" (state code or name, optional trailing country) gives a
  city and a state; a bare state ("NY", "New Jersey") is read as a place named
  after the state, so "SF; NY" means New York; anything else is unstructured.
- **Alias locations** (NJ, PA, NYC, user-added): a location's "home states" are
  the states its aliases name (NJ → nj, NYC → ny via `new york`). A "City, ST"
  place outside the home states never matches ("Brooklyn Park, MN", "Newark,
  DE"). Inside them, a two-letter state alias (`nj`, `pa`) matches the whole
  state, and any other alias must match the city, so "Mt Laurel Township, NJ"
  is NJ but "Buffalo, NY" isn't NYC. Unstructured places match when their
  tokens contain any alias ("NYC Office", "San Francisco, Seattle, New York").
- **Remote-US** (built-in rule, can be enabled/disabled but has no aliases): the
  string is exactly a US token sequence (`us`, `usa`, `u s`, `u s a`, `united
states`, `united states of america`), meaning anywhere in the US, OR it
  contains the token `remote` AND either contains a US sequence or is exactly
  "remote" after tokenization. "Remote", "Remote - US", "Remote in USA",
  "United States (Remote)", "United States" match; "Remote in UK", "Remote - Europe", "Remote (EMEA)", "Remote -
  Latin America", "New York, NY (Remote)" don't (the last one matches NYC instead).
  A bare "Remote" place means the US unless every other place of the job is a
  foreign country, region or city named on its own (`FOREIGN_PLACES` in
  `remoteUsHit`: Europe, EMEA, APAC, UK, Canada, Poland, India, London, Toronto,
  ...): ElevenLabs' "Remote; Poland; United Kingdom" is remote in Europe.

### Experience rule

`requiredYears(description)` (`core/src/experience.ts`): the first experience
requirement in a job's description ("5+ years of experience", "2-5 years of
professional software experience", "five (5) years of experience": up to 6
words between "years" and "experience", within one sentence), or, with a `+`
only, "N+ years" followed by working, building, writing, developing, shipping,
professional, industry, in, on, as or with ("3+ years working with", "6+ years
in ...", "7+ years as a software engineer", "3+ years with Kubernetes"); null
when it names none. Numbers above 20 are ignored. The first one is the headline
requirement ("Minimum of 5 years building software; minimum of 2 years focused
on security" is 5; "3+ required, 5+ preferred" is 3). Ignored: degree
alternatives ("BS or 4 years of experience"), "equivalent experience", and the
company talking about itself ("our founders have 10+ years of experience").
Stored per source row as `required_years` at poll time (0 when the description
names none, null without a description).

A source row passes when "Hide board jobs asking for N+ years" is 0 (off), or
its `required_years` is null or below N, or its title is entry level (a level
keyword or `I`/`1`: "Software Engineer, New Grad" stays even if it says "3+
years"; "Associate" alone doesn't count here, since banks' Associate roles are
often 3 to 5 years in). Applied at read time, so changing N needs no refetch.

### Salary rule

Only applies when a salary is listed in USD (other currencies are treated as
unlisted). Annualize: hour × 2080, week × 52, month × 12. Passes when
`salary_max_usd` (or `salary_min_usd` if there is no max) ≥ the min salary setting.
Unlisted salary always passes.

### Poll-time filter (decides what is stored)

A listing is stored (inserted, or merged into an existing job) only if it passes
the location rule AND the keyword rule for its source, AND (aggregators only)
`meta.active` and `meta.visible` are true, AND its adjusted posted date (see
Freshness) ≥ now − the store window ("Keep jobs posted within", default 30
days). Exception: an entry-level title (level keyword or `I`/`1`) on a company
board (ATS) is stored up to 180 days old (`ENTRY_LEVEL_STORE_DAYS`), whatever
the window: firms post new-grad roles months ahead and keep them open (HRT's
"Software Engineer – 2027 Grads" was 4 months old in Nov 2026), and board
closures show when they're gone. SimplifyJobs listings don't get this, since
their `active` flag is community-maintained. Older-but-open roles are kept so
nothing still applicable is missed; pushes and "new" still only count jobs
within max age.

### Visibility rules V (applied at read time with current settings)

A stored job is visible when:

1. It passes the location rule (on `jobs.locations`), and at least one of its
   `job_sources` rows passes the keyword rule for that row's source using the
   row's `title` (and, for aggregator rows, has a `category` in "Simplify
   categories") and the Experience rule; so a Simplify job later merged with
   an ATS listing doesn't disappear because the ATS rule is stricter.
2. It passes the salary rule.
3. It has at least one non-aggregator source, or "Show SimplifyJobs jobs" is on.
4. `closed_at` is null.

The `saved` and `applied` views ignore V entirely (closed jobs appear with a
"Closed" badge), so a job you saved never disappears because a setting changed.

Feed and `hidden` view = V + UI filters; the feed view also keeps only
entry-level jobs (an entry-level title, or on a new-grad list) when "Entry
level only" is on. Pushes = the pushable rule (see
[Notify](#notify-runnotify)). "New since last visit" = the **New** rule in
`GET /api/jobs` (pushable without the `notified_at` condition, plus
`first_seen_at > last_visit_at`).

## Pipeline

### Due checks

A task is due when its last-run timestamp is null or `now − last ≥ interval − 60 s`
(the 60 s tolerance stops tick jitter from turning a 15-min interval into 20).

- runPoll: `last_poll_at`, interval = "Poll every". `last_poll_at` is set when a
  run **starts**.
- runNotify: `last_push_at`, interval = "Push summary every". `last_push_at` is
  set only when a push is **sent**. So after a quiet period with nothing to send,
  the first new job pushes on the next tick; after a push, new jobs wait for the
  interval (bundling).
- runCleanup: `last_cleanup_at`, interval = 24 h.

### Poll (`runPoll`)

Order: take the poll lock → due check → set `last_poll_at = now` → steps below.

1. **Load** into memory: settings, companies, all `source_state` rows, and all
   jobs (with all their `job_sources` rows) where `effective_at ≥ now − max(store
window, 180 days)` (everything the poll filter can still store), plus saved and
   applied jobs of any age, so a long-open posting you marked still closes when
   it comes down.
2. **Targets**:
   - Each **company** with `track = true` AND tier in "Tiers to track" AND
     `status ≠ manual_only` AND `ats` is a registered ATS adapter AND `slug` is set
     AND that `ats` is in "Enabled sources". (`needs_review` companies are still
     polled so they can recover, while the heal step looks for a new board.)
   - Each **aggregator** in "Enabled sources" (today: SimplifyJobs, SpeedyApply, Jobright), once.
3. **Fetch** all targets in parallel, at most `adapter.concurrency` in flight per
   source. Each source's queue is shuffled every poll (`RunPollOptions.order`;
   tests fix it), so the same broken boards can't always go first and trip the
   circuit breaker. The run has a 5-minute fetch budget: when it expires (or on
   shutdown), fetches still running are aborted and, like targets still
   queued, skipped (no health change, retried next poll). One target failing
   never affects others.
   Send `If-None-Match` only if the target's `source_state` row exists, its
   `slug` equals the company's current slug, and its `filters_hash` equals the
   current hash of (`FILTER_VERSION` code constant + locations + role/level/exclude
   keywords + Simplify categories + Apply-level-to-Simplify + Require-level-on-boards
   - store window). Otherwise fetch unconditionally, so changed filters or
     matching code re-evaluate unchanged sources.
     **Details**: right after an `ok` fetch from an adapter with `fetchDetail`,
     each listing without a description that passes the poll filter gets its
     detail (description, and pay when the listing has none), one request at a
     time per target, within the same budget. Listings whose source row already
     has a non-null `required_years` are skipped and keep their stored pay
     (copied onto the listing as USD/year). A failed or aborted detail request
     leaves the listing unchecked, and the target's new ETag is then not saved,
     so the next poll gets the full list instead of a 304 and retries it; a null
     detail (job gone) is skipped. An empty description counts as unread
     (`required_years` null), not as "no requirement".
4. **Process** results one target at a time: all ATS targets first, then
   aggregators (so ATS data is in place before Simplify merges into it). Each
   target's processing (steps 5–10) runs in **one DB transaction** and works on a
   copy of the affected in-memory jobs. For a company target, the transaction
   first locks the company row (`SELECT … FOR UPDATE`); if the company was
   deleted or its `ats`/`slug` no longer equal the values fetched, the target
   is abandoned with no writes and no health change (the API's company PATCH
   waits on this lock, so it can't interleave). On commit, the copy replaces the shared
   in-memory set; on any error the transaction rolls back, the copy is
   discarded, and the target counts as a failure (its `etag` / `filters_hash`
   are not updated, so the next poll refetches in full). Database writes touch
   only the columns named in these steps, so concurrent user actions (Save,
   Hide, Apply) are never overwritten. A merge writes a job or source row only when
   one of those columns actually changed (most polls change nothing), so
   unchanged rows aren't rewritten (no table bloat, no row locks held against
   Save/Hide).
5. **Normalize and filter** each listing of an `ok` result: compute its
   canonical ID and its **identity keys**: (`source`, `sourceJobId`); plus (that
   ATS id, parsed `sourceJobId`) when an ATS adapter's `parseUrl` recognizes its
   URL; plus its URL key when non-null. Resolve its company. Apply the poll-time
   filter; listings that fail are not merged or inserted (they still count for
   closures in step 8).
6. **Dedupe/merge** each passing listing against the in-memory set (which
   includes jobs inserted earlier in this run):
   1. **Exact**: jobs that have a `job_sources` row matching an identity key
      (same `source` + `source_job_id`, or same non-null `url_key` with the same
      company: same `company_id`, or same normalized name when either has
      none), or whose `id` equals the listing's canonical ID. If several jobs match, prefer the
      one whose `id` equals the canonical ID, then one with an ATS source row,
      then the newest `effective_at`.
   2. **Fuzzy** (only if no exact match): an incoming list listing whose
      canonical ID is a list's (`sj:`, `sa:`, `jr:`) vs. a job that has an ATS
      source row, or vs. a list-only job with no row from the same list
      (another list's copy of a role at a company with no readable board; one
      list's own near-duplicates, one per city, stay apart); or a list listing
      whose URL links a board posting (canonical ID `gh:` etc.) vs. a list-only
      job with no ATS row and no row from the same list (Jobright, with no
      direct links, found it first); or an incoming ATS listing vs. a job with
      no live ATS row: a list-only job (id with a list prefix), or one whose
      rows from another board are all gone (the company moved boards). Requires same company (same
      `company_id`, or same normalized name when either has none) AND title
      token-set Jaccard ≥ 0.85 AND at least one shared named-location label
      (both sides' locations match that label). If several jobs qualify, pick the
      highest Jaccard, then the newest `effective_at`. Listings whose URLs
      identify different ATS postings are never fuzzy-merged; an incoming board
      posting is compared only against postings on its own board (after a
      move, the old board's say nothing), so reposts on one board stay apart.
   - **Match** → upsert the listing's `job_sources` row (`job_id`, `url`,
     `url_key`, `title`, `category`, `posted_at`, `posted_at_precision`,
     `required_years`; a listing without a description keeps the row's existing
     `required_years` and `description`, and an unchanged description (same MD5;
     the poll holds descriptions only as `md5(description)`, never the text)
     isn't re-read for experience). If that
     row previously belonged to a different job (the listing moved), it is
     re-pointed; a job left with no rows is deleted with a single guarded
     statement (`DELETE … WHERE id = $1 AND state = 'new' AND NOT
EXISTS (SELECT 1 FROM job_sources WHERE job_id = $1)`), never based on the
     in-memory state. A `saved`/`applied`/`hidden` job left with no rows (it
     could never close, and a hidden one would come back) passes its mark to
     the job the row moved to (applied beats saved beats hidden beats new;
     never downgraded; an applied mark keeps its `applied_at`) and is deleted the same guarded way. If the listing is from an ATS source, overwrite the job's `title`,
     `locations`, `url`, salary, `company_id`, `company_name`, and set
     `primary_source` to that ATS. If the job's `company_id` is null, re-resolve
     it (and take that company's name). Update `effective_at` (see Freshness). Never changed by a match: `id`,
     `state`, `first_seen_at`, `baseline`, `notified_at`.
   - **No match** → first look up the identity keys and canonical ID in the DB
     with no age limit (same rules as Exact). If a job outside the in-memory
     window matches, skip the listing (an old job is never re-inserted or
     re-pushed, e.g. a Simplify repost of the same URL). Otherwise insert the
     job (`id` = canonical ID, `first_seen_at = now`, `state = new`,
     `primary_source` = listing's source) and its `job_sources` row.
7. **Baseline**: the target's `source_state` row is upserted inside this
   transaction (created on a company's first successful poll, with `slug` = the
   slug fetched). If its `baselined_at` was null at the start of processing (a
   row whose `slug` differs from the company's current slug counts as null),
   jobs inserted by this target in this run get `baseline = true` and
   `baselined_at = now` is written in the same transaction. Baseline jobs show
   in the feed but are never pushed or counted as "new".
8. **Closures** (`ok` results only; uses the full unfiltered result). The
   target's rows are, among in-memory jobs: for an aggregator, every
   `job_sources` row with that source; for a company, rows with source = the
   company's `ats` on jobs whose `company_id` is that company. A row is **live**
   if its `source_job_id` is in the result, the listing still passes the title
   and place rules (a role retitled "Senior …" or moved to an untracked place
   stops counting; age alone doesn't), and (aggregators) `meta.active` and
   `meta.visible` are true; otherwise it is **removed**. Set `removed_at = now` on
   newly removed rows and `removed_at = null` on live rows. Then for each affected
   job: all rows removed → `closed_at = now` (if not already set); any row live →
   `closed_at = null`. A job with an ATS row on a board this poll checks
   (`ProcessContext.boards`: `companyId|source` of every polled board) counts
   only those rows: the company's board is the truth and lists lag (SpeedyApply
   still listed an Abnormal Security role the day Greenhouse dropped it). When
   no poll checks its board anymore (given up on, moved, switched off), its
   lists decide. Rows of targets that are not polled (untracked company,
   disabled source) and jobs outside the in-memory window are not re-evaluated;
   their open/closed status stays as last computed. A listing that failed
   validation but has an `id` keeps its row exactly as it was (neither removed
   nor revived: it's still listed; OpenAI's board had a blank-title posting for
   a month). One without an id could be any job: a company board then removes
   nothing that poll and its ETag isn't saved, so the next poll refetches.
   Aggregators don't hold: one bad community-edited row would block all closures.
9. **Suggestions** (aggregator targets with an `ok` result, when "Add
   companies automatically" is on; auto-add reads them): take the listings that passed the
   poll-time filter and resolved to no company; group them by normalized company
   name. Per group: `ats` = the most common ATS among URLs recognized by `parseUrl`
   (`other` if none); `slug` = the most common non-null slug for that ATS (null if
   none); the group size is this list's count; `sample_titles` = up to 3 titles;
   `display_name` = the most common raw `company_name`. Insert new groups as
   `open`; for existing rows set this list's entry in `listing_counts`, update
   `sample_titles`, `last_seen_at` (and `display_name`, and `ats`/`slug` unless
   this list only knows `other` and the row has an ATS, only while `open`).
   Rows not in this run drop this list's entry; `listing_count` is the sum of
   `listing_counts` (each list replaces only its own count, so SpeedyApply's
   poll can't zero what SimplifyJobs found). `open` rows that now resolve to a company
   (by normalized name, an alias, `ats` + `slug`, or a company's board slug as
   the name, letters and digits only) become `added`; `added` rows that no
   longer resolve to any company become `open` again (deleting a company
   dismisses its rows first, see [Company upkeep](#company-upkeep)).
10. **Health** (success): in the same transaction, `last_attempt_at = now`,
    `consecutive_failures = 0`, `last_error = null`, `last_success_at = now`, and
    for `ok` store `etag` and `filters_hash`; a `needs_review` company becomes
    `ok` (and `needs_review_since` null). `not_modified` results run only this step (and step 7's row upsert).

**Health (failure)**, written after the rollback in its own statement:
`last_attempt_at = now`, increment `consecutive_failures`, store `last_error`;
when it reaches 3, an `ok` company becomes `needs_review` with
`needs_review_since = now` (the heal step takes it from there). The row is created if
missing (with `baselined_at` null). The write is skipped if the company was
deleted or its `ats`/`slug` changed since the run loaded it (so a mid-poll edit
isn't overwritten with stale state). The same guard applies to step 10.

**Source outage**: when no board of one ATS answers in a poll and at least 3
failed with network errors, timeouts, 5xx or 429, the ATS is down, not the
boards: those boards' health isn't written (no streak, no move to
`needs_review`) and one warning names the source. A board that got a 404
still counts it (that's about its slug), and so does an unreadable answer
(HTML, schema drift): only network errors, timeouts, 5xx and 429 count as
transient, toward the breaker and outages. A circuit breaker in step 3
stops requesting a source once its first 3 boards have all failed that way
with none succeeding; the boards it never requested are left alone too,
even when a board already in flight then answers (no outage, but they were
never asked; they count as skipped and the next poll retries them). Each
poll records outages in `settings.source_outages` (`{ [source]: { since,
lastSeenAt, error, boards } }`, `since` kept while it lasts) and clears a source
once any of its boards answers, or once it has no boards to poll (disabled,
all untracked); Settings → Sources, a notice on the feed and
the header's poll status show it (`sourceOutages` on `GET /api/settings`). (Lever was unreachable
for hours on 2026-11-17 and every Lever board had been marked needs review.)

### Freshness

- `first_seen_at` = when the job was inserted.
- Each `job_sources` row has an **adjusted posted date**: `posted_at` when
  precision is `instant`; the end of that UTC day (23:59:59.999) when precision
  is `day`.
- On insert, `effective_at` = min(`first_seen_at`, the row's adjusted posted
  date). On every merge, `effective_at` = min(current `effective_at`, the merged
  row's adjusted posted date); it never moves later (a repost can't make an old
  job look new). Effective age = `now − effective_at`. The feed shows and sorts
  by effective age.
- The end-of-day rule stops a day-precision Simplify listing from looking up to
  ~24 h older than it is (and missing the 24 h push window). Old listings still
  come out old. Instant-precision dates are used as-is.

### Notify (`runNotify`)

A job is **pushable** when it is visible (V), `baseline = false`, `notified_at`
is null, `state ∈ {new, saved}`, effective age ≤ "Max job age", and its tier (the
company's tier, or `Unlisted`) is in "Tiers to track", and, when "Entry level
only" is on, it is entry level (an entry-level title, or on a new-grad list). The tier check uses tier
only, not the company's `track` flag; so Simplify jobs from a `manual_only`
D-tier company push, while jobs from a tier removed from "Tiers to track"
don't.

Order: take the notify lock → due check → quiet-hours check (inside quiet hours
→ return) → select pushable jobs → none: return with `last_push_at` unchanged →
send one ntfy push (see Push message) →
on success, set `notified_at = now` on exactly the selected jobs and
`last_push_at = now`; on failure, mark nothing (retried next tick).

**Push message** (`buildPush`): reposts of one role count once (as in the
feed); roles are ordered by [Feed order](#feed-order). Several roles: title
"N new jobs", body one line per role for the first 4 ("Stripe · Software
Engineer, New Grad · NYC", matched location labels last), then "+N more".
One role: title "New job: <company>", body "<title> · <places>", plus an
"Open posting" button to the job URL. Tapping opens `PUBLIC_URL/?sort=newest`,
where the pushed jobs are on top and highlighted as new. Published as JSON to
the ntfy server root (`{ topic, title, message, tags, click, actions }`), so
non-ASCII titles never go through HTTP headers.

Jobs held during quiet hours roll into the first push after quiet hours end.
Jobs that exceed max age while held are never pushed. If `NTFY_URL` is unset,
runNotify logs a warning and returns without marking anything.

**Quiet hours** are evaluated in America/New_York (via `Intl`, DST-safe) as the
half-open range [start, end), wrapping midnight when start > end. start = end
means no quiet hours.

### Cleanup (`runCleanup`)

Delete jobs with `effective_at < now − (max(store window, 180 days) + 15 days)`
and `state ∈ {new, hidden}` (`job_sources` cascade). Retention must exceed the store window, or a deleted
job that is still listed would be re-inserted on the next poll. Saved and applied jobs are kept indefinitely.

### Tiers

Company tiers are `S`, `A`, `B`, `C`, `D` (`TIERS` in `core/src/constants.ts`),
ranked by how good a company is for a new-grad software engineer: first-year
pay first, then engineering quality and prestige, then size and stability.
Startups and big enterprises are placed by the same measure, so there is no
separate "Startup" or "Corporate" tier. Jobs with no company are `Unlisted`.

| Tier | Rough new-grad pay | Examples                                                                                                               |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| S    | $200k+             | Google, Meta, OpenAI, Jane Street, Stripe, Databricks, Ramp                                                            |
| A    | $150-200k          | Datadog, Plaid, Coinbase, Dropbox, Vercel, Render, Mercor; investment banks at most                                    |
| B    | $110-150k          | SoFi, PayPal, Autodesk, Etsy, Oracle, funded startups with traction                                                    |
| C    | $80-110k           | banks, insurers, defense primes, retailers, ADP, unproven startups                                                     |
| D    | weak picks         | staffing and recruiting agencies, IT outsourcers (however large), OPT-only employers, small contractors and consultancies, job boards |

- `UNRATED_TIER` (`core/src/add-company.ts`) is `C`: the tier of auto-added
  and hand-added companies until the AI rates them (and for good without
  `OPENAI_API_KEY`). The AI's fallback for a company it doesn't recognize is
  `D` for a services, staffing or contracting firm, else `C`; unknown companies
  are never S or A; an acquired company takes its parent's tier.
- Old names (Mid, Startup, Corporate → B, C, D; `LEGACY_TIERS`) are still read
  where they can linger: stored `tiersToTrack` (`parseStoredSettings`) and the
  web app's links and remembered filters (`parseFeedSearch`).

### Company upkeep

Four scheduler steps after notify keep the company list current with no
clicks. Their retry clocks are in-memory maps in the scheduler (a restart
retries sooner, which is harmless). All log under module `companies`.

- **Auto-add** (`runAutoAddCompanies`, `core/src/auto-add.ts`; only when "Add
  companies automatically" is on): up to 10 open suggestions per run
  (`listing_count > 0`, most listings first), skipping ones on a source
  switched off in Settings and ones whose board check failed in the last day.
  A suggestion that already resolves to a company (name, alias, its board, or a
  company's board slug as the name, as in Company for a job) just becomes
  `added`. Otherwise, when it points at a supported ATS with a slug, the board
  is probed: no answer (an error) → retried after a day; answers with jobs →
  added as a polled company (`track`, `ok`; its first poll is a silent
  baseline); answers with no jobs, not found, or no supported board at all →
  added list-only (`ats = other`, `manual_only`) so its list jobs get a tier.
  Either way: tier C (`UNRATED_TIER`), `tier_source = pending`, notes "Added automatically
  from <lists> (<ATS> board, N jobs)" or "(no readable job board)". A conflict
  (added meanwhile) is skipped. After any add, every aggregator's ETag is
  cleared, so the lists' next poll refetches in full and their Unlisted jobs
  pick up the new companies.
- **Tiers** (`runAutoTier`, `core/src/tiering.ts`; only with `OPENAI_API_KEY`):
  rates `pending` companies, oldest first, with OpenAI Chat Completions
  (`OPENAI_MODEL`, default `gpt-5-mini`, `reasoning_effort: minimal` on GPT-5
  models, at most 300 completion tokens, 30 s timeout) using structured output
  `{ tier, reason, sameAs }`. Input: the name, careers URL, up to 5 recent
  distinct job titles, and (auto-added companies only) every other company's
  name. The prompt defines S/A/B/C/D with pay bands and examples (see
  [Tiers](#tiers)), caps investment banks at A, keeps unknown companies out of
  S and A, and for an unrecognized company asks for D when it looks like a
  services, staffing or contracting firm, else C; the reason is one plain
  sentence of at most 15 words. At
  most 10 a run (within the 60 s upkeep budget) and 200 calls per rolling 24 h
  (the larger of calls made in memory and ratings saved in the last day, so a
  restart doesn't reset it; "cap reached" is logged once a day). A failed
  rating is retried after an hour; one cut short by shutdown isn't held back.
  The rating is written only while the company is still `pending` (a tier
  picked meanwhile wins): `tier`, `tier_source = auto`, `tier_reason`,
  `tiered_at`. Seed and manual tiers are never touched. Without a key nothing
  runs and new companies stay C, "not rated".
- **AI merges**: when the rater's `sameAs` names a company already on the
  list, the company is folded into it (`mergeCompanyInto`) only if (a) it was
  created by auto-add and nobody picked its tier (notes start "Added
  automatically", `tier_source` pending or auto), and (b) the two look alike:
  same `ats` + slug, or one's normalized name or alias is a whole-word prefix
  of the other's ("bask" and "bask health"). So a name on a list can't steer a
  merge into an unrelated company. A merge moves its jobs over (they take the
  target's name), adds its normalized name and aliases to the target's
  `aliases` (so the lists' jobs keep resolving), moves its board along when
  the target has none (with its status; a board given up on, `manual_only`,
  stays untracked), and deletes it; two companies that both have a board
  are never merged. A rejected or refused merge is logged and the company is
  rated as usual.
- **Heal** (`runHealCompanies`, `core/src/heal-companies.ts`): companies in
  `needs_review` (not `other`), oldest `needs_review_since` first, 3 per run
  within the 60 s budget, each searched at most every 6 h. The search
  (`findBoardByName`) tries the name's slug guesses (see `discover`) on every
  enabled ATS, the ATSes in parallel (separate hosts) and 3 guesses at a time
  per ATS (registry order, then guess order, breaks ties), keeping only guesses whose letters and digits
  contain the whole name or an alias ("initech-io" for Initech, never "scale"
  for Scale AI); only boards with open jobs count, the most jobs wins, and
  probe errors count as "not there". A different board found → the company
  moves to it (`track`, `ok`; its source state is reset, so a new baseline). A
  board owned by another company is skipped. Nothing found 3 days after
  `needs_review_since`, on at least the second search by this process (a single
  search, as right after a restart, never gives up) → `manual_only`, `track =
  false` (its ATS and slug are kept); its jobs keep coming from the lists.
- **List boards** (`runFindListBoards`): list-only companies (`other`,
  `manual_only`) whose stored list jobs link to a board jobvr can read (as when
  a new ATS adapter ships): the board with the most of their links is probed,
  5 companies a run, each once a day; with open jobs the company moves to it
  (`track`, `ok`). Disabled sources and boards owned by another company are
  skipped.
- **Add by link or name** (`addCompanyFrom`, `core/src/add-company.ts`;
  `POST /api/companies/add`): one line, a careers or board link (scheme
  optional) or a name. A link on a supported ATS (`boardSlug`, else
  `parseUrl`'s slug) is probed: missing → 400 "doesn't exist"; an error → 400
  "couldn't reach, try again". The name comes from the slug ("blue-matrix" →
  "Blue Matrix") or the host ("careers.acme.com" → "Acme"); 409 when it (or an
  alias) is already listed. With no board from the link, `findBoardByName`
  searches by name. Board found → polled company; else list-only (`other`,
  `manual_only`, the link kept as `careers_url`). Tier C (`UNRATED_TIER`),
  `pending`, notes "Added by hand"; the company, its stored list jobs and the
  cleared list ETags are written in one transaction; then it's rated right
  away (the request waits at most 10 s, `RATE_WAIT_MS`, for the rating; a
  slower one lands in the background). Hand-added
  companies are never merged away.
- **Delete** (`deleteCompany`): removing is final. In one transaction every
  suggestion the company stood for (name, alias, board, slug as a name) is
  dismissed, and its names are inserted as dismissed suggestions when the
  lists haven't suggested them yet, so polls don't reopen them and auto-add
  never adds it back; then the company is deleted (its jobs keep
  `company_name`, `company_id` set null).

## Settings (DB, all editable in the UI)

`PATCH /api/settings` replaces each provided top-level field wholesale (arrays
are replaced, not merged). Validation (`core/src/settings.ts`): at most 30
locations with unique labels, at least one enabled, alias locations need at
least one alias, and the built-in Remote-US can't be renamed or removed; role
and level keywords 1 to 100 each, exclude keywords up to 100, categories up to
50, each keyword 1 to 100 characters; numbers are integers in the ranges below.
A stored field that fails validation falls back to its default on read.

| Setting                                   | Default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Constraints                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locations                                 | NJ → `nj`, `new jersey`, `jersey city`, `hoboken`, `newark`, `princeton` · PA → `pa`, `pennsylvania`, `philadelphia`, `philly`, `pittsburgh` · NYC → `nyc`, `new york`, `brooklyn`, `manhattan`, `queens`, `bronx`, `long island city` · Remote-US (built-in rule)                                                                                                                                                                                                                                            |
| Tiers to track                            | S, A, B, C, D, Unlisted (all)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Subset of S/A/B/C/D/Unlisted (stored old names are mapped on read). Controls which companies are polled, which jobs push, and the feed's default tier filter. `Unlisted` (added to the original list so Simplify jobs from companies not in your list can push) only affects jobs with no company. |
| Entry level only (`entryLevelOnly`)       | Off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Feed view, "new since last visit" and pushes keep only entry-level jobs (an entry-level title, or on a new-grad list). Replaced the feed's own switch; `level=entry` still works on `GET /api/jobs` |
| Role keywords (any)                       | software, developer, swe, sde, programmer, full stack, fullstack, backend, back end, frontend, front end, web engineer, mobile engineer, ios, android, product engineer, platform engineer, infrastructure engineer, forward deployed engineer, devops, site reliability, sre, machine learning, ml engineer, ai engineer, applied ai, data engineer, research engineer, cloud engineer, automation engineer, founding engineer, member of technical staff, application development, applications development |
| Level keywords (any)                      | new grad, new graduate, graduate, grad, entry, junior, jr, early career, early talent, emerging talent, university, college, campus, associate, rotational, apprentice, apprenticeship, residency, development program, 2026, 2027                                                                                                                                                                                                                                                                            |
| Exclude keywords                          | senior, sr, staff, principal, lead, manager, director, head, vp, vice president, architect, distinguished, intern, internship, co op, postdoc, postdoctoral, scientist, researcher, mid level, intermediate, fellow, part time, temporary, seasonal, fixed term, contract to hire, recruiter, designer, educator, writer, executive assistant, technical support, freelance, industrial placement, phd, customer support, gtm, go to market, curriculum, instructional, business developer, business development, developer advocate, developer relations, content developer                   |
| Require a level keyword on company boards | Off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Apply level keywords to Simplify          | Off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ;                                                                                                                                                                                                                                                                            |
| Simplify trusted categories               | Software, Software Engineering (other categories need a role keyword)                                                                                                                                                                                                                                                                                                                                                                                                                                         | Matched case-insensitively against `category`                                                                                                                                                                                                                                |
| Hide board jobs asking for N+ years       | 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0–20; 0 = off. See [Experience rule](#experience-rule)                                                                                                                                                                                                                       |
| Max job age (hours)                       | 24                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 1–168                                                                                                                                                                                                                                                                        |
| Keep jobs posted within (store window)    | 30 days (presets 30 / 60, or custom)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 7–120 days. Entry-level board titles: 180 days. Cleanup keeps new/hidden jobs 15 days past that                                                                                                                                                                              |
| Poll every (minutes)                      | 10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 5–1440                                                                                                                                                                                                                                                                       |
| Push summary every (minutes)              | 30                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 5–1440                                                                                                                                                                                                                                                                       |
| Quiet hours (ET)                          | 23:00–07:00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `HH:MM` each                                                                                                                                                                                                                                                                 |
| Min salary (USD/yr, if listed)            | 0 (none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ≥ 0                                                                                                                                                                                                                                                                          |
| Enabled sources                           | all registered sources (stored as `disabledSources`, empty by default)                                                                                                                                                                                                                                                                                                                                                                                                                                        | Controls **polling** (and which ATSs auto-add, heal, list boards and add-by-name probe) only. Stored as the sources turned off, so a source added in a later release starts on; settings saved before Nov 2026 (an on list) are converted on read.                                                                                               |
| Show SimplifyJobs jobs                    | On                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Controls **visibility** of Simplify-only jobs (rule V3)                                                                                                                                                                                                                      |
| Add companies automatically (`suggestCompanies`) | On                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Controls suggestion generation (Poll step 9) and the auto-add step. Off: list companies stay Unlisted; tiering, heal and list boards still run                                                                                                                                 |

## Environment

Template variables (`NODE_ENV`, `LOG_LEVEL`, `PORT`, `HOST`, `APP_NAME`,
`ALLOWED_ORIGINS`, `RATE_LIMIT_*`, `TRUST_PROXY`, `REQUEST_TIMEOUT_MS`) plus:

| Variable            | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`      | Postgres connection string                                          |
| `NTFY_URL`          | Full topic URL, e.g. `https://ntfy.sh/<long-random-topic>` (secret) |
| `PUBLIC_URL`        | Push click target, e.g. `https://jobvr.<tailnet>.ts.net`            |
| `AUTH_MODE`         | `none` (MVP)                                                        |
| `SCHEDULER_ENABLED` | `true` on the PC; `false` in Mac dev unless testing                 |
| `OPENAI_API_KEY`    | Optional (secret): the AI tier rater. Unset: new companies stay C, unrated |
| `OPENAI_MODEL`      | The rater's model (default `gpt-5-mini`)                            |
| `TS_AUTHKEY`        | Tailscale auth key (compose only)                                   |
| `POSTGRES_PASSWORD` | Database password, letters and digits (compose only)                |
| `BACKUP_DIR`        | Where nightly dumps go, e.g. a synced folder (compose only)         |
| `PC_LOG_LEVEL`      | The app's log level on the PC (compose only; default `info`)        |
| `WEB_DIST_DIR`      | Built SPA the API serves (default `../web/dist`)                    |
| `MIGRATIONS_DIR`    | Drizzle migrations folder (default `../core/drizzle`)               |

## Logging

Pino in the API (JSON on the PC, pino-pretty in development); the scripts use
core's console logger with the same one-line shape. Core takes a `Logger` port
(`debug`/`info`/`warn`/`error`/`child`) and tags lines with `module`.

| Module      | Logs                                                                                                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`    | Database ready (host/name only, migration time), listening (env, scheduler, sources), shutdown, fatal startup errors. In development a busy port is retried for 5 s (tsx restarts before the old process exits).                                                                                                                       |
| `http`      | One line per `/api` request: `GET /api/jobs 200` plus `responseTime`, `reqId`; successful reads at debug (open tabs check settings every minute), successful writes at info, 4xx warn, 5xx error. `/health` and static files at trace.                                                                                                         |
| `scheduler` | Start (tick timing, whether pushes are configured), a wake from sleep ("woke after …", info), a crashed task (error), a tick skipped because the previous one still runs (warn), tick time (debug).                                                                                                                                    |
| `poll`      | "poll started · N targets" (info) once a due poll begins; per target: changes (new/closed/reopened) at info, unchanged at debug, with listings, details fetched, and duration; failures at warn with the streak (`2 in a row`), company/ATS/slug and HTTP status; the move to needs review; a source outage as one warn line (its boards at debug); budget-skipped targets. One summary per run ("poll finished in …", a warn when boards failed). |
| `notify`    | Push sent (count, job ids), push failed (status/cause, no stack), NTFY_URL unset (warned once); not due / quiet hours / nothing new at debug.                                                                                                                                                                                          |
| `cleanup`   | Jobs deleted and the retention cutoff.                                                                                                                                                                                                                                                                                                 |
| `companies` | Company upkeep and hand adds: a company added (board and job count, or "no readable job board"), rated (tier and reason, with the model), merged or kept apart (and why), a board found by heal or list boards, a heal giving up, a rating that failed (warn), the daily AI cap reached (once a day); budget-skipped work and not-added suggestions at debug. |
| `backup`, `poll-check` | A backup problem or stalled polling (warn, as the alert is pushed), a failed alert push (warn); already reported or held for quiet hours at debug.                                                                                                                                                                   |

The `server` line at start also says whether new companies are rated, and by
which model.

Expected failures (HTTP statuses, schema drift, push errors) log one line with
their status; unexpected errors log `err` with its stack. Zero counters are left
out of the fields. Secrets (the ntfy topic URL, the database password, the
OpenAI key) are never logged.

**Activity log** (`api/src/lib/activity-log.ts`): the root Pino logger also
writes to an in-memory ring buffer (`pino.multistream`; stdout is unchanged)
that the web app's Logs page reads through `GET /api/logs`. It keeps the last
1000 entries at info and above since the process started (so the per-request
GET lines, at debug, never land in it), each `{ seq, time, level, module, msg,
error }`: the message and the error's message only (no stacks, request data or
other fields), each capped at 2000 characters. Nothing is persisted (a restart
starts over; `docker compose logs` keeps history). The page polls rather than
using server-sent events (the compression and request-timeout middleware
would need exceptions, and every 4 s is live enough), and debug lines and
extra fields stay out so the redaction is easy to trust. Every entry is scrubbed
before it's stored, each match becoming `[redacted]`: the exact
`OPENAI_API_KEY`, `NTFY_URL`, its topic (anything after the ntfy host, and the
topic alone) and the `DATABASE_URL` password (raw and decoded); exact secrets
of 4 or more characters are always redacted (under 12 only as a whole word, so
"test" doesn't blank part of "latest"; a shorter ntfy topic too, as a whole
word); plus anything shaped like a secret: `scheme://user:password@`
credentials, `tskey-...` keys, `ntfy.sh/<topic>` paths, `sk-...` keys (16+
characters), an `Authorization` header's value (any scheme) and `Bearer`
tokens (8+ characters).

## API

All routes under `/api` use the template envelope `{ success, data?, error?,
message?, count?, details? }`. Job IDs contain `:` and are URL-encoded in paths.
Outside production the OpenAPI document (`/openapi.json`, Scalar at
`/reference`) describes every route: write routes list 403 (`writeErrors`,
the cross-site guard in Edge Cases), and `/health`, a plain route that answers
before the API is up, is registered by hand.

| Route                                             | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/jobs`                                   | Query (all optional; list params are comma-separated): `view` = `feed` (default; state new/saved, not closed) \| `saved` \| `applied` \| `hidden`; `age` = `1h` \| `today` (effective_at since 00:00 America/New_York) \| `3d` \| `1w` \| `all` (default `all`); `level` = `entry` (only entry-level jobs; the feed view applies it on its own when "Entry level only" is on); `location` (named-location labels; job matches any); `company` (company IDs and/or `unlisted`); `tier` (tiers incl. `Unlisted`; default "Tiers to track" for `feed`, all otherwise); `source` (source ids; job matches if any of its sources is listed); `sort` = `best` (default for `feed`) \| `applied` (latest `applied_at` first, ties newest first; default for `applied`) \| `newest` (default for `saved` and `hidden`); `q` (text search: every word must start a word of the title, company or locations); `limit` (rows, default 500, max 5000). Returns jobs matching the view's state, passing V (views `feed` and `hidden`; `saved`/`applied` ignore V), and passing the filters, sorted by `sort` (see [Feed order](#feed-order); first `limit` rows) with `total` (how many matched), each with its `score`, each with its sources (incl. `requiredYears`), company tier, an `isNew` flag, an `entryLevel` flag (the title is entry level, or SimplifyJobs lists it), `matchedLocations` (the location strings that match an enabled location), and `duplicateIds`: postings of the same role (same company, same title and same location set, compared token-wise) are shown as one row, the newest, listing the others; `appliedAt` only while the job is applied (null otherwise, though the column keeps it); plus `lastVisitAt`, `newSinceLastVisit` and `newJobs`. **New** = non-baseline, `state ∈ {new, saved}`, tier in "Tiers to track", entry level when "Entry level only" is on, effective age ≤ "Max job age", visible (V), and `first_seen_at > last_visit_at`; when `last_visit_at` is null nothing is new. `newSinceLastVisit` counts new roles (reposts collapsed) ignoring the query's filters; `newJobs` is those roles themselves, newest first, at most 20, also ignoring the filters (the web banner links them). |
| `GET /api/jobs/:id/details`                       | `{ id, source, description, keyLines }`: the primary source's description (else the longest any source has; SimplifyJobs has none) and up to 8 key lines (2 per topic: experience, degree, visa, workplace, pay; `core/src/key-lines.ts`). 404 if the job doesn't exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/jobs/visit`                            | Sets `last_visit_at = now`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PATCH /api/jobs/:id`                             | Body `{ state: "new" \| "saved" \| "hidden" \| "applied" }`. Any state can move to any other (Undo relies on this). Marking applied sets `applied_at = now` only when it's empty (so a repost or an undone "Not applied" keeps the first date); leaving applied keeps the column as is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /api/companies`                              | All companies (incl. `tierSource`, `tierReason`) with health joined from `source_state` and `stats` (`roles30d`, `lastRoleAt`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /api/companies/add`                         | Body `{ query }` (1 to 300 characters: a careers or board link, or a name). Adds the company as in [Company upkeep](#company-upkeep) (Add by link or name) and rates its tier at once when a rater is configured, waiting at most 10 s (`RATE_WAIT_MS`) so the request stays inside the request timeout (a slower rating lands in the background). 201 with the company (the one it merged into when the AI found it's already listed under another name); message says when no board was found. 400 when the linked board doesn't exist or can't be reached, 409 when the name is already listed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/companies`, `PATCH /api/companies/:id` | Validated against the company invariants; 409 on a duplicate normalized name or `ats` + `slug`. Setting `status` to `ok` resets `consecutive_failures`. Changing `ats` without a `status` sets it: a supported ATS → `ok`, `other` → `manual_only` with `track = false`; moving off `other` onto a board with a slug also sets `track = true` unless the PATCH says otherwise. A `tier` in a PATCH makes it `tier_source = manual` (never overwritten; reason cleared); `autoTier: true` hands it back (`pending`, reason cleared) and rates it at once; both together → 400. POST creates `manual` tiers, `track` defaulting to true when there's a slug and the status isn't `manual_only`. The web app uses only `tier` and `autoTier`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DELETE /api/companies/:id`                       | Deletes it for good: dismisses every suggestion it stood for and keeps its names dismissed (see [Company upkeep](#company-upkeep)); its jobs keep `company_name` with `company_id` set null.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/suggestions`                            | Open suggestions with `listing_count > 0`, sorted by `listing_count` desc. The suggestions routes remain (auto-add reads the same rows) but no web page calls them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /api/suggestions/:id/add`                   | Body `{ tier }` (optional). With a tier, `tier_source = manual`; without one, tier C (`UNRATED_TIER`) and `pending`, so the AI rates it. Creates a company with `name = display_name`, `city`/`state` null, the suggestion's `ats`/`slug`. Supported `ats` with slug → company with `track = true`, status `ok` (polled from the next run, starting with a baseline). Supported `ats` without slug → `track = false`, status `needs_review`, note "find slug with discover". `other` → `manual_only`, `track = false`. Suggestion → `added`. 409 if a company with the same normalized name or the same `ats` + `slug` exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST /api/suggestions/:id/dismiss`               | Suggestion → `dismissed` (never shown again).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /api/settings`                               | `{ settings, lastPollAt, lastPollOkAt, lastPushAt, lastVisitAt, backup: { lastBackupAt, problem }, sourceOutages, sourceHealth, sources, tierModel }`: `lastPollOkAt` is when the last poll finished (the web app refetches job lists when it moves), `sourceHealth` the aggregators' health, `sources: { id, label, kind }[]` from the registry (the web app builds the Enabled-sources switches and source labels from it), `tierModel` the rater's model or null without `OPENAI_API_KEY`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PATCH /api/settings`                             | Partial update (see Settings); returns the same payload.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /api/logs`                                   | Query `after` (sequence cursor, default 0), `limit` (1 to 1000, default 500). Activity-log entries with `seq > after`, oldest first (the newest `limit` of them), plus `latestSeq`, `startedAt` (process start: a different value means a restart, so the client starts over) and `capacity`. Read-only, `Cache-Control: no-store`, not in the service worker's offline cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /health`                                     | 200 `{ status: "ok", lastPollAt, lastPollOkAt }`; 503 `unavailable` if the DB is unreachable (logged); 503 `stale` when the scheduler runs in this process and the last poll that _finished_ (or process start, whichever is later) is older than 3 × "Poll every", so Docker marks a stalled app unhealthy, including one whose polls start and then crash. Not under `/api`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Feed order

"Best first" sums a few points per job (`core/src/rank.ts`), highest first,
ties to the newest `effective_at`:

| Part       | Points                                                                             |
| ---------- | ---------------------------------------------------------------------------------- |
| Freshness  | effective age under 1 day 30, 3 days 24, 7 days 18, 14 days 12, 30 days 6, older 0 |
| Level      | title is entry level 20; otherwise listed by SimplifyJobs 12                       |
| Experience | a source's description asks for 2 years: -6 (3+ is hidden)                         |
| Tier       | S 20, A 15, B 10, C 6, D 3, Unlisted 0                                             |
| Place      | matches a named location other than Remote-US: 4                                   |

Freshness and level weigh most, so a fresh new-grad role beats a stale plain
one; a months-old "2027 Grads" role at an S-tier firm (44) still sits near a
fresh unlisted SimplifyJobs role (46). Collapsed reposts are ranked as one row.

## Web

Pages are built with the frontend-design skill. Routes: `/` (the feed and its
views), `/companies`, `/settings`, `/logs`; `/applied` redirects to
`/?view=applied` and `/suggested` to `/companies` (old links and home-screen
shortcuts).

- **Header** (no tab bar): the logo (a radar mark, shared with the tab and
  home-screen icons) and the `jobvr` wordmark, linking home; on the right the
  poll status ("polling…" with a pulsing dot while a poll runs, refetching
  every 3 s until it finishes; then "polled 3 min ago", counted from when the
  last poll finished; a dot that is red and says "late" when no
  poll started for about two intervals, amber with "Lever down" during a source
  outage, "offline · saved data" without a connection), which opens Logs; then
  Companies and Settings icons.
- **Feed views**: Feed, Saved, Applied and Hidden are one page, switched by a
  segmented control (`?view=`; the feed is plain `/`). The Feed view is best
  first (see [Feed order](#feed-order)); Saved and Hidden newest first;
  Applied always latest applied first, each row "Applied 3 d ago"
  (`applied_at`), closed ones included.
- **Filters**: one compact row: view, age (All, Today, 1h, 3 days, 1 week),
  order (Best / Newest; not shown on Applied), a "Tiers" button opening a
  checklist menu (tier dots, "B, C" or "B +3" when set, "Clear";
  none picked means the tracked tiers in Feed, every tier elsewhere), then
  search. The place, source and company filters are gone from the UI (places
  are set in Settings, and search covers companies, places and titles); the
  API still accepts them. Each view keeps its own tiers, age and order, saved
  in this browser's `localStorage` (`jobvr.filters`; not the text search):
  opening a view bare (a reload, the home-screen icon, the view switch, `1` to
  `4`) restores its last filters, so narrowing the feed never hides what you
  applied to. Job lists refetch when `lastPollOkAt` moves (the header's settings
  check runs every minute), not on a timer.
- **New since last visit**: the first response of the Feed view without a
  text search (any tiers or age) in a page load records the visit (`POST
  /api/jobs/visit`), and that response's `isNew` rows and `newJobs` stay
  marked for the rest of the page session (later refetches don't clear
  them). Saved, Applied, Hidden or a search don't count as a visit. A banner
  on the Feed view, "N new since your last visit", lists the new roles (3, then
  "Show all"), each with title, company, tier and age, opening its details,
  "hidden by filters" when the list below leaves it out; ones applied to or
  hidden since drop out; dismissing it keeps it closed for the visit. New rows
  in the list are highlighted with a "NEW" mark.
- **Rows**: age (green under a day, faded past three), title (struck through
  when closed), company with its tier badge unless Unlisted, locations with the
  matching ones first (`matchedLocations`; the adapter-added "Remote - US" is
  hidden next to another remote place), an "Entry level" badge, an "N+ yrs"
  tag when a source's description asks for experience, salary, its sources
  as quiet text (e.g. "Ashby · SimplifyJobs"), "N postings" for a role posted
  several times, Saved and Closed badges. Actions are icon-only (Applied,
  Save/Unsave, Hide/Unhide, Not applied on Applied; each label is its
  `aria-label` and tooltip), each with Undo (an undone "Not applied" keeps
  the original date), and apply to every repost. On phones the company and
  location share a line; on touch screens controls are at least 40 to 44 px.
- **Applied overview**: a card that slides open under the filters on the
  Applied view, built from every applied job (not the filters): the total;
  today (and yesterday), this week (vs last week), this month, per day over 30
  days (or since the first dated application), the streak (a day without an
  application yet today doesn't break it) and the best day; a foldable
  GitHub-style heatmap of applications per day (as many weeks as fit, up to a
  year; hover tooltips; open or folded remembered in this browser) with the
  mix by tier. It loads only while Applied is shown and recounts at local
  midnight. Applications from before `applied_at` was recorded count in the
  total only.
- **Search and paging** (any view): a "Search jobs" field (`/` focuses it, Esc
  clears) filters by title, company and places through `q`, kept in the URL.
  The header counts every match; past 500 rows a footer shows "500 of N" and
  "Show more" raises `limit` (reset whenever the query changes).
- **Details** (row button or `d`): a sheet with posted age, pay and sources,
  "Before you apply" key lines, the full description (collapsed), and Open
  posting / Applied / Save / Hide; closing it returns focus to the row.
- **Keyboard triage** (any view; `web/src/features/feed/use-feed-keys.ts`):
  `j`/`k` (or arrows, unless a radio group or menu has focus) move a selection
  that follows focus (Tab into a row selects it too); `o`/Enter opens the
  posting (Enter on a focused control does what the control does); `d`
  details; `a` applied, `s` save/unsave, `h` hide/unhide (each acting on all
  reposts; held keys don't repeat); `u` presses the newest Undo; `1` to `4`
  switch to Feed, Saved, Applied, Hidden; Esc clears the selection; `/`
  search; `?` lists them (also a "Shortcuts" button on pointer-fine screens).
  Keys are ignored while typing or in a dialog or menu. After a row leaves the
  list, the row that takes its place is selected and focused.
- **Scroll pill**: on pages at least 400 px taller than the screen, one small
  pill: "Bottom" at the bottom while in the top half (stepping aside for toasts
  and the settings save bar), "Top" under the header past the middle.
- **Tier colors**, used wherever a tier shows: S amber, A blue, B green,
  C plum, D grey, Unlisted faint.
- **Companies** (read-only list): name (with the AI's reason and city), tier
  badge (with an AI mark when rated, "?" when not rated yet; tooltip says
  where it came from), matching roles in the last 30 days, newest role, and one
  status dot: Checked directly, Via job lists (no readable board), Having
  trouble (`needs_review` or recent failures; jobvr is looking for a new
  board), Paused (tier not in "Tiers to track"); a legend explains the dots on
  phones. A search box (`/`) filters by name, city or tier. The row menu sets
  the tier, "Let jobvr rate it" (on picked tiers), opens the careers page, or
  removes the company (with Undo). Add opens one field, a careers link or a
  name (`POST /api/companies/add`).
- **Settings**: sections Feed (Tiers to track, Entry level only, years of
  experience, minimum salary), Places, Notifications (push every, max age,
  quiet hours), Sources (a switch per source with its outage or list health,
  Add companies automatically naming the rater's model, Show roles found only
  on the lists) and Advanced (folded: poll interval, store window, level
  requirements, keywords, categories), with a status strip (last poll, push,
  backup, outages) and, on desktop, a side nav lighting the section in view.
  One draft for the whole page and one save bar that slides up on a change
  (count, Save, Discard, the first problem to fix); per-field validation with
  the server's limits blocks Save; leaving with unsaved changes asks first.
  When the settings change underneath (another tab), untouched fields follow
  and edits in progress stay, also while a save is on its way.
- **Logs**: the activity log (`GET /api/logs`), newest first, fetched every
  4 s while live (Pause / Resume), with a level filter (All, Warnings, Errors),
  a time filter (All, Today, 1h) and a text filter; a restart starts the list
  over. A Copy button copies the lines shown, oldest first, as plain text
  (`2026-11-25 08:13:01 INFO  poll · …`). Each module keeps one color; poll
  start and finish, pushes and wakes are marked with a colored edge so each
  poll reads as a block; counts are highlighted (`+N new`, closed, failed,
  HTTP 4xx/5xx), and a "rated X B:" line shows the tier in its color.

PWA installable on the phone (over Tailscale HTTPS); manifest `id`/`scope` `/`,
standalone, maskable icon, and home-screen shortcuts to Saved (`/?view=saved`) and Applied (`/?view=applied`). Updates: the
service worker is checked whenever the app comes to the front (and hourly); a
waiting version shows a "Reload" toast instead of swapping code under unsaved
edits, and applies on the next cold launch if ignored. The service worker
precaches the app shell; API reads (`GET /api/{jobs,settings,companies}`)
are network-first, falling back to their last response (7 days,
60 entries) only when the request fails or takes over 6 s (a hanging
connection), marked `X-Jobvr-Offline: 1`. Then (or
when the browser reports no connection) the header shows "offline · saved
data"; writes fail with "Can't reach jobvr".

## Constants

| Constant                                               | Value                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Scheduler tick / first tick after boot / due tolerance | 5 min / 10 s / 60 s                                                                                 |
| Wake check (`WAKE_CHECK_MS` / `WAKE_GAP_MS`)           | every 15 s; a gap 60 s past that ticks at once                                                      |
| Poll store window (max effective age stored)           | Setting "Keep jobs posted within" (default 30 days); entry-level board titles 180 days              |
| In-memory dedupe/closure set                           | max(store window, 180 days)                                                                         |
| Retention for new/hidden jobs                          | max(store window, 180 days) + 15 days (cleanup every 24 h)                                          |
| Per-source concurrency (declared by each adapter)      | Greenhouse 3, Lever 3, Ashby 3, SmartRecruiters 2, Workable 2, SimplifyJobs 1, SpeedyApply 1, Jobright 1 |
| `FILTER_VERSION`                                       | integer in `core` (19 in late Nov 2026); bump whenever matching/normalization code changes (forces unconditional refetch) |
| Poll run budget                                        | 5 min                                                                                               |
| HTTP                                                   | 15 s timeout (60 s for a whole Greenhouse/Lever/Ashby board, not retried after it), 1 retry (1–3 s jitter, `Retry-After` ≤ 30 s), 50 MB cap |
| Invalid-item threshold                                 | > 50% of a non-empty response → fetch failure                                                       |
| Fuzzy dedupe                                           | title token-set Jaccard ≥ 0.85                                                                      |
| Failures before `needs_review`                         | 3 consecutive                                                                                       |
| Salary annualization                                   | hour × 2080, week × 52, month × 12                                                                  |
| Backups                                                | nightly `pg_dump` at 03:00 America/New_York (up to ~5 min late, see Edge Cases), keep 14; a missing one (none in 25 h) retried every 5 min; `backup --once` on demand; alerts after a problem lasts 10 min (`BACKUP_GRACE_MS`) |
| Company upkeep budget per tick                         | 60 s each for tiers and heal (`UPKEEP_BUDGET_MS`)                                                   |
| Auto-add                                               | 10 suggestions a run; a board that didn't answer retried after 1 day                               |
| AI tier rating                                         | 10 a run, 200 calls per rolling day, retry after 1 h; 300 completion tokens, 30 s timeout; add by link or name waits at most 10 s (`RATE_WAIT_MS`) |
| Heal                                                   | 3 companies a run, each every 6 h; gives up 3 days after `needs_review_since`                      |
| List boards                                            | 5 companies a run, each once a day                                                                  |
| Activity log                                           | 1000 entries (info and above), 2000 characters per message                                         |

## Key Decisions

| Decision                | Choice                                                                                                                                         | Rationale                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting (MVP)           | Docker on home Windows PC, 24/7                                                                                                                | $0; prove value before any AWS setup                                                                                                                                       |
| Database                | Postgres 18 in Docker + Drizzle                                                                                                                | Relational fit, $0, portable (Neon/Supabase from Lambda later, no VPC)                                                                                                     |
| Access / auth           | Tailscale sidecar + `tailscale serve`; `AUTH_MODE=none`                                                                                        | Private HTTPS (PWA needs a secure context), works on the phone away from home, no LAN exposure; Cognito later on AWS                                                       |
| Scheduling              | In-process 5-min tick; each task decides if it's due                                                                                           | Settings changes apply instantly; maps 1:1 to EventBridge later                                                                                                            |
| Push                    | ntfy.sh, long random topic (env secret)                                                                                                        | Native push, click-through URL, free                                                                                                                                       |
| Monorepo tooling        | pnpm workspace; core/poller/api use Biome; web keeps ESLint + Prettier; root husky + commitlint; lint-staged runs each package's tool          | Keeps each template's conventions                                                                                                                                          |
| Package boundaries      | `core` ← `poller` ← `api`; adapters injected into runPoll                                                                                      | No dependency cycle; core stays runtime-agnostic                                                                                                                           |
| Max job age             | Governs pushes and "new" counts; poller stores up to the store window (30 days by default)                                                     | Older-but-open roles stay findable; feed defaults to all ages, newest first                                                                                                |
| Filtering               | Poll-time (keeps DB small) + read-time V (current settings)                                                                                    | Tightening applies instantly; loosening applies on the next poll (ETag bypassed via `filters_hash`)                                                                        |
| Tier settings           | One "Tiers to track" for polling, pushes and the feed's default tier filter; "Entry level only" as a setting; feed filters remembered per view in the browser | A separate "feed and pushes" tier setting was tried and dropped (two tier settings confused); a remembered filter and a setting replace re-picking tiers and the feed's entry-level switch on every visit |
| Experience              | Parse "N+ years" from descriptions; hide 3+ (setting) unless the title is entry level; Greenhouse details fetched only for matching jobs, once | Unleveled board titles hid most of the noise: a Nov 2026 audit found ~15 of 42 board jobs asking for 3 to 10 years                                                         |
| Title rules             | Role AND NOT senior (level optional on boards); Simplify: trusted category or role; token-based                                                | Boards rarely say "new grad" (a live audit found 0 board matches with level required); role keywords are specific so "engineer" alone can't let in Sales/Civil/Legal roles |
| Canonical IDs           | `gh:<id>` / `lv:<uuid>` / `ab:<uuid>` / `sr:<id>` / `wk:<code>`; lists `sj:` / `sa:` / `jr:`                                                    | ATS IDs are globally unique; `gh_jid` career-page URLs have no slug                                                                                                        |
| Day-precision dates     | End of UTC day, capped at first seen                                                                                                           | Prevents fresh Simplify jobs looking ~24 h old                                                                                                                             |
| Locations               | Named locations with token aliases + built-in Remote-US rule                                                                                   | Sources format locations inconsistently                                                                                                                                    |
| Companies               | Suggestions only from companies with stored matching jobs; auto-added (polled when a board answers with jobs, else list-only), AI-tiered, healed; no Track switch, no Suggested page | No job stays Unlisted and nothing waits on a click; guards keep picked and seed tiers, limit AI merges to lookalike auto-added companies, keep deleted companies deleted, and cap AI spend |
| Dedupe                  | Exact via identity keys (`job_sources` rows or canonical ID), then fuzzy between a list side and an ATS side, or two different lists           | ATS data wins; never merges two distinct ATS postings; survives a fuzzy merge on later polls                                                                               |
| Source extensibility    | Registry-derived ids, prefixes, ATS values, concurrency; `text` columns                                                                        | Adding a source = one adapter file + one registry entry, no migration                                                                                                      |
| Per-target transactions | Merge/closures/suggestions per target in one transaction; ETag saved only on commit                                                            | A failed write can't be hidden behind a 304 forever                                                                                                                        |
| Closed jobs             | Tracked per source for polled targets; hidden from feed when all sources gone                                                                  | Removes dead links from the feed and pushes for everything still being polled                                                                                              |
| Posted date required    | Adapters must supply `postedAt` (items without one are invalid)                                                                                | Every source always does; keeps the store window and cleanup from resurrecting deleted jobs                                                                              |
| CI / deploy             | GitHub Actions: lint, typecheck, test, build, Docker build. Deploy on PC: `git pull && docker compose up -d --build`                           | No cloud deploy target yet                                                                                                                                                 |

## Edge Cases & Constraints

- Simplify changes ~every 30 min, so most polls download ~2 MB gzip and parse
  ~12 MB of JSON in-process.
- Simplify apply URLs often point to Greenhouse/Lever/Ashby (including EU/ANZ
  Greenhouse hosts and `gh_jid` career pages); canonical IDs merge them with
  direct ATS jobs exactly.
- Loosening filters makes newly matching jobs eligible; those within max age
  will push (they are genuinely new matches).
- A new company's first successful poll is a baseline even if some of its jobs
  are minutes old (per requirements).
- Unleveled board titles ("Software Engineer") include some roles that want a
  few years of experience; the Experience rule hides those asking for 3+, the
  feed's "Entry level" badge marks the ones that explicitly say so (or come
  from SimplifyJobs), and "Require a level keyword on company boards" drops the
  rest if that's noisy.
  `pnpm match-report` shows what passes and why the rest is rejected.
- `needs_review` companies (a seed slug that 404s, or 3 failures in a row)
  keep being polled (cheap 404s) so they can recover, while the heal step
  searches for a new board by name every 6 h; one is found, or 3 days after
  `needs_review_since` the company becomes `manual_only` and its jobs come from
  the lists (see [Company upkeep](#company-upkeep)).
- A board slug guessed from a name only proves a board exists, and a shortened
  guess ("scale" for Scale AI) can be another company's → heal accepts only
  guesses that contain the whole name, and only boards with open jobs.
- A list can name a company already on the list under another name ("Kira"
  for Kira Learning, "Bank of Montreal" for "BMO") → resolution reads board
  slugs as names and aliases, and the AI rater's "same company" answer merges
  an auto-added duplicate into a lookalike (see the merge guards).
- SmartRecruiters' first-page ETag can miss a posting that closes deeper in a
  board while nothing new is posted; it closes on the board's next change. A
  board that keeps returning fewer postings than `totalFound` (over 2,000 US
  postings) never closes anything and is read in full every poll.
- PC sleep / Windows Update reboots cause missed ticks; the boot tick catches
  up after a reboot, and the scheduler's wake check ticks right away after a
  sleep (timers pause while asleep). Docker Desktop must start at login and PC
  sleep should be disabled. `/health`
  and company health expose staleness.
- Postgres 18 images keep data under `/var/lib/postgresql/18/docker`; the
  compose volume must mount `/var/lib/postgresql` (not `.../data`, which fails
  at startup on 18).
- Backups live on the PC disk; point the backup folder at a synced folder
  (OneDrive/Dropbox) for off-machine copies.
- A silently failing backup is found only at restore time → `backup.sh` records
  each result in `settings` (`last_backup_at`, `backup_error`,
  `backup_error_at`); the scheduler's backup check (`runBackupCheck`) pushes
  "jobvr backup problem" when the last backup failed or none succeeded for 26
  h, outside quiet hours, at most once a day (`backup_alert_at`), and only once
  the problem has lasted 10 min (`BACKUP_GRACE_MS`), so waking after a night
  asleep doesn't alert before the backup service has caught up; Settings
  shows the last backup or the problem. Nothing is reported until a backup was
  recorded once (none runs on the Mac). A single long `sleep` stops counting
  while the PC sleeps or hibernates, so the script naps 5 min at a time
  against the wall clock: the nightly dump runs up to ~5 min after 03:00. On
  every nap it also checks for a dump in the last 25 h and takes one when
  there's none, so a PC that was off or asleep at 03:00, or a catch-up that
  failed (Postgres still starting after Docker restarts), is retried every 5
  minutes instead of the next night.
- A poll that starts every tick and then crashes leaves only a quiet feed →
  each poll records when it finished (`last_poll_ok_at`; boards failing don't
  count against it), and the scheduler's poll check (`runPollStallCheck`)
  pushes "jobvr polling stalled" when none finished for 3 × "Poll every"
  (counted from boot at the earliest), outside quiet hours, at most once a day
  (`poll_stall_alert_at`).
- `git pull` replaces `deploy/backup.sh` → compose mounts the `deploy/` folder
  (a single-file mount keeps the old copy) and each night runs a fresh copy of
  the script, so updates apply without recreating the service.
- An unpinned sidecar image could pull a breaking Tailscale release on any
  restart → `docker-compose.yml` pins `tailscale/tailscale:v1.104.7`; bump it
  by hand.
- Every request reaches the app from the Tailscale sidecar, so one rate-limit
  bucket would be shared by every device → compose sets `TRUST_PROXY=true`
  (only Tailscale reaches the app, and it sets `X-Forwarded-For` to the
  device's tailnet address), so rate limits are per tailnet device.
- Docker Desktop never rotates container logs → every compose service caps
  them at 5 × 10 MB, and the app logs at `PC_LOG_LEVEL` (default `info`), not
  the `.env` `LOG_LEVEL` meant for the Mac.
- Compose puts `POSTGRES_PASSWORD` into `DATABASE_URL` unescaped → the password
  must be letters and digits (`openssl rand -hex 32`); the app rejects a
  `DATABASE_URL` that doesn't parse with that hint.
- ntfy.sh topics are readable by anyone who knows the name → long random topic;
  push bodies carry public job titles and company names only (nothing personal); the click URL is reachable only on the tailnet.
- Job links come from third-party data (SimplifyJobs is community-edited) →
  listing and careers URLs must be http(s) (others are invalid items), the
  feed renders only http(s) links, and every response except `/reference` sends
  a Content-Security-Policy allowing only the app's own scripts.
- No login (tailnet only), so any page open in the browser could POST to
  jobvr → `/api` writes (not GET/HEAD/OPTIONS) are refused with 403 when
  `Sec-Fetch-Site` is `cross-site`/`same-site`, or (browsers without it) when
  `Origin` names another host; `ALLOWED_ORIGINS` and requests with neither
  header (curl, scripts) pass. `docker-compose.yml` sets `ALLOWED_ORIGINS` empty
  (the PC is same-origin), so the Mac's localhost origins from `.env.example`
  are never trusted in production.
- A deploy replaces the hashed assets → `/assets/*` that no longer exist return
  404 (never `index.html`, which would be cached for a year as immutable).

## Testing

Vitest everywhere.

- **Adapters** (saved fixture responses): parsing to `SourceJob`, 304, 404,
  malformed items and the 50% threshold, field mapping, Remote-US enrichment
  (Ashby Hybrid with `isRemote = true` must not get it), Simplify date precision
  detection, `parseUrl` (all Greenhouse hosts, `embed/job_app?token=`, `gh_jid`,
  Lever `/apply`, `jobs.eu.lever.co` rejected, Ashby `/application?embed=true`,
  SmartRecruiters and Workable links), `boardSlug`, SmartRecruiters paging and
  the `totalFound` hold, Workable hidden places and pay.
- **Core units**: tokenization and keyword rule (incl. plurals), experience
  parsing (real posting phrases, degree alternatives, company history), location rule (Remote-US vs
  "Remote in UK"), salary annualization and currency, freshness (day precision),
  canonical ID, identity keys and company resolution (incl. re-resolution),
  exact dedupe across polls after a fuzzy merge, fuzzy dedupe (including never
  merging two ATS jobs), baseline, closures, suggestions grouping, due checks
  (tolerance), quiet hours (wrap, start = end, DST), pushable selection (tier vs
  track), `filters_hash` ETag bypass, per-target transaction rollback (ETag not
  saved), column-scoped writes not clobbering a concurrent Hide; company
  upkeep (auto-add, AI tiering with a fake rater and the merge guards, heal's
  name check and 3-day clock, add by link or name, slug candidates); level codes
  (L3, L4, IC3, ranges); built-in rejects, alternatives and role-phrase masks,
  new-grad engineering parts, and a bare "Remote" beside foreign places.
- **Integration**: repositories and API routes against Testcontainers Postgres,
  using Hono `testClient`; the scheduler's step order and stop; the activity
  log's redaction and `GET /api/logs`. Web: Vitest + Testing Library for the
  filter bar, saved filters, the new-since banner, rows, keyboard triage, job
  actions (Undo keeps the applied date), applied stats and the settings draft.

## Build Order

1. Monorepo scaffold from templates (core, poller, api, web), root tooling,
   `docker-compose.dev.yml` with Postgres.
2. core: schemas, Drizzle schema/migrations, repositories, settings defaults.
3. Adapter interface + Greenhouse, Lever, Ashby adapters with fixture tests.
4. Matching, freshness, dedupe, baseline, closures (tests); `poller/data/companies.json`
   with the **Verified** tables of `docs/SEED.md` only, and the `seed` script (API-confirmed via `probe`, else
   `needs_review`; insert-only, never overwrites existing companies, except
   that a still-`manual_only` "other" company is moved to the supported board
   its seed entry now names), so
   `pnpm poll` has real data from here on.
5. SimplifyJobs adapter + cross-source dedupe + suggestions.
6. API routes: jobs, companies, suggestions, settings.
7. Web (frontend-design skill): Feed → Companies → Suggested → Settings (Suggested was
   removed in Nov 2026 once companies added themselves).
8. Notifier, quiet hours, cleanup, scheduler.
9. `discover` script: `pnpm discover "<Company Name>"` calls `probe` on every
   registered ATS adapter for each slug candidate and prints which respond (with
   job counts); it writes nothing. Candidate generation (`slugCandidates` in
   `core/src/find-board.ts`, shared with add by name and heal): split the name into
   words on non-alphanumerics and on lower→Upper boundaries ("EliseAI" →
   [Elise, AI]). Base word lists: (a) all words; (b) all words minus trailing
   words in {ai, labs, inc, technologies, software, robotics, hq} (case-insensitive),
   if any remain and differ from (a). For each base list, three forms: joined
   in original case (`EliseAI`), joined lowercase (`eliseai`), lowercase joined
   with `-` (`elise-ai`). Then, for each of the two lowercase forms, append `hq`, `-hq`,
   `-io`, `inc`. De-duplicate, preserving that order. Run it on the "find slug",
   research, and reference-only lists and record results in `companies.json`:
   - "Find slug" company found → `track` per tier rule, status `ok`; not found →
     kept with its listed ATS, no slug, `track = false`, `needs_review`.
   - Research company found → `track = true`, status `ok`; not found →
     `ats = other`, `manual_only`, `track = false`.
     Then seed them plus the `manual_only` and reference-only companies.
10. PC deployment (Dockerfile, compose, Tailscale sidecar, backups), CI, README
    (setup, deploy, add a company, add a source adapter).

## Future: AWS

Lambda (nodejs24.x) entry files for API/poll/notify/cleanup, EventBridge
Scheduler, S3 + CloudFront (jobvr.dev, HTTPS), Cognito (`AUTH_MODE=cognito`),
Postgres via Neon/Supabase free tier (no VPC) or a DynamoDB repository
implementation. Cost guardrails: no NAT/EC2/RDS/VPC Lambdas, 7-day log
retention, timeouts/retry/concurrency limits as above, AWS Budget alert at $5.

## Open Questions

- None. (Domain `jobvr.dev` will be registered at the AWS phase.)

## References

- Templates: `~/cs/templates/hono-starter`, `~/cs/templates/react-starter`
- SimplifyJobs: github.com/SimplifyJobs/New-Grad-Positions (branch `dev`)
- Greenhouse Job Board API, Lever Postings API, Ashby Posting API,
  SmartRecruiters Posting API, Workable widget and v2 job APIs, OpenAI Chat Completions
- ntfy.sh, Tailscale (serve, sidecar container), Drizzle ORM
- Seed list: `docs/SEED.md`
