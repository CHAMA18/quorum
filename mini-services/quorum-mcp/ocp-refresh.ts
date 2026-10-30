/**
 * quorum-mcp — keep the OCP registry snapshot current.
 *
 * The generator (`mine-ocp-africa.py`) is the only thing that talks to the
 * registry. This module runs it on a schedule, stores the last outcome, and
 * lets the sidecar pick up the refreshed JSON without a restart. A failure
 * never removes the previous snapshot: the desk keeps reading the last good
 * record and the error is visible on the Data sources screen.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "./paths";
import { invalidateOcpSnapshot, loadOcpSnapshot } from "./ocp-live";
import { appendLog } from "./store";

const DATA_DIR = resolveDataDir();
const STATUS_FILE = path.join(DATA_DIR, "ocp-refresh.json");
const SNAPSHOT_FILE = path.join(DATA_DIR, "ocp-registry.json");
const MINER_REL = path.join("mini-services", "quorum-mcp", "mine-ocp-africa.py");
const HERE = path.dirname(fileURLToPath(import.meta.url));

function walkFor(rel: string): string | null {
  for (const start of [HERE, process.cwd()]) {
    let dir = path.resolve(start);
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(dir, rel);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const MINER = walkFor(MINER_REL);
const REPO_ROOT = MINER ? path.resolve(path.dirname(MINER), "../..") : process.cwd();
const REFRESH_DAYS = Math.max(1, Math.min(90, Number(process.env.OCP_REFRESH_DAYS) || 7));
const CHECK_MINUTES = Math.max(5, Math.min(1440, Number(process.env.OCP_REFRESH_CHECK_MINUTES) || 60));
const ENABLED = process.env.OCP_REFRESH_ENABLED !== "false";
const PYTHON = process.env.PYTHON || "python3";
const TIMEOUT_MS = 10 * 60_000;

interface RefreshFile {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastOutput: string | null;
  updatedAt: string | null;
}

export interface OcpRefreshStatus {
  enabled: boolean;
  running: boolean;
  intervalDays: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextDueAt: string | null;
  sourceRetrieved: string | null;
  generatedAt: string | null;
  fromRuntimeSnapshot: boolean;
}

export interface OcpRefreshResult {
  ok: boolean;
  skipped: boolean;
  error: string | null;
  status: OcpRefreshStatus;
}

let running = false;
let current: Promise<OcpRefreshResult> | null = null;

function readFileStatus(): RefreshFile {
  try {
    const raw = JSON.parse(readFileSync(STATUS_FILE, "utf8")) as Partial<RefreshFile>;
    return {
      lastAttemptAt: typeof raw.lastAttemptAt === "string" ? raw.lastAttemptAt : null,
      lastSuccessAt: typeof raw.lastSuccessAt === "string" ? raw.lastSuccessAt : null,
      lastError: typeof raw.lastError === "string" ? raw.lastError : null,
      lastOutput: typeof raw.lastOutput === "string" ? raw.lastOutput : null,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    };
  } catch {
    return { lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastOutput: null, updatedAt: null };
  }
}

function writeFileStatus(file: RefreshFile): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATUS_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify({ ...file, updatedAt: new Date().toISOString() }, null, 2) + "\n");
    renameSync(tmp, STATUS_FILE);
  } catch {
    /* a status write must never take the refresh down */
  }
}

function addDays(iso: string, days: number): string | null {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : Date.parse(iso);
  if (!Number.isFinite(base)) return null;
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

function nextDue(lastSuccessAt: string | null, sourceRetrieved: string | null): string | null {
  const base = lastSuccessAt || sourceRetrieved;
  return base ? addDays(base, REFRESH_DAYS) : new Date().toISOString();
}

export function ocpRefreshStatus(): OcpRefreshStatus {
  const file = readFileStatus();
  const snapshot = loadOcpSnapshot();
  return {
    enabled: ENABLED,
    running,
    intervalDays: REFRESH_DAYS,
    lastAttemptAt: file.lastAttemptAt,
    lastSuccessAt: file.lastSuccessAt,
    lastError: file.lastError,
    nextDueAt: nextDue(file.lastSuccessAt || snapshot.generatedAt || null, snapshot.retrieved),
    sourceRetrieved: snapshot.retrieved,
    generatedAt: snapshot.generatedAt || null,
    fromRuntimeSnapshot: snapshot.fromRuntimeSnapshot,
  };
}

function isDue(status: OcpRefreshStatus, now = Date.now()): boolean {
  if (!status.nextDueAt) return true;
  const due = Date.parse(status.nextDueAt);
  return !Number.isFinite(due) || now >= due;
}

function tail(value: string, cap = 4000): string {
  return value.length > cap ? value.slice(value.length - cap) : value;
}

async function runRefresh(force: boolean, actor: string): Promise<OcpRefreshResult> {
  const before = ocpRefreshStatus();
  if (!force && !isDue(before)) {
    return { ok: true, skipped: true, error: null, status: before };
  }
  if (!MINER) {
    const error = "the registry miner (mine-ocp-africa.py) could not be found";
    writeFileStatus({ ...readFileStatus(), lastError: error });
    return { ok: false, skipped: false, error, status: ocpRefreshStatus() };
  }

  running = true;
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  writeFileStatus({ ...readFileStatus(), lastAttemptAt: startedAt, lastError: null, lastOutput: null });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  try {
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(PYTHON, [MINER, "--json-out", SNAPSHOT_FILE], {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = tail(stdout + chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = tail(stderr + chunk.toString("utf8"));
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, TIMEOUT_MS);
      child.once("error", (err) => {
        stderr = tail(stderr + `\n${err.message}`);
        clearTimeout(timer);
        resolve(null);
      });
      child.once("close", (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });

    if (timedOut) throw new Error(`refresh timed out after ${Math.round(TIMEOUT_MS / 60_000)} minutes`);
    if (code !== 0) {
      const detail = stderr.trim().split("\n").filter(Boolean).slice(-2).join(" · ");
      throw new Error(detail || `miner exited with code ${code}`);
    }

    invalidateOcpSnapshot();
    const snapshot = loadOcpSnapshot();
    if (!snapshot.fromRuntimeSnapshot) {
      throw new Error("the miner finished but the refreshed JSON could not be read");
    }

    const lastSuccessAt = new Date().toISOString();
    writeFileStatus({
      ...readFileStatus(),
      lastAttemptAt: startedAt,
      lastSuccessAt,
      lastError: null,
      lastOutput: tail(`${stdout}\n${stderr}`),
    });
    appendLog({
      actor,
      server: "quorum-mcp",
      tool: "refresh_ocp_registry",
      kind: "WRITES",
      inputs: { force, miner: path.basename(MINER) },
      outputs: {
        ok: true,
        retrieved: snapshot.retrieved,
        africa: snapshot.africa.datasets.length,
        global: snapshot.global.datasets.length,
        registryTotal: snapshot.registryTotal,
      },
      status: "OK",
      durationMs: Date.now() - started,
    });
    running = false;
    return { ok: true, skipped: false, error: null, status: ocpRefreshStatus() };
  } catch (err) {
    const error = (err as Error)?.message?.slice(0, 400) || "the refresh failed";
    writeFileStatus({ ...readFileStatus(), lastAttemptAt: startedAt, lastError: error, lastOutput: tail(`${stdout}\n${stderr}`) });
    appendLog({
      actor,
      server: "quorum-mcp",
      tool: "refresh_ocp_registry",
      kind: "WRITES",
      inputs: { force, miner: path.basename(MINER) },
      outputs: { ok: false, error },
      status: "ERROR",
      durationMs: Date.now() - started,
    });
    running = false;
    return { ok: false, skipped: false, error, status: ocpRefreshStatus() };
  } finally {
    running = false;
  }
}

/** Force a refresh, or run it only when the snapshot is due. */
export function refreshOcpRegistry(options: { force?: boolean; actor?: string } = {}): Promise<OcpRefreshResult> {
  if (current) return current;
  current = runRefresh(options.force === true, options.actor?.trim() || "scheduler").finally(() => {
    current = null;
  });
  return current;
}

/**
 * Check at boot and then hourly. The miner itself is only invoked when the
 * snapshot is older than `OCP_REFRESH_DAYS` (7 by default). Disable the loop
 * with OCP_REFRESH_ENABLED=false; set OCP_REFRESH_DAYS to change the cadence.
 */
export function startOcpAutoRefresh(): void {
  if (!ENABLED) return;
  const tick = () => {
    if (running) return;
    const status = ocpRefreshStatus();
    if (isDue(status)) void refreshOcpRegistry({ force: false, actor: "scheduler" });
  };
  const boot = setTimeout(tick, 2500);
  const loop = setInterval(tick, CHECK_MINUTES * 60_000);
  boot.unref?.();
  loop.unref?.();
  console.log(
    `[ocp-refresh] automatic registry refresh on · every ${REFRESH_DAYS} day(s) · checked every ${CHECK_MINUTES} min · next ${ocpRefreshStatus().nextDueAt ?? "now"}`,
  );
}
