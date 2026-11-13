#!/usr/bin/env bash
# Nightly pg_dump at 03:00 America/New_York (TZ is set by compose); keeps the newest $KEEP.
set -euo pipefail

while true; do
  now=$(date +%s)
  next=$(date -d '03:00' +%s)
  if [ "$next" -le "$now" ]; then next=$(date -d 'tomorrow 03:00' +%s); fi
  sleep $((next - now))

  file="/backups/jobvr-$(date +%F).dump"
  if pg_dump -h postgres -U jobvr -d jobvr -Fc -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup written: $file"
  else
    rm -f "$file.tmp"
    echo "backup failed" >&2
  fi
  ls -1t /backups/jobvr-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
done
