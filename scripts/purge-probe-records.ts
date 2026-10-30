#!/usr/bin/env bun
/**
 * Move probe and test records out of the working record.
 *
 * A record that mixes "ZM-PROBE-104845" with real tenders undermines every
 * claim made from it. The rows are archived first, then removed from the
 * snapshot; the audit log and the decision ledger keep their lines, because a
 * purge is housekeeping — the acts that happened still happened.
 *
 *   bun scripts/purge-probe-records.ts            # report only
 *   bun scripts/purge-probe-records.ts --apply    # archive and remove
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { acquireWriterLock } from "../mini-services/quorum-mcp/writer";
import { allowIntentionalRemoval, auditHealth, DATA_DIR, loadState, saveState, state } from "../mini-services/quorum-mcp/store";

const PROBE = /PROBE|E2E-CYCLE|DEMO-PROBE/i;
const apply = process.argv.includes("--apply");

const writer = await acquireWriterLock(DATA_DIR + ".writer.lock");
if (!writer.ok) {
  console.error(`Stop the sidecar first — ${writer.reason}`);
  process.exit(78);
}

await loadState();

const probes = {
  gates: state.gates.filter((gate) => PROBE.test(gate.tenderId) || PROBE.test(gate.runId)),
  runs: state.runs.filter((run) => PROBE.test(run.tenderId) || PROBE.test(run.id)),
  cycle: state.cycle.filter((row) => PROBE.test(row.tenderId)),
  pipeline: state.pipeline.filter((row) => PROBE.test(row.ref) || PROBE.test(row.linkedTenderId ?? "")),
};

const counts = {
  gates: probes.gates.length,
  runs: probes.runs.length,
  cycle: probes.cycle.length,
  pipeline: probes.pipeline.length,
};

console.log(
  `Probe records: ${counts.gates} gate(s), ${counts.runs} run(s), ${counts.cycle} cycle row(s), ${counts.pipeline} pipeline row(s).`,
);

if (!Object.values(counts).some((count) => count > 0)) {
  console.log("Nothing to purge — the working record carries no probe rows.");
  process.exit(0);
}

if (!apply) {
  console.log("Report only. Re-run with --apply to archive these rows and remove them from the working record.");
  process.exit(0);
}

mkdirSync(DATA_DIR + "archive", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archivePath = `${DATA_DIR}archive/probe-records-${stamp}.json`;
writeFileSync(
  archivePath,
  JSON.stringify(
    {
      archivedAt: new Date().toISOString(),
      reason: "Probe and end-to-end test rows removed from the working record. Kept here as evidence of what was removed.",
      counts,
      ...probes,
    },
    null,
    2,
  ),
);

allowIntentionalRemoval(
  `Probe purge: ${counts.gates} gate(s), ${counts.runs} run(s), ${counts.cycle} cycle row(s) removed from the working record; archived at ${archivePath}.`,
);

const gateIds = new Set(probes.gates.map((gate) => gate.id));
const runIds = new Set(probes.runs.map((run) => run.id));

state.gates = state.gates.filter((gate) => !gateIds.has(gate.id));
state.runs = state.runs.filter((run) => !runIds.has(run.id));
state.cycle = state.cycle.filter((row) => !PROBE.test(row.tenderId));
state.pipeline = state.pipeline.filter((row) => !PROBE.test(row.ref) && !PROBE.test(row.linkedTenderId ?? ""));

saveState();
await new Promise((resolve) => setTimeout(resolve, 400));

console.log(`Archived to ${archivePath} and removed from the working record.`);
if (auditHealth.snapshotOverwriteRefused) {
  console.error("The snapshot write was refused by the overwrite guard — run this against a stopped, single writer.");
  process.exit(1);
}
console.log("The audit log and the decision ledger are untouched: the acts remain on the record.");
writer.release();
