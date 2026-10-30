#!/usr/bin/env bash
# Restore the record from a backup and prove the restore.
#
# A backup nobody has restored is a hope, not a backup. This extracts into a
# staging directory first, checks the checksum, refuses to run while a writer
# holds the record, and verifies the audit chain after the copy.
#
#   ./scripts/restore-record.sh backups/quorum-record-20261029T140000Z.tar.gz --yes
set -euo pipefail

ARCHIVE="${1:-}"
CONFIRM="${2:-}"
DEST_DATA="${QUORUM_DATA_DIR:-mini-services/quorum-mcp/data/}"
LOCK="${DEST_DATA}.writer.lock"
STAGING="$(mktemp -d)"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Usage: $0 <backup file> --yes" >&2
  exit 2
fi
if [ "$CONFIRM" != "--yes" ]; then
  echo "This replaces the live record. Re-run with --yes once the service is stopped." >&2
  exit 2
fi
if [ -f "$LOCK" ]; then
  echo "A writer holds $LOCK — stop the quorum-mcp service before restoring." >&2
  exit 78
fi

if [ -f "$ARCHIVE.sha256" ]; then
  EXPECTED="$(awk '{print $1}' "$ARCHIVE.sha256")"
  if command -v shasum >/dev/null 2>&1; then ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')";
  else ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"; fi
  [ "$EXPECTED" = "$ACTUAL" ] || { echo "Checksum mismatch — refusing to restore a corrupt backup." >&2; rm -rf "$STAGING"; exit 1; }
  echo "Checksum ok."
fi

case "$ARCHIVE" in
  *.dump)
    pg_restore --clean --if-exists --dbname="${DATABASE_URL:?DATABASE_URL must be set for a database restore}" "$ARCHIVE" ;;
  *.tar.gz)
    tar -xzf "$ARCHIVE" -C "$STAGING"
    for file in "db/quorum-store.json" "${DEST_DATA}state.json" "${DEST_DATA}tool-log.jsonl" "${DEST_DATA}log-segments.jsonl" "${DEST_DATA}decisions.jsonl" "${DEST_DATA}log-anchors.jsonl"; do
      if [ -f "$STAGING/$file" ]; then
        mkdir -p "$(dirname "$file")"
        cp "$STAGING/$file" "$file"
        echo "restored $file"
      fi
    done ;;
  *)
    echo "Unknown archive type — expected .tar.gz or .dump." >&2
    rm -rf "$STAGING"
    exit 2 ;;
esac

rm -rf "$STAGING"

echo
echo "Verifying the restored record…"
bun scripts/repair-audit-register.ts --check || {
  echo "The restored chain does not verify. Keep the backup, do not start the service on it." >&2
  exit 1
}
echo "Restore complete and verified. Start quorum-mcp; the writer lock is taken at boot."
