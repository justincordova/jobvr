#!/usr/bin/env bash
# Nightly pg_dump at 03:00 America/New_York (TZ is set by compose); keeps the newest $KEEP.
# `--once` takes one backup now and exits: docker compose run --rm backup --once
set -euo pipefail

backup() {
  local file
  file="/backups/jobvr-$(date +%F-%H%M).dump"
  if pg_dump -h postgres -U jobvr -d jobvr -Fc -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup written: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "backup failed" >&2
    return 1
  fi
  ls -1t /backups/jobvr-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
}

if [ "${1:-}" = "--once" ]; then
  backup
  exit
fi

while true; do
  now=$(date +%s)
  next=$(date -d '03:00' +%s)
  if [ "$next" -le "$now" ]; then next=$(date -d 'tomorrow 03:00' +%s); fi
  sleep $((next - now))
  # A failed night is logged and retried the next night, not fatal
  backup || true
done
