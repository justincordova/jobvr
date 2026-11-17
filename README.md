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

- Node 26 (`nvm install 26 && nvm use`) and pnpm 12 (`npm i -g pnpm@12`; Node 26
  no longer bundles Corepack, so for that route `npm i -g corepack && corepack enable`)
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

| Command                        | What it does                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm poll`                    | Poll every target now (skips the due check)                                                                                                               |
| `pnpm notify -- --dry-run`     | List the jobs a push would include, without sending                                                                                                       |
| `pnpm notify`                  | Send the push now (skips the due check and quiet hours)                                                                                                   |
| `pnpm seed`                    | Insert-only seed from `poller/data/companies.json` (also moves manual-only companies to a board the seed now names); slugs are confirmed via each ATS API |
| `pnpm match-report`            | Fetch every board now and show which listings pass the matching rules and why the rest are rejected (writes nothing)                                      |
| `pnpm discover "Company Name"` | Try slug guesses against Greenhouse, Lever, and Ashby; prints hits, writes nothing                                                                        |

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
#   POSTGRES_PASSWORD=<openssl rand -hex 32>   (letters and digits only)
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

Scripts only apply migrations to a local database. Against the PC they first
check its schema matches your checkout and stop if not ("deploy first"), so
an undeployed migration never reaches production from the Mac.

Update: `git pull && docker compose up -d --build`.

The database password is read only when the `pgdata` volume is first created.
Use letters and digits only: compose puts it into `DATABASE_URL` unescaped, and
`/ # % $ @` break it. To change it later, change it in Postgres first, then in
`.env`:

```sh
docker compose exec postgres psql -U jobvr -d jobvr -c "ALTER USER jobvr PASSWORD '<new hex password>'"
# set POSTGRES_PASSWORD=<new hex password> in .env, then:
docker compose up -d
```

### Keep it running unattended

- **Windows Update reboots**: Docker Desktop only starts once you sign in, so
  after an overnight reboot nothing runs until you log in. Use Sysinternals
  [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)
  (it stores the password encrypted) so the PC signs in by itself, and set
  Windows Update "active hours" around when you use the PC.
- **Tailscale key expiry**: node keys expire after about 180 days, and then the
  app drops off the tailnet. In the admin console, open Machines → `jobvr` →
  "Disable key expiry", or use a tagged auth key (tagged nodes don't expire;
  see the ACL below).

### Check health

- `docker compose ps`: the app shows `healthy` or `unhealthy`. Unhealthy means
  the database is unreachable, or no poll has run for 3 poll intervals (30 min).
- `curl -s https://jobvr.<your-tailnet>.ts.net/health` gives the same answer
  with `lastPollAt`.
- In the app, Settings shows the last poll, push and backup; Companies shows
  boards that need review.

### Roll back an update

```sh
docker compose run --rm backup --once   # before updating, if you can
git log --oneline -10                   # pick the last good commit
git checkout <commit> && docker compose up -d --build
```

If the update added a migration (a new file in `core/drizzle/`) and the older
version misbehaves on the newer schema, restore the dump taken before the
update (below). Go back to the latest with
`git checkout main && docker compose up -d --build`.

### Rotate secrets

- **ntfy topic** (if it leaked): pick a new one (`openssl rand -hex 24`),
  subscribe to it in the ntfy app, set `NTFY_URL` in `.env`, run
  `docker compose up -d`, then unsubscribe from the old topic.
- **Tailscale auth key**: only used the first time the node logs in (its state
  lives in the `tsstate` volume). Revoke it in the admin console once `jobvr`
  is up.
- **Database password**: see the steps under Update above.

### Limit Postgres to the Mac

Port 5432 is forwarded to the tailnet so the Mac can seed, and Postgres trusts
the `jobvr` superuser, so by default every device on your tailnet can reach it.
A Tailscale access policy can allow 443 to all your devices and 5432 only to
the Mac. Tag the node (create the auth key with `tag:jobvr`, which also turns
off key expiry). Then merge rules like these into the policy file in the admin
console. Merge, don't replace: replacing the default "allow all" removes access
to your other devices.

```json
{
  "tagOwners": { "tag:jobvr": ["autogroup:admin"] },
  "hosts": { "mac": "100.x.y.z" },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["tag:jobvr"], "ip": ["tcp:443"] },
    { "src": ["mac"], "dst": ["tag:jobvr"], "ip": ["tcp:5432"] }
  ]
}
```

`100.x.y.z` is the Mac's Tailscale address (`tailscale ip -4` on the Mac).

### Logs

The app logs one line per event, tagged with the part that wrote it
(`server`, `http`, `scheduler`, `poll`, `notify`, `cleanup`). On the PC
they're JSON; in development (`pnpm dev`) and the scripts they're plain text:

```
22:20:05.112 WARN  poll · Remedy (Greenhouse) failed (2 in a row): HTTP 404 for https://…
22:20:06.004 INFO  poll · poll finished in 4.3 s · 64 targets: 61 unchanged, 2 updated, 1 failed · +3 new, 9 refreshed, 1 closed
```

- `info`: something happened (a board had new or closed jobs, a push went
  out, a poll finished). `warn`: worth a look (a board failing, a company moved
  to needs review, the poll budget running out). `error`: a bug or an outage.
  `debug`: every board on every poll, and why a push didn't go out (not due,
  quiet hours, nothing new).
- `LOG_LEVEL` sets the level (default `info`; the `poll` and `notify` scripts
  default to `debug`). On the PC compose sets it from `PC_LOG_LEVEL` (default
  `info`), so the Mac's `debug` from `.env.example` doesn't carry over.
- Docker keeps at most 50 MB of logs per service (5 files of 10 MB), so the
  disk never fills; older lines roll off.
- Filter on the PC, for example the failures of the last day:
  `docker compose logs --since 24h app | jq -c 'select(.level == "warn" or .level == "error")'`,
  or one board: `... | jq -c 'select(.module == "poll" and (.msg | contains("Remedy")))'`.
- Secrets never appear: the ntfy topic URL isn't logged, and the database is
  shown as `host:port/name` only.

### Backups

The `backup` service writes `jobvr-YYYY-MM-DD-HHMM.dump` at 03:00 Eastern and
keeps the newest 14. If the PC was off at 03:00, it takes one as soon as it
starts. Each result is recorded in the database: Settings shows the last
backup, and a failed backup (or none for 26 hours) sends one push a day until
it's fixed. Updating `deploy/backup.sh` with `git pull` takes effect from the
next night without recreating the container.

Backups sit on the PC's own disk unless `BACKUP_DIR` points elsewhere. Set it
to a synced folder (OneDrive, Dropbox) so a dead disk doesn't take them too.

Take one now (before an update, say) with:

```sh
docker compose run --rm backup --once
```

Restore with the app stopped, so nothing writes mid-restore. A dump from an
older version is fine: the app applies any newer migrations when it starts.

```sh
docker compose stop app
# The dumps are in BACKUP_DIR (./backups unless .env sets it), e.g. C:/Users/<you>/OneDrive/jobvr-backups
docker compose exec -T postgres pg_restore -U jobvr -d jobvr --clean --if-exists < "<BACKUP_DIR>/jobvr-2026-11-13-0300.dump"
docker compose start app
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
