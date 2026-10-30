import { NextResponse } from "next/server";

/**
 * The public window onto the desk.
 *
 * The landing page used to read `/api/runs` and `/api/log` anonymously, which
 * also exposed bidder names, bid values and supplier contacts to anyone with
 * the URL. This route is the only anonymous view of the sidecar now, and it
 * returns aggregates and tool names: counts, a redacted sample, and the last
 * few activity lines without actor, inputs or outputs.
 */

const SIDECAR = (process.env.QUORUM_SIDECAR_URL?.trim() || "http://127.0.0.1:3031").replace(/\/+$/, "");

interface SidecarRun {
  tenderId?: string;
  status?: string;
  findings?: unknown[];
  drafts?: unknown[];
  updatedAt?: string;
}

interface SidecarGate {
  status?: string;
}

interface SidecarEntry {
  id?: string;
  seq?: number;
  tool?: string;
  status?: string;
  ts?: string;
}

async function read<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SIDECAR}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const [runsBody, gatesBody, logBody, filingsBody, enrolledBody] = await Promise.all([
    read<{ runs?: SidecarRun[] }>("/api/runs"),
    read<{ gates?: SidecarGate[] }>("/api/gates"),
    read<{ entries?: SidecarEntry[] }>("/api/log?limit=80"),
    read<{ entries?: SidecarEntry[] }>("/api/log?tool=supplier_application&limit=8"),
    read<{ entries?: SidecarEntry[] }>("/api/log?tool=supplier_add&limit=8"),
  ]);

  const runs = runsBody?.runs ?? [];
  const gates = gatesBody?.gates ?? [];
  const entries = logBody?.entries ?? [];
  /* The supplier door shows that filings arrive and are refused, not who
     filed them or what they bid: tool name, outcome and time only. */
  const supplierActivity = [...(filingsBody?.entries ?? []), ...(enrolledBody?.entries ?? [])]
    .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""))
    .slice(0, 8)
    .map((entry) => ({ tool: entry.tool, status: entry.status, ts: entry.ts }));

  return NextResponse.json(
    {
      counts: {
        runs: runs.length,
        tenders: new Set(runs.map((run) => run.tenderId).filter(Boolean)).size,
        findings: runs.reduce((total, run) => total + (run.findings?.length ?? 0), 0),
        drafts: runs.reduce((total, run) => total + (run.drafts?.length ?? 0), 0),
        pendingGates: gates.filter((gate) => gate.status === "PENDING").length,
        executedGates: gates.filter((gate) => gate.status === "EXECUTED").length,
      },
      /* Tool names and outcomes only — no actor, no inputs, no outputs. */
      activity: entries.slice(0, 8).map((entry) => ({
        id: entry.id,
        seq: entry.seq,
        tool: entry.tool,
        status: entry.status,
        ts: entry.ts,
      })),
      supplierActivity,
      /* A redacted sample run: which tender, how it ended, how much it produced. */
      sample: runs[0]
        ? {
            tenderId: runs[0].tenderId,
            status: runs[0].status,
            findings: runs[0].findings?.length ?? 0,
            drafts: runs[0].drafts?.length ?? 0,
            updatedAt: runs[0].updatedAt,
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
