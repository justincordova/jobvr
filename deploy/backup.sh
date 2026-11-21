#!/usr/bin/env bash
# Nightly pg_dump at 03:00 America/New_York (TZ is set by compose); keeps the newest $KEEP.
# `--once` takes one backup now and exits: docker compose run --rm backup --once
# Each result is recorded in the settings row; the app pushes an alert when a
# backup failed or none succeeded for 26 h.
set -euo pipefail

SELF=/scripts/backup.sh

# Best effort: before the app's first start the columns don't exist yet
record() {
  psql -h postgres -U jobvr -d jobvr -X -q -v ON_ERROR_STOP=1 -v msg="$1" >/dev/null <<'SQL' ||
UPDATE settings SET
  last_backup_at = CASE WHEN :'msg' = '' THEN now() ELSE last_backup_at END,
  backup_error = NULLIF(:'msg', ''),
  backup_error_at = CASE WHEN :'msg' = '' THEN backup_error_at ELSE now() END
WHERE id = 1;
SQL
    echo "could not record the result in the database" >&2
}

backup() {
  local file err
  file="/backups/jobvr-$(date +%F-%H%M).dump"
  if err=$(pg_dump -h postgres -U jobvr -d jobvr -Fc -f "$file.tmp" 2>&1); then
    mv "$file.tmp" "$file"
    echo "backup written: $file ($(du -h "$file" | cut -f1))"
    record ""
  else
    rm -f "$file.tmp"
    echo "backup failed: $err" >&2
    record "${err:-pg_dump failed}"
    return 1
  fi
  # shellcheck disable=SC2012 # our own dump names: no spaces or newlines
  ls -1t /backups/jobvr-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
}

if [ "${1:-}" = "--once" ]; then
  backup
  exit
fi

# A dump cut off by a restart leaves its .tmp behind; KEEP pruning never matches those
rm -f /backups/jobvr-*.dump.tmp

# PC off or asleep at 03:00: make up for it now rather than waiting another day
if [ -z "$(find /backups -maxdepth 1 -name 'jobvr-*.dump' -mmin -1500 2>/dev/null | head -1)" ]; then
  echo "no backup in the last 25 h; taking one now"
  backup || true
fi

next=$(date -d '03:00' +%s)
if [ "$next" -le "$(date +%s)" ]; then next=$(date -d 'tomorrow 03:00' +%s); fi
# Short naps against the wall clock: a single long sleep stops counting while the
# PC sleeps or hibernates, so 03:00 would slip by the time it was asleep
while [ "$(date +%s)" -lt "$next" ]; do sleep 300; done
# Fresh copies of the script (deploy/ is mounted as a folder), so a `git pull`
# reaches the backup service without recreating it. A failed night is
# logged, recorded and retried the next night, not fatal.
bash "$SELF" --once || true
exec bash "$SELF"
