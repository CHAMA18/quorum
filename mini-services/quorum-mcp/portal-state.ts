/**
 * quorum-mcp — portal enable/disable state.
 *
 * Every portal on the Connected portals card can be switched off by the
 * committee. A portal that is off is not silently dropped: its row says who
 * turned it off and when, the bulk connection pass skips it, and every
 * transition is written to the audit log. The state is a small JSON file in
 * data/ — atomic writes, unknown ids filtered, absence means enabled.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getOcpDatasets } from "./ocp-live";

export interface PortalOverride {
  /** The portal's current state. Absent from the map means enabled. */
  enabled: boolean;
  /** ISO instant of the last transition. */
  at: string;
  /** Who made the last transition (actor name, capped at write time). */
  by: string;
}

export interface PortalStateFile {
  updatedAt: string;
  overrides: Record<string, PortalOverride>;
}

const DATA_DIR = fileURLToPath(new URL("./data/", import.meta.url));
const STATE_FILE = DATA_DIR + "portal-state.json";

function knownIds(): Set<string> {
  return new Set(getOcpDatasets().map((d) => String(d.publicationId)));
}

export function loadPortalState(path: string = STATE_FILE): PortalStateFile {
  const known = knownIds();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PortalStateFile>;
    if (raw && typeof raw === "object" && raw.overrides && typeof raw.overrides === "object") {
      const overrides: Record<string, PortalOverride> = {};
      for (const [key, value] of Object.entries(raw.overrides)) {
        if (known.has(key) && value && typeof value === "object" && typeof (value as PortalOverride).enabled === "boolean") {
          overrides[key] = {
            enabled: Boolean((value as PortalOverride).enabled),
            at: typeof (value as PortalOverride).at === "string" ? (value as PortalOverride).at : "",
            by: typeof (value as PortalOverride).by === "string" ? (value as PortalOverride).by : "unknown",
          };
        }
      }
      return { updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "", overrides };
    }
  } catch {
    /* no overrides recorded yet — every portal is enabled */
  }
  return { updatedAt: "", overrides: {} };
}

export function savePortalState(file: PortalStateFile, path: string = STATE_FILE): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(file, null, 2));
    renameSync(tmp, path);
  } catch {
    /* the toggle must never take the service down */
  }
}

/** Apply one enable/disable transition for the named portals and persist it. */
export function setPortalsEnabled(ids: number[], enabled: boolean, by: string, path: string = STATE_FILE): PortalStateFile {
  const file = loadPortalState(path);
  const now = new Date().toISOString();
  for (const id of ids) {
    file.overrides[String(id)] = { enabled, at: now, by: by.slice(0, 80) || "unknown" };
  }
  file.updatedAt = now;
  savePortalState(file, path);
  return file;
}

/** The publication ids currently switched off. */
export function disabledPortalIds(file: PortalStateFile = loadPortalState()): Set<number> {
  const out = new Set<number>();
  const known = knownIds();
  for (const [key, value] of Object.entries(file.overrides)) {
    if (!value.enabled && known.has(key)) out.add(Number(key));
  }
  return out;
}

/** The publication ids currently in use — the ones a bulk pass may probe. */
export function enabledPortalIds(file: PortalStateFile = loadPortalState()): number[] {
  const disabled = disabledPortalIds(file);
  return getOcpDatasets().filter((d) => !disabled.has(d.publicationId)).map((d) => d.publicationId);
}
