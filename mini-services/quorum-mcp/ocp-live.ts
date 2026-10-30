/**
 * quorum-mcp — the live OCP registry snapshot.
 *
 * The generator writes `data/ocp-registry.json` beside its TypeScript
 * snapshots. The sidecar reads that JSON (cached by mtime) so an automatic
 * refresh takes effect without a rebuild or restart. A missing or invalid
 * JSON file falls back to the compiled snapshots — a refresh failure never
 * takes the registry away.
 */

import { readFileSync, statSync } from "node:fs";
import { resolveDataDir } from "./paths";
import {
  OCP_AFRICA,
  OCP_AFRICA_SOURCE,
  type OcpAfricaDataset,
  type OcpAfricaSource,
} from "./ocp-africa";
import { OCP_GLOBAL, OCP_GLOBAL_SOURCE } from "./ocp-global";

export interface OcpSnapshotSection {
  source: OcpAfricaSource;
  datasets: OcpAfricaDataset[];
}

export interface OcpLiveSnapshot {
  generatedAt: string;
  retrieved: string;
  registryTotal: number;
  africa: OcpSnapshotSection;
  global: OcpSnapshotSection;
  all: OcpAfricaDataset[];
  /** True when the refreshable JSON was read; false for the compiled fallback. */
  fromRuntimeSnapshot: boolean;
}

const SNAPSHOT_FILE = resolveDataDir() + "ocp-registry.json";

const FALLBACK: OcpLiveSnapshot = {
  generatedAt: "",
  retrieved: OCP_AFRICA_SOURCE.retrieved,
  registryTotal: OCP_AFRICA.length + OCP_GLOBAL.length,
  africa: { source: OCP_AFRICA_SOURCE, datasets: OCP_AFRICA },
  global: { source: OCP_GLOBAL_SOURCE, datasets: OCP_GLOBAL },
  all: [...OCP_AFRICA, ...OCP_GLOBAL],
  fromRuntimeSnapshot: false,
};

let cached: { mtimeMs: number; size: number; value: OcpLiveSnapshot } | null = null;

function readSnapshot(): OcpLiveSnapshot | null {
  try {
    const stat = statSync(SNAPSHOT_FILE);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
    const raw = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as {
      generatedAt?: unknown;
      retrieved?: unknown;
      registryTotal?: unknown;
      africa?: { source?: unknown; datasets?: unknown };
      global?: { source?: unknown; datasets?: unknown };
    };
    const africa = raw.africa;
    const global = raw.global;
    if (
      !africa ||
      !global ||
      !Array.isArray(africa.datasets) ||
      !Array.isArray(global.datasets) ||
      africa.datasets.length === 0 ||
      global.datasets.length === 0 ||
      typeof (africa.source as OcpAfricaSource | undefined)?.retrieved !== "string" ||
      typeof (global.source as OcpAfricaSource | undefined)?.retrieved !== "string"
    ) {
      return null;
    }
    const value: OcpLiveSnapshot = {
      generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
      retrieved: (africa.source as OcpAfricaSource).retrieved,
      registryTotal:
        typeof raw.registryTotal === "number"
          ? raw.registryTotal
          : africa.datasets.length + global.datasets.length,
      africa: {
        source: africa.source as OcpAfricaSource,
        datasets: africa.datasets as OcpAfricaDataset[],
      },
      global: {
        source: global.source as OcpAfricaSource,
        datasets: global.datasets as OcpAfricaDataset[],
      },
      all: [...(africa.datasets as OcpAfricaDataset[]), ...(global.datasets as OcpAfricaDataset[])],
      fromRuntimeSnapshot: true,
    };
    cached = { mtimeMs: stat.mtimeMs, size: stat.size, value };
    return value;
  } catch {
    return null;
  }
}

/** The freshest registry the sidecar can read. */
export function loadOcpSnapshot(): OcpLiveSnapshot {
  return readSnapshot() ?? FALLBACK;
}

/** Every portal the committee may switch, connect or read. */
export function getOcpDatasets(): OcpAfricaDataset[] {
  return loadOcpSnapshot().all;
}

/** Forget the mtime cache after a refresh rewrites the JSON file. */
export function invalidateOcpSnapshot(): void {
  cached = null;
}
