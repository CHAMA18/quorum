/**
 * Run checkpoints: resume a recovered review from its last finished step
 * instead of replaying the whole graph from the beginning.
 *
 * In-memory here (the store layer can persist the same shape); the contract
 * is that a step is only marked done after its output exists, and resume
 * returns the first not-done step. Marking an unknown or out-of-order step
 * is refused so a checkpoint can never claim work that did not run in order.
 */

export interface RunCheckpoint { runId: string; steps: string[]; done: string[]; updatedAt: string }

const store = new Map<string, RunCheckpoint>();

export function startRun(runId: string, steps: string[]): RunCheckpoint {
  const cp: RunCheckpoint = { runId, steps: [...steps], done: [], updatedAt: new Date().toISOString() };
  store.set(runId, cp);
  return cp;
}

export function markStepDone(runId: string, step: string): boolean {
  const cp = store.get(runId);
  if (!cp) return false;
  const next = cp.steps[cp.done.length];
  if (next !== step) return false;
  cp.done.push(step);
  cp.updatedAt = new Date().toISOString();
  return true;
}

/** First unfinished step, or null when the run is complete/unknown. */
export function resumeStep(runId: string): string | null {
  const cp = store.get(runId);
  if (!cp) return null;
  return cp.steps[cp.done.length] ?? null;
}

export function getCheckpoint(runId: string): RunCheckpoint | null {
  return store.get(runId) ?? null;
}

/** Restore a persisted checkpoint. Refuses a done-list that is not an ordered prefix of steps. */
export function restoreCheckpoint(cp: RunCheckpoint): boolean {
  if (!cp || !Array.isArray(cp.steps) || !Array.isArray(cp.done)) return false;
  if (cp.done.some((s, i) => cp.steps[i] !== s)) return false;
  store.set(cp.runId, { runId: cp.runId, steps: [...cp.steps], done: [...cp.done], updatedAt: cp.updatedAt });
  return true;
}

export function listCheckpointIds(): string[] {
  return [...store.keys()];
}
