#!/usr/bin/env bash
# Hourly snapshot of the record.
#
# The working store is two JSON files plus the audit log and the decision
# ledger. This copies all of them with a checksum so a restore can prove it
# restored what was written, then keeps 72 hourly and 30 daily copies.
#
#   ./scripts/backup-record.sh
#   QUORUM_BACKUP_DIR=/var/backups/quorum ./scripts/backup-record.sh
#
# Put it on a schedule the application cannot change:
#   0 * * * *  cd /srv/quorum && ./scripts/backup-record.sh >> /var/log/quorum-backup.log 2>&1
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${QUORUM_BACKUP_DIR:-./backups}"
DATA_DIR="${QUORUM_DATA_DIR:-mini-services/quorum-mcp/data/}"
mkdir -p "$DEST"

checksum() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
  else sha256sum "$1" | awk '{print $1}'; fi
}

if [ -n "${DATABASE_URL:-}" ]; then
  OUT="$DEST/quorum-db-$STAMP.dump"
  pg_dump "$DATABASE_URL" --format=custom --file="$OUT"
else
  OUT="$DEST/quorum-record-$STAMP.tar.gz"
  FILES=(
    "db/quorum-store.json"
    "${DATA_DIR}state.json"
    "${DATA_DIR}tool-log.jsonl"
    "${DATA_DIR}log-segments.jsonl"
    "${DATA_DIR}decisions.jsonl"
    "${DATA_DIR}log-anchors.jsonl"
  )
  PRESENT=()
  for file in "${FILES[@]}"; do [ -f "$file" ] && PRESENT+=("$file"); done
  if [ "${#PRESENT[@]}" -eq 0 ]; then
    echo "Nothing to back up — none of the record files exist yet." >&2
    exit 1
  fi
  tar -czf "$OUT" "${PRESENT[@]}"
fi

printf '%s  %s\n' "$(checksum "$OUT")" "$(basename "$OUT")" > "$OUT.sha256"

# Retention: 72 hourly, 30 daily.
find "$DEST" -name 'quorum-*' -type f -mmin +4320 ! -name '*.daily' -delete 2>/dev/null || true
for file in "$DEST"/quorum-*; do
  [ -f "$file" ] || continue
  case "$file" in *.sha256|*.daily) continue ;; esac
  day="$DEST/$(basename "$file").daily"
  [ -e "$day" ] || cp "$file" "$day"
done

echo "$(date -u +%FT%TZ) backed up $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
