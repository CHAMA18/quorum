/**
 * quorum-mcp — the data directory, resolved to survive rebuilds.
 *
 * The Next standalone build copies mini-services/quorum-mcp into
 * .next/standalone and the running sidecar's import.meta.url points at that
 * copy — which the NEXT build replaces wholesale. Any live state written
 * there (state.json, the tool log, submissions, eval reports) would reset on
 * every deploy, exactly like the web app's own store once did.
 *
 * So the data directory resolves to the REPO tree whenever it can be found:
 * walk up from this file (then from cwd) to the directory that holds the
 * real checkout — package.json, the src/ tree (or .git) and the sidecar's
 * own index.ts. QUORUM_DATA_DIR overrides everything; when no repo root can
 * be identified (e.g. a bare standalone deployment), fall back to the
 * script-relative location — the historical behaviour.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function walkUp(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    const looksLikeRepo =
      existsSync(path.join(dir, "package.json")) &&
      (existsSync(path.join(dir, "src")) || existsSync(path.join(dir, ".git"))) &&
      existsSync(path.join(dir, "mini-services", "quorum-mcp", "index.ts"));
    if (looksLikeRepo) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function resolveDataDir(): string {
  const env = process.env.QUORUM_DATA_DIR;
  if (env && env.trim()) {
    const trimmed = env.trim();
    return trimmed.endsWith("/") ? trimmed : trimmed + "/";
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = walkUp(here) ?? walkUp(process.cwd()) ?? here;
  return path.join(root, "mini-services", "quorum-mcp", "data") + "/";
}
