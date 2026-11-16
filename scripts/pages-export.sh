#!/usr/bin/env bash
# GitHub Pages static export build.
#
# GitHub Pages serves files only — the server-side API handlers cannot exist
# in the Pages build, and force-dynamic routes (server-side session checks)
# have no runtime server to run on. This script moves them out of the tree,
# runs the static export (next.config.ts emits `output: "export"` under
# STATIC_EXPORT=1), then restores them so the working tree is left exactly
# as it was.
#
# Pages components already degrade gracefully: client fetches to the fallen
# routes simply resolve to their designed idle/empty states. Any route added
# with `export const dynamic = "force-dynamic"` (or an API handler) must be
# listed in SERVER_ROUTES, or `next build` fails the export.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER_ROUTES=(
  "src/app/api"
  "src/app/admin"
  "src/app/award"
  "src/app/org/dashboard"
  "src/app/reset"
)

STASH_DIR=".pages-stash$$"
mkdir -p "$STASH_DIR"

moved=()
cleanup() {
  # Restore any moved routes no matter how the build ends.
  for path in "${moved[@]:-}"; do
    [ -n "$path" ] || continue
    mkdir -p "$(dirname "$path")"
    rm -rf "$path"
    mv "$STASH_DIR/$path" "$path"
  done
  rm -rf "$STASH_DIR"
}
trap cleanup EXIT

for path in "${SERVER_ROUTES[@]}"; do
  [ -e "$path" ] || continue
  mkdir -p "$STASH_DIR/$(dirname "$path")"
  mv "$path" "$STASH_DIR/$path"
  moved+=("$path")
done

STATIC_EXPORT=1 bunx next build
