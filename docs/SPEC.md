# jobvr

## Vision

A personal, single-user job-hunting app that polls company job boards
(Greenhouse, Lever, Ashby) and the SimplifyJobs New-Grad list for new-grad
software engineering roles, shows them in a web feed, and sends one bundled
phone push per interval. It runs 24/7 in Docker on a home Windows PC at $0/month,
and is structured so it can later move to AWS serverless with minimal change.

## Goals

- See new matching new-grad SWE roles within ~15 minutes of them appearing.
- One bundled push ("5 new jobs") per interval, never spam, respect quiet hours.
- No duplicate jobs across sources; direct ATS data wins over aggregator data.
- Track applications from the same app ("Applied" in the feed creates one).
- Every behavior-shaping value is a setting stored in the DB and editable in the UI.
- Adding a new job source = one adapter file + one registry entry.
- Usable from Mac and phone anywhere via Tailscale.
- Cost: $0/month while running on the PC.

## Non-Goals

- Multi-user, signup, or public access.
- Sources beyond the four MVP sources: no Workday, Amazon Jobs, iCIMS, Avature,
  custom career sites, other ATS platforms, HN, headless scraping, or anything
  requiring login or forbidden by terms (LinkedIn, Indeed, Glassdoor, Handshake).
- SMS. Email digest (setting exists, feature not built in MVP).
- AWS deployment in the MVP (deferred to a later phase; see "Future: AWS").
- Auto-tracking discovered companies.

## Architecture

pnpm workspace monorepo. One Node process (Hono) serves the API, the built web
SPA, and runs an in-process 5-minute scheduler tick. Postgres 17 runs beside it.
Both run via `docker compose` on the Windows PC (Docker Desktop + WSL2,
`restart: unless-stopped`). Access is over Tailscale; the tailnet is the auth
boundary (`AUTH_MODE=none`).

A `tailscale/tailscale` sidecar container joins the tailnet as node `jobvr` and
runs `tailscale serve` → `https://jobvr.<tailnet>.ts.net` with a valid TLS cert.
HTTPS is required for the PWA service worker / install on the phone. No app or
Postgres ports are published on the host, so nothing is reachable from the LAN
(important because `AUTH_MODE=none`). Postgres is exposed only on the tailnet
node for Mac access (TablePlus / Drizzle Studio).

```
jobvr/                          pnpm 12, Node 26
├── core/     Zod schemas, Drizzle schema + migrations, repositories (Postgres),
│             filters, freshness, dedupe, location matcher, URL normalizer,
│             runPoll(), runNotify(), notifier (ntfy)
├── poller/   sources/{greenhouse,lever,ashby,simplify}.ts + sources/index.ts
│             scripts/{discover,seed}.ts · fixtures
├── api/      from hono-starter; modules/{jobs,applications,companies,suggestions,settings}
│             server.ts = API + static web/dist + scheduler tick
├── web/      from react-starter; TanStack Router/Query, Tailwind + shadcn/ui, vite-plugin-pwa
├── docker-compose.yml   app + postgres:17 + tailscale sidecar + nightly pg_dump backup (keep 14)
└── Dockerfile           multi-stage (builds web, bundles api)
```

### Key Components

- **Source adapters** (`poller/src/sources/`): one file per source, each
  returning Zod-validated `SourceJob`s. Registered in `sources/index.ts`.
- **runPoll** (`core`): fetch → normalize → filter → dedupe → baseline →
  persist → suggestions → health. Guarded by an in-process "running" flag plus
  `pg_try_advisory_lock` held on one dedicated connection for the run (so a
  manual `pnpm poll` can't overlap the server's tick). Lock not acquired → skip.
- **runNotify** (`core`): selects unnotified matching jobs, sends one ntfy push,
  marks them notified.
- **Scheduler**: `setInterval` tick every 5 min, plus one tick ~10 s after boot
  (catch-up after reboots); poll/notify each check settings and their last-run
  time and exit early if not due. (On AWS this becomes an EventBridge Scheduler
  rule with identical logic.)
- **Ports** (interfaces with swappable implementations): repositories (Postgres),
  `Notifier` (ntfy), auth middleware (`AUTH_MODE`: `none`; later `cognito`),
  scheduler (in-process tick; later EventBridge).
- **API**: Hono + `@hono/zod-openapi`; typed `hc` client consumed by web.
- **Web**: React + Vite SPA. Pages: Feed, Applications, Companies, Suggested, Settings.

### Data Flow

```
tick (5 min) ─┬─> runPoll ─> adapters (HTTP, ETag) ─> filter ─> dedupe ─> Postgres
              └─> runNotify ─> Postgres (unnotified jobs) ─> ntfy push ─> phone
phone/Mac ── Tailscale ──> Hono (API + SPA) ──> Postgres
```

## Sources (MVP: exactly four)

All four were verified on 2026-11-12. Every ATS API returns ETags (use
`If-None-Match`) and 404 for unknown slugs.

| Source | Endpoint | Posted date | Notes |
|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` (no `content`) | `first_published` | Never use `updated_at` as posted date. No salary without `content`. |
| Lever | `api.lever.co/v0/postings/{slug}?mode=json` | `createdAt` (epoch ms) | Large uncompressed payloads (Gopuff 7.8 MB, no gzip) → ETag/304 matters. `salaryRange` exists but is rare (0/776 at Gopuff). |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | `publishedAt` | Structured compensation (min/max/interval/currency). Gzip supported. |
| SimplifyJobs | `raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json` | `date_posted` (epoch s, **day-granular**, midnight UTC) | ~12 MB / ~2 MB gzip, ~19k listings, updated ~every 30 min; 304 on unchanged ETag. Fields: `id, company_name, title, url, locations[], category, active, is_visible, date_posted, date_updated, sponsorship, degrees, source, company_url`. Categories are inconsistent ("Software", "Software Engineering"). Locations look like `NYC`, `New York, NY`, `Jersey City, NJ`, `Remote in USA`, `Remote in UK`. |

All four confirmed to return 304 on `If-None-Match` (2026-11-12).

### URL parsing (`parseUrl`)

Greenhouse, Lever, and Ashby job IDs are globally unique, so canonical keys don't
need a slug. `parseUrl` returns `{ sourceJobId, slug? }`:

- Greenhouse: `{boards,job-boards,job-boards.eu,job-boards.anz}.greenhouse.io/{slug}/jobs/{id}`,
  and any URL with a `gh_jid={id}` query param (company career pages embedding
  Greenhouse; slug unknown — 43 of 1,190 active Simplify software listings).
- Lever: `jobs.lever.co/{slug}/{uuid}[/apply]`.
- Ashby: `jobs.ashbyhq.com/{slug}/{uuid}[/application]`.

### Adapter interface

```ts
type SourceId = "greenhouse" | "lever" | "ashby" | "simplify";

interface SourceAdapter {
  id: SourceId;
  scope: "company" | "global";
  concurrency: number;                                   // ATS: 3, simplify: 1
  fetch(ctx: FetchCtx): Promise<FetchResult>;           // ctx: { slug?, etag?, signal, http }
  parseUrl?(url: string): { sourceJobId: string; slug?: string } | null;
  probe?(slug: string, ctx: ProbeCtx): Promise<boolean>; // for `discover`
}

type FetchResult =
  | { status: "not_modified"; etag: string }
  | { status: "ok"; etag?: string; jobs: SourceJob[] };

// SourceJob: source, sourceJobId, companyName, companySlug?, title, locations[],
//            remote?, url, postedAt?, postedAtPrecision ("instant" | "day"),
//            salary? { min?, max?, currency, interval }, meta?
```

Shared HTTP helper: 15s timeout, 1 retry with jitter on network/5xx/429 (no retry
on 4xx), `If-None-Match`, `User-Agent: jobvr (personal job alerts)`, 50 MB cap.

## Data Model (Postgres, Drizzle)

| Table | Columns |
|---|---|
| `settings` | single row: `data` JSONB (Zod `Settings`, parsed with defaults on read so new settings fields need no migration), `last_visit_at`, `last_poll_at`, `last_push_at` |
| `companies` | id, name, city, state, tier (S/A/Mid/Startup/Corporate), track, ats (greenhouse/lever/ashby/other), slug, careers_url, notes, status (ok/needs_review/manual_only) |
| `source_state` | (source, company_id nullable) → etag, last_success_at, last_attempt_at, consecutive_failures, last_error, baselined_at |
| `jobs` | id (canonical key), company_id?, company_name, title, locations text[], url, primary_source, posted_at?, first_seen_at, effective_at, salary_min/max? (annual USD), state (new/saved/hidden/applied), baseline, notified_at? |
| `job_sources` | (job_id, source) → source_job_id, url, posted_at |
| `applications` | id, job_id? (FK on delete set null), company/title/url snapshot, status (applied/oa/interview/offer/rejected), applied_at, notes |
| `suggestions` | normalized_name PK, display_name, ats, slug, listing_count, sample_titles, last_seen_at, state (open/dismissed/added) |

Canonical job IDs: `gh:<id>`, `lv:<uuid>`, `ab:<uuid>`, `sj:<uuid>` (only when
the Simplify URL isn't a parseable ATS URL). All timestamps are `timestamptz`.

Company for a job: ATS jobs → the polled company. Simplify jobs → match by ATS
slug (if parsed) else normalized company name (lowercase, strip punctuation and
suffixes like inc/llc/corp/technologies); no match → `company_id` null, tier
`Unlisted`. Tier is never copied onto jobs; it's joined from `companies` at read
time so tier edits apply immediately.

Indexes: `jobs(effective_at desc)`, partial `jobs(notified_at) where notified_at is null`,
`jobs(company_id, title)`.

Retention: daily cleanup deletes jobs older than 30 days unless saved/applied.

## Pipeline Rules

### Poll (`runPoll`)

1. Lock (see runPoll above); load settings, companies, source_state, last 7 days of jobs.
2. Fetch each enabled source within its concurrency limit. One company failing
   never stops others. Polled companies: `track = true` AND tier in tracked tiers
   AND status ≠ `manual_only` (`needs_review` companies are still polled so they
   can recover).
3. Normalize; compute canonical ID (Simplify jobs with ATS URLs use the ATS key via `parseUrl`).
4. Poll-time filter (see Matching rules): location + title exclude for all;
   role + level keywords for ATS jobs; Simplify: `active && is_visible` +
   software category (level keywords off by default). Skip jobs with effective
   age > 7 days.
5. Dedupe against in-memory set: canonical key / normalized URL first, then same
   company + title token Jaccard ≥ 0.85. Merge into `job_sources`; ATS fields win;
   job ID never changes; `effective_at` recomputed as the min across sources.
6. Baseline: if the company/source has no `baselined_at`, save new jobs with
   `baseline = true` (shown in feed, never pushed, not counted as "new"), then set it.
7. Suggestions: Simplify companies not in `companies` (and not dismissed/added)
   → upsert with ATS detected from the apply URL via the adapters' `parseUrl`
   (supported ATS with slug → one-click trackable; `gh_jid` URL without slug →
   "find slug" via `discover`; anything else → `other`).
8. Health: success resets failures (and returns `needs_review` → `ok` if it was
   set by failures); failure increments + stores error; 3 consecutive failures →
   company `needs_review`.

### Matching rules

- All keyword matching is case-insensitive and **whole-word/phrase** (token
  boundaries), so `software engineer i` doesn't match "II"/"Intern", `lead`
  doesn't match "leadership", `sr.` matches "Sr." and "Sr".
- ATS jobs pass if title has ≥ 1 **role** keyword AND ≥ 1 **level** keyword AND 0
  **exclude** keywords. Simplify jobs: exclude only (level optional via setting).
- Location: a job passes if any of its locations matches any alias of any
  enabled named location. Remote-US matches "remote" only when the string has
  no country, or a US country token (us/usa/united states/u.s.); "Remote in UK",
  "Remote - Canada" do not match.
- Salary: only applied when a salary is listed. Ranges are annualized (hourly ×
  2080). Passes if listed max (or min when no max) ≥ min salary setting.

If > 50% of a response's items fail Zod validation, the fetch counts as a failure
(likely schema change). Individual invalid items are logged and skipped.

### Freshness

`first_seen_at` = first time the job ID is seen. `effective_at` = earlier of
`first_seen_at` and the source's posted date. Max job age governs pushes and
"new" counts; the poller stores matching jobs up to 7 days old so the feed's
3-day filter works.

Day-granular posted dates (Simplify `date_posted` = midnight UTC) are treated
as the **end** of that UTC day when computing `effective_at`. Otherwise a job
posted at 7 pm ET would look ~24 h old on first sight and be dropped by the 24 h
max age (especially after a quiet-hours hold). Old listings still come out old.

### Notify (`runNotify`)

Due when `now − last_push_at ≥ pushEvery` and not in quiet hours
(America/New_York, wraps midnight, DST-safe via `Intl`). Select jobs:
unnotified, not baseline, not hidden, effective age ≤ max age, passing current
settings (tier, salary, location, sources, show Simplify). The tier check uses
the company's tier (or `Unlisted`), **not** its `track` flag — so Simplify jobs
from manual_only Corporate companies (e.g. JPMorgan) still push, while jobs from
S/A companies don't unless those tiers are enabled. If any → one ntfy push ("N new jobs", click URL → feed `?new=1`) →
set `notified_at` + `last_push_at`. No jobs → no push. Held jobs roll into the
next push; jobs that age out while held are dropped. ntfy failure → nothing
marked, retried next tick.

## Settings (DB, all editable in UI)

| Setting | Default |
|---|---|
| Locations (label + aliases) | NJ → nj, new jersey · PA → pa, pennsylvania, philadelphia, pittsburgh · NYC → nyc, new york, brooklyn, manhattan · Remote-US → special rule (see Matching rules). State codes match as whole tokens, so "Jersey City, NJ" / "Malvern, PA" match without listing every town. |
| Tiers to track | Mid, Startup, Corporate, Unlisted (S, A off) — controls which companies are polled and which jobs are pushed |
| Role must include (any) | software, engineer, engineering, developer, swe, sde, programmer, full stack, backend, frontend |
| Level must include (any) | new grad, entry, junior, early career, associate, graduate, software engineer i |
| Title must exclude | senior, sr., staff, principal, lead, manager, director, iii, ii, intern, internship |
| Apply level keywords to Simplify | Off |
| Max job age (hours) | 24 |
| Poll every (minutes) | 15 |
| Push summary every (minutes) | 60 |
| Quiet hours (ET) | 23:00–07:00 |
| Min salary (if listed) | 0 (none); unknown salary passes |
| Email digest | Off (not implemented in MVP) |
| Enabled sources | greenhouse, lever, ashby, simplify |
| Show SimplifyJobs jobs | On |
| Suggest companies from SimplifyJobs | On |

Secrets (ntfy topic URL) come from env, not the DB.

## API

All under `/api`, response envelope `{ success, data?, error?, message?, count?, details? }`.

| Route | Purpose |
|---|---|
| `GET /api/jobs?age=1h\|24h\|72h&location=&company=&tier=&source=&state=` | Feed, newest `effective_at` first; hidden excluded unless `state=hidden`. Returns `lastVisitAt` and `newSinceLastVisit` = non-baseline jobs with `first_seen_at > last_visit_at` (uses first-seen, not posted, so late-discovered jobs count). |
| `POST /api/jobs/visit` | Set `last_visit_at = now`. Web calls it right after the feed loads, keeping the returned `lastVisitAt` in memory to highlight "new" rows for that session (no unreliable "on leave" hook). |
| `PATCH /api/jobs/:id` | `{ state: saved \| hidden \| new }` |
| `POST /api/jobs/:id/apply` | Create application + set job `applied` (one transaction) |
| `GET/POST /api/applications`, `PATCH/DELETE /api/applications/:id` | Tracker |
| `GET/POST /api/companies`, `PATCH/DELETE /api/companies/:id` | Companies + joined health; status → ok resets failures |
| `GET /api/suggestions`, `POST /api/suggestions/:id/add`, `POST /api/suggestions/:id/dismiss` | Add: supported ATS with known slug → company `track = true`, tier `Startup` (editable inline), status ok, baselined on first poll. Otherwise → `manual_only`, `track = false`. Nothing is added without a click. |
| `GET /api/settings`, `PATCH /api/settings` | Partial update; includes last poll/push times |
| `GET /health` | Uptime + last poll age |

`POST /api/applications` also accepts manual entries (no `job_id`) for roles
found elsewhere (e.g. Workday companies).

## Web

Pages (built with the frontend-design skill): **Feed** (newest first, "X new since
last visit", filters: age/location/company/tier/source; Applied/Save/Hide; "via
SimplifyJobs" label), **Applications** (board by status), **Companies** (tier,
Track toggle, ATS, slug, status, health), **Suggested** (Add/Dismiss),
**Settings**. PWA installable on phone (served over Tailscale HTTPS). Service
worker caches the app shell only; API requests are network-only.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hosting (MVP) | Docker on home Windows PC, 24/7 | $0; prove value before any AWS setup |
| Database | Postgres 17 in Docker + Drizzle | Relational fit, $0, portable (Neon/Supabase from Lambda later, no VPC) |
| Access / auth | Tailscale; `AUTH_MODE=none` | Private, works on phone away from home; Cognito later on AWS |
| Scheduling | In-process 5-min tick, code decides if due | Settings changes apply instantly; maps 1:1 to EventBridge later |
| Push | ntfy.sh, long random topic (env secret) | Native push, click-through URL, free |
| Monorepo tooling | pnpm workspace; api/core/poller use Biome; web keeps ESLint + Prettier; root husky + commitlint, lint-staged routes per package | Keeps each template's conventions |
| Shared code | `core/` package | Single source for schemas, repos, domain logic |
| Max job age | Governs push + "new"; store 7 days | Feed 3-day filter works |
| Filtering | Poll-time (keeps DB small) + read-time (current settings) | Tightening filters applies instantly |
| Title rules | ATS: role AND level AND NOT exclude, whole-word | A level-only rule let through "Renewals Associate" (live Airtable board) |
| Simplify title rule | Exclude list only (level off) | Simplify is already new-grad; titles often plain "Software Engineer" |
| Canonical IDs | `gh:<id>` / `lv:<uuid>` / `ab:<uuid>` (no slug) | IDs are globally unique; `gh_jid` career-page URLs have no slug |
| Day-granular dates | Treated as end of UTC day | Prevents fresh Simplify jobs looking ~24 h old |
| HTTPS | Tailscale sidecar + `tailscale serve` | PWA needs a secure context; no LAN exposure |
| Locations | Named locations with editable aliases | Sources format locations inconsistently |
| Suggestions | Add (starts tracking if supported) + Dismiss | Nothing added without a click |
| Dedupe | Canonical ATS key / URL, then company + title Jaccard ≥ 0.85 | ATS data wins; keep both sources |
| Email digest | Not built in MVP | No SES/SMTP needed yet |

## Edge Cases & Constraints

- Simplify file changes ~every 30 min, so most polls download ~2 MB gzip; parse in-process (~12 MB JSON).
- Simplify `date_posted` is day-granular (midnight UTC) → end-of-day rule (see Freshness).
- Simplify listings' apply URLs often point to Greenhouse/Lever/Ashby (incl. EU/ANZ Greenhouse hosts and `gh_jid` career pages) → canonicalize so they merge with direct ATS jobs.
- Greenhouse `updated_at` is not a posted date; use `first_published`.
- Quiet hours wrap midnight and must handle DST (America/New_York).
- PC sleep / Windows Update reboots cause missed ticks; harmless, boot tick catches up. `/health` and company health expose staleness. Docker Desktop must start at login; PC sleep disabled.
- Overlapping polls prevented by in-process flag + advisory lock.
- Polite polling: per-source concurrency, ETags, timeouts, retry limits.
- `needs_review` seeds whose slug 404s keep being polled (cheap 404s) until fixed or set to manual_only.
- Jobs filtered out at read time never get `notified_at`; the max-age check and 30-day retention bound this.
- Backups land on the same PC disk; point the backup folder at a synced folder (OneDrive/Dropbox) for off-machine copies.
- ntfy.sh topics are readable by anyone who knows the name → long random topic; pushes contain only a count and the tailnet URL.

## Testing

Vitest. Adapter tests from saved fixture responses (incl. 304, 404, malformed
items, `parseUrl` incl. `gh_jid` and regional hosts). Unit tests for matching
rules (whole-word, role+level+exclude, Remote-US vs "Remote in UK"), location
matcher, salary annualization, freshness (incl. day-granular dates), dedupe,
baseline, quiet hours (wrap + DST), notifier selection (tier vs track). Repository + API integration tests
against Testcontainers Postgres and Hono `testClient`.

## Build Order

1. Monorepo scaffold from templates (api, web, core, poller), root tooling, compose with Postgres.
2. core: schemas, Drizzle schema/migrations, repositories, settings defaults.
3. Adapter interface + Greenhouse, Lever, Ashby adapters with fixture tests.
4. Filters, freshness, dedupe, baseline (tests); `seed` script for the
   verified companies in `docs/SEED.md` (API-confirmed, else `needs_review`) so
   `pnpm poll` has real data from here on.
5. SimplifyJobs adapter + cross-source dedupe + suggestions.
6. API routes: jobs, applications, companies, suggestions, settings.
7. Web (frontend-design skill): Feed → Applications → Companies → Suggested → Settings.
8. Notifier + quiet hours + scheduler tick.
9. `discover` script; run on "find slug" + research lists; seed results,
   manual_only, and reference-only companies.
10. PC deployment (Dockerfile, compose, backups, Tailscale), CI, README
    (setup, deploy, add a company, add a source adapter).

## Future: AWS

Lambda (nodejs24.x) entry files for API/poll/notify, EventBridge Scheduler,
S3 + CloudFront (jobvr.dev, HTTPS), Cognito (`AUTH_MODE=cognito`), Postgres via
Neon/Supabase free tier (no VPC) or a DynamoDB repository implementation. Cost
guardrails: no NAT/EC2/RDS/VPC Lambdas, 7-day log retention, AWS Budget alert at $5.

## Open Questions

- None blocking. Domain `jobvr.dev` to be registered later.

## References

- Templates: `~/cs/templates/hono-starter`, `~/cs/templates/react-starter`
- SimplifyJobs: github.com/SimplifyJobs/New-Grad-Positions (branch `dev`)
- Greenhouse Job Board API, Lever Postings API, Ashby Posting API
- ntfy.sh, Tailscale, Drizzle ORM
