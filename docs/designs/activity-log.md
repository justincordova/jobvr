# Activity log in the web app

## Problem

On the PC the app's logs are JSON in `docker compose logs`: hard to read, and
only on the PC. From the Mac or the phone there's no way to see what the
poller did beyond Settings' "last poll / last push".

## Design

- **Capture**: the root pino logger writes to two streams (`pino.multistream`):
  stdout as before (JSON in production, pino-pretty in development) and an
  in-memory ring buffer (`api/src/lib/activity-log.ts`). stdout output is
  unchanged.
- **What's kept**: info and above (so the per-request GET lines, logged at
  debug, never land in it), the last 1000 entries, since the process started.
  Each entry is `{ seq, time, level, module, msg, error }`: the message and the
  error's message only. No request bodies, no stack traces, no other fields.
  Message and error are capped at 2000 characters.
- **Secrets**: every entry is scrubbed before it is stored: the exact `NTFY_URL`
  and its topic, the `DATABASE_URL` password, any `scheme://user:password@`
  credentials, `tskey-…` keys and `ntfy.sh/<topic>` paths become `[redacted]`.
- **API**: `GET /api/logs?after=<seq>&limit=<n>` returns entries with
  `seq > after` (oldest first, at most `limit`, default 500), plus `latestSeq`,
  `startedAt` (process start, so a restart resets the client's cursor) and
  `capacity`. Read-only; `Cache-Control: no-store`; not in the service worker's
  offline cache. Same boundary as the rest of the API: tailnet only, the API
  rate limit, the CORS allowlist (another site can't read it).
- **Web**: a Logs page at `/logs`, linked from Settings (not in the nav). It
  fetches new entries every 4 s while open and visible, newest first, with a
  level filter (All / Warnings / Errors), a text filter and Pause.

## Not doing

- Persisting logs (a restart starts over; `docker compose logs` keeps history).
- Server-sent events: the compression and request-timeout middleware would need
  exceptions, and polling every 4 s is live enough.
- Showing debug lines or extra fields: they'd make redaction harder to trust.
