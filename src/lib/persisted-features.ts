/**
 * Persistence for the platform features, against the real web store.
 *
 * - Run checkpoints are written to `store.settings` (`checkpoint:<runId>`)
 *   on every mutation and restored on read, so a restart resumes mid-run.
 * - Registry screening reads the real organization register (`listOrganizations`)
 *   instead of a hand-kept snapshot.
 *
 * Server-only: imports the filesystem-backed store.
 */
import { getSetting, listOrganizations, listSettingKeys, setSetting } from "@/lib/db";
import {
  getCheckpoint, markStepDone, restoreCheckpoint, resumeStep, startRun,
  type RunCheckpoint,
} from "@/lib/run-checkpoint";
import { checkRegistry, type RegistryCheck } from "@/lib/connectors";

const CP_PREFIX = "checkpoint:";

function saveCheckpoint(runId: string): void {
  const cp = getCheckpoint(runId);
  if (cp) setSetting(`${CP_PREFIX}${runId}`, JSON.stringify(cp));
}

function loadCheckpoint(runId: string): RunCheckpoint | null {
  const inMemory = getCheckpoint(runId);
  if (inMemory) return inMemory;
  const raw = getSetting(`${CP_PREFIX}${runId}`);
  if (!raw) return null;
  try {
    const cp = JSON.parse(raw) as RunCheckpoint;
    return restoreCheckpoint(cp) ? getCheckpoint(runId) : null;
  } catch { return null; }
}

export function startPersistedRun(runId: string, steps: string[]): RunCheckpoint {
  const cp = startRun(runId, steps);
  saveCheckpoint(runId);
  return cp;
}

export function markPersistedStepDone(runId: string, step: string): boolean {
  loadCheckpoint(runId);
  const ok = markStepDone(runId, step);
  if (ok) saveCheckpoint(runId);
  return ok;
}

export function resumePersistedStep(runId: string): string | null {
  loadCheckpoint(runId);
  return resumeStep(runId);
}

export function persistedCheckpointCount(): number {
  return listSettingKeys(CP_PREFIX).length;
}

/** Screen a supplier against the live organization register in the store. */
export function checkSupplierInStore(supplierName: string): RegistryCheck {
  const records = listOrganizations().map((o) => ({
    name: o.name,
    status: (o.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE") as "ACTIVE" | "SUSPENDED",
    owners: o.contactName ? [o.contactName] : [],
  }));
  return checkRegistry(supplierName, records);
}

