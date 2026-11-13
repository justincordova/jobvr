# jobvr

A personal job radar for new-grad software roles. It polls Greenhouse, Lever,
and Ashby boards for the companies you track plus the SimplifyJobs New-Grad
list, filters and de-duplicates the results, shows them in a web feed, and sends
one bundled phone push per interval through ntfy.

It runs 24/7 in Docker on a home PC and is reachable only over Tailscale.

- Design and behavior: [`docs/SPEC.md`](docs/SPEC.md)
- Seed companies and tiers: [`docs/SEED.md`](docs/SEED.md)

## Layout

```
core/     @jobvr/core    settings, Drizzle schema + migrations, repositories,
                         matching, freshness, dedupe, runPoll / runNotify / runCleanup
poller/   @jobvr/poller  source adapters (src/sources), seed data, scripts:
                         poll, notify, seed, discover
api/      @jobvr/api     Hono API + typed client, serves the built SPA, runs the scheduler
web/      @jobvr/web     React SPA (TanStack Router/Query, Tailwind, PWA)
deploy/                  Tailscale serve config, backup script
```

Dependencies point one way: `core` ← `poller` ← `api`. The web app only imports
the API's typed client (`@jobvr/api/client`).

## Requirements

- Node 26 (`nvm install 26 && nvm use`) and pnpm 12 (`npm i -g pnpm@12` or Corepack)
- Docker (Postgres for development; Testcontainers for tests)

## Develop on the Mac

```sh
pnpm install
cp .env.example .env          # defaults point at the dev database
pnpm db:up                    # Postgres 18 on 127.0.0.1:5432
pnpm seed                     # insert companies from poller/data/companies.json
pnpm poll                     # one forced poll (the first one is a silent baseline)
pnpm dev                      # API on :3000 (migrations run on start)
pnpm dev:web                  # web on :5173, proxying /api to :3000
```

The scheduler is off in development (`SCHEDULER_ENABLED=false`); use the
scripts instead:

| Command                        | What it does                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `pnpm poll`                    | Poll every target now (skips the due check)                                              |
| `pnpm notify -- --dry-run`     | List the jobs a push would include, without sending                                      |
| `pnpm notify`                  | Send the push now (skips the due check and quiet hours)                                  |
| `pnpm seed`                    | Insert-only seed from `poller/data/companies.json`; slugs are confirmed via each ATS API |
| `pnpm discover "Company Name"` | Try slug guesses against Greenhouse, Lever, and Ashby; prints hits, writes nothing       |

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm fix`
to apply Biome / Prettier fixes. Commits follow Conventional Commits (enforced
by commitlint).

## Deploy on the Windows PC

One-time setup:

1. Install Docker Desktop (WSL2 backend). Turn on "Start Docker Desktop when you
   sign in" and disable PC sleep (Settings > System > Power).
2. In the Tailscale admin console, enable MagicDNS and HTTPS certificates, then
   create an auth key (reusable is easiest; tag it if you use ACLs).
3. Install Tailscale on the Mac and phone, and the ntfy app on the phone.
4. Pick a long random ntfy topic (for example `openssl rand -hex 24`) and
   subscribe to it in the ntfy app.

Then on the PC:

```sh
git clone <repo> jobvr && cd jobvr
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD=<strong password>
#   TS_AUTHKEY=tskey-auth-...
#   NTFY_URL=https://ntfy.sh/<your-random-topic>
#   PUBLIC_URL=https://jobvr.<your-tailnet>.ts.net
#   BACKUP_DIR=C:/Users/<you>/OneDrive/jobvr-backups   (optional)
docker compose up -d --build
```

The app is now at `https://jobvr.<your-tailnet>.ts.net` from any tailnet device.
On the phone, open it in Safari or Chrome and choose "Add to Home Screen".
No ports are published on the PC, so nothing is reachable from the LAN.

Seed the PC database from the Mac through the tailnet (Postgres is forwarded on
port 5432 of the `jobvr` node):

```sh
DATABASE_URL=postgres://jobvr:<password>@jobvr.<your-tailnet>.ts.net:5432/jobvr pnpm seed
```

Update: `git pull && docker compose up -d --build`.

### Backups

The `backup` service writes `jobvr-YYYY-MM-DD.dump` at 03:00 Eastern and keeps
the newest 14. Restore with:

```sh
docker compose exec -T postgres pg_restore -U jobvr -d jobvr --clean --if-exists < backups/jobvr-2026-11-13.dump
```

## Add a company

From the Companies page: Add, then pick the tier, ATS, and the board slug
exactly as the ATS spells it (Lever is case-sensitive). Not sure of the slug?
Run `pnpm discover "Company Name"`. Companies on other ATSs (Workday, iCIMS)
can be stored as "Other (manual only)"; they're never polled.

Companies that show up on SimplifyJobs but aren't in your list appear under
Suggested, where Add creates them in one click.

The first successful poll of a new company (or after its ATS or slug changes)
is a silent baseline: its current jobs show in the feed but never push.

## Add a source adapter

1. Create `poller/src/sources/<name>.ts` exporting a `SourceAdapter` (see
   `core/src/sources/types.ts`). Map each listing to a `SourceJob`, validate items
   with `validateItems`, and implement `parseUrl` and `probe` if it's an ATS.
2. Register it in `poller/src/sources/index.ts`.
3. Add a fixture under `poller/src/sources/fixtures/` and tests next to the adapter.

Source ids, ATS options, the Enabled-sources setting, and canonical ID prefixes
all come from the registry, so no migration is needed.
