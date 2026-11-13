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
├── docker-compose.yml   app + postgres:17 + nightly pg_dump backup (keep 14)
└── Dockerfile           multi-stage (builds web, bundles api)
```

### Key Components

- **Source adapters** (`poller/src/sources/`): one file per source, each
  returning Zod-validated `SourceJob`s. Registered in `sources/index.ts`.
- **runPoll** (`core`): fetch → normalize → filter → dedupe → baseline →
  persist → suggestions → health. Guarded by a Postgres advisory lock.
- **runNotify** (`core`): selects unnotified matching jobs, sends one ntfy push,
  marks them notified.
- **Scheduler**: `setInterval` tick every 5 min; poll/notify each check settings
  and their last-run time and exit early if not due. (On AWS this becomes an
  EventBridge Scheduler rule with identical logic.)
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
| Lever | `api.lever.co/v0/postings/{slug}?mode=json` | `createdAt` (epoch ms) | Large uncompressed payloads. Optional `salaryRange`. |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | `publishedAt` | Structured compensation. |
| SimplifyJobs | `raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json` | `date_posted` (epoch s, day-granular) | ~12 MB / ~2 MB gzip, ~19k listings, updated ~every 30 min; 304 on unchanged ETag. Fields: `id, company_name, title, url, locations[], category, active, is_visible, date_posted, date_updated, sponsorship, degrees, source, company_url`. Categories are inconsistent ("Software", "Software Engineering"). |

### Adapter interface

```ts
type SourceId = "greenhouse" | "lever" | "ashby" | "simplify";

interface SourceAdapter {
  id: SourceId;
  scope: "company" | "global";
  concurrency: number;                                   // ATS: 3, simplify: 1
  fetch(ctx: FetchCtx): Promise<FetchResult>;           // ctx: { slug?, etag?, signal, http }
  parseUrl?(url: string): { slug: string; sourceJobId: string } | null;
  probe?(slug: string, ctx: ProbeCtx): Promise<boolean>; // for `discover`
}

type FetchResult =
  | { status: "not_modified"; etag: string }
  | { status: "ok"; etag?: string; jobs: SourceJob[] };

// SourceJob: source, sourceJobId, companyName, companySlug?, title, locations[],
//            remote?, url, postedAt?, salary?, meta?
```

Shared HTTP helper: 15s timeout, 1 retry with jitter on network/5xx/429 (no retry
on 4xx), `If-None-Match`, `User-Agent: jobvr (personal job alerts)`, 50 MB cap.

## Data Model (Postgres, Drizzle)

| Table | Columns |
|---|---|
| `settings` | single row: `data` JSONB (Zod `Settings`), `last_visit_at`, `last_poll_at`, `last_push_at` |
| `companies` | id, name, city, state, tier (S/A/Mid/Startup/Corporate), track, ats (greenhouse/lever/ashby/other), slug, careers_url, notes, status (ok/needs_review/manual_only) |
| `source_state` | (source, company_id nullable) → etag, last_success_at, last_attempt_at, consecutive_failures, last_error, baselined_at |
| `jobs` | id (canonical key), company_id?, company_name, title, locations text[], url, primary_source, posted_at?, first_seen_at, effective_at, salary_min/max?, state (new/saved/hidden/applied), baseline, notified_at? |
| `job_sources` | (job_id, source) → source_job_id, url, posted_at |
| `applications` | id, job_id? (FK on delete set null), company/title/url snapshot, status (applied/oa/interview/offer/rejected), applied_at, notes |
| `suggestions` | normalized_name PK, display_name, ats, slug, listing_count, sample_titles, last_seen_at, state (open/dismissed/added) |

Canonical job IDs: `gh:<slug>:<id>`, `lv:<slug>:<uuid>`, `ab:<slug>:<uuid>`,
`sj:<uuid>` (only when the Simplify URL isn't a supported ATS URL).

Indexes: `jobs(effective_at desc)`, partial `jobs(notified_at) where notified_at is null`,
`jobs(company_id, title)`.

Retention: daily cleanup deletes jobs older than 30 days unless saved/applied.

## Pipeline Rules

### Poll (`runPoll`)

1. Advisory lock; load settings, companies, source_state, last 7 days of jobs.
2. Fetch each enabled source within its concurrency limit. One company failing
   never stops others. Polled companies: `track = true` AND tier in tracked tiers
   AND status ≠ `manual_only`.
3. Normalize; compute canonical ID (Simplify jobs with ATS URLs use the ATS key via `parseUrl`).
4. Poll-time filter: location match + title exclude for all; title include for ATS
   jobs only; Simplify: `active && is_visible` + software category. Skip jobs
   with effective age > 7 days.
5. Dedupe against in-memory set: canonical key / normalized URL first, then same
   company + title token Jaccard ≥ 0.85. Merge into `job_sources`; ATS fields win;
   job ID never changes.
6. Baseline: if the company/source has no `baselined_at`, save new jobs with
   `baseline = true` (shown in feed, never pushed, not counted as "new"), then set it.
7. Suggestions: Simplify companies not in `companies` (and not dismissed/added)
   → upsert with ATS detected from the apply URL (greenhouse.io / lever.co /
   ashbyhq.com → supported; else `other` → added as manual_only).
8. Health: success resets failures; failure increments + stores error; 3
   consecutive failures → company `needs_review`.

If > 50% of a response's items fail Zod validation, the fetch counts as a failure
(likely schema change). Individual invalid items are logged and skipped.

### Freshness

`first_seen_at` = first time the job ID is seen. `effective_at` = earlier of
`first_seen_at` and the source's posted date. Max job age governs pushes and
"new" counts; the poller stores matching jobs up to 7 days old so the feed's
3-day filter works.

### Notify (`runNotify`)

Due when `now − last_push_at ≥ pushEvery` and not in quiet hours
(America/New_York). Select jobs: unnotified, not baseline, not hidden, effective
age ≤ max age, passing current settings (tier, salary, location, sources, show
Simplify). If any → one ntfy push ("N new jobs", click URL → feed `?new=1`) →
set `notified_at` + `last_push_at`. No jobs → no push. Held jobs roll into the
next push; jobs that age out while held are dropped. ntfy failure → nothing
marked, retried next tick.

## Settings (DB, all editable in UI)

| Setting | Default |
|---|---|
| Locations (label + aliases) | NJ, PA, NYC, Remote-US (seeded aliases, e.g. NJ → new jersey, ", nj", jersey city, hoboken, newark, princeton; Remote-US → remote + us/usa/united states/no country) |
| Tiers to track | Mid, Startup, Corporate (S, A off) |
| Title must include (any) | new grad, entry, junior, early career, associate, graduate, software engineer i |
| Title must exclude | senior, sr., staff, principal, lead, manager, director, iii |
| Apply title-include to Simplify | Off |
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
| `GET /api/jobs?age=1h\|24h\|72h&location=&company=&tier=&source=&state=` | Feed, newest `effective_at` first; includes `newSinceLastVisit` |
| `POST /api/jobs/visit` | Set `last_visit_at` |
| `PATCH /api/jobs/:id` | `{ state: saved \| hidden \| new }` |
| `POST /api/jobs/:id/apply` | Create application + set job `applied` (one transaction) |
| `GET/POST /api/applications`, `PATCH/DELETE /api/applications/:id` | Tracker |
| `GET/POST /api/companies`, `PATCH/DELETE /api/companies/:id` | Companies + joined health; status → ok resets failures |
| `GET /api/suggestions`, `POST /api/suggestions/:id/add`, `POST /api/suggestions/:id/dismiss` | Add creates company with `track = false` |
| `GET /api/settings`, `PATCH /api/settings` | Partial update; includes last poll/push times |
| `GET /health` | Uptime + last poll age |

## Web

Pages (built with the frontend-design skill): **Feed** (newest first, "X new since
last visit", filters: age/location/company/tier/source; Applied/Save/Hide; "via
SimplifyJobs" label), **Applications** (board by status), **Companies** (tier,
Track toggle, ATS, slug, status, health), **Suggested** (Add/Dismiss),
**Settings**. PWA installable on phone.

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
| Simplify title rule | Exclude list only (include list off) | Simplify is already new-grad; titles often plain "Software Engineer" |
| Locations | Named locations with editable aliases | Sources format locations inconsistently |
| Suggestions | Add + Dismiss; never auto-track | User control |
| Dedupe | Canonical ATS key / URL, then company + title Jaccard ≥ 0.85 | ATS data wins; keep both sources |
| Email digest | Not built in MVP | No SES/SMTP needed yet |

## Edge Cases & Constraints

- Simplify file changes ~every 30 min, so most polls download ~2 MB gzip; parse in-process (~12 MB JSON).
- Simplify `date_posted` is day-granular (midnight UTC); effective age uses min with `first_seen_at`.
- Simplify listings' apply URLs often point to Greenhouse/Lever/Ashby → canonicalize so they merge with direct ATS jobs.
- Greenhouse `updated_at` is not a posted date; use `first_published`.
- Quiet hours wrap midnight and must handle DST (America/New_York).
- PC sleep / Windows Update reboots cause missed ticks; harmless, next tick catches up. `/health` and company health expose staleness.
- Overlapping polls prevented by advisory lock.
- Polite polling: per-source concurrency, ETags, timeouts, retry limits.

## Testing

Vitest. Adapter tests from saved fixture responses (incl. 304, 404, malformed
items, `parseUrl`). Unit tests for filters, location matcher, freshness, dedupe,
baseline, quiet hours, notifier selection. Repository + API integration tests
against Testcontainers Postgres and Hono `testClient`.

## Build Order

1. Monorepo scaffold from templates (api, web, core, poller), root tooling, compose with Postgres.
2. core: schemas, Drizzle schema/migrations, repositories, settings defaults.
3. Adapter interface + Greenhouse, Lever, Ashby adapters with fixture tests.
4. Filters, freshness, dedupe, baseline (tests).
5. SimplifyJobs adapter + cross-source dedupe + suggestions.
6. API routes: jobs, applications, companies, suggestions, settings.
7. Web (frontend-design skill): Feed → Applications → Companies → Suggested → Settings.
8. Notifier + quiet hours + scheduler tick.
9. `discover` script; run on research list; seed (see `docs/SEED.md`).
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
