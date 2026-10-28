/**
 * Desk tools for the Muse assistant.
 *
 * Every tool is a READ — a GET against records that already exist on the
 * quorum-mcp sidecar (:3031). There is deliberately no tool here that can
 * sign, award, return, file, summon or register: the assistant answers
 * questions about the desk, and the gavel stays where the product puts it —
 * behind a named human at the Approvals gate.
 *
 * The definitions travel to the model; the executors stay on the server, so
 * the model never chooses a URL, never sees a session and can only ask for
 * reads this file has already written down.
 */

const SIDECAR = "http://127.0.0.1:3031";

export interface DeskTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/* ── Definitions (these go to the model) ─────────────────────────────────── */

export const DESK_TOOLS: DeskTool[] = [
  {
    name: "desk_snapshot",
    description:
      "One read of the whole desk: how many evaluations are running, queued, at the gate or decided; how many approvals are waiting for a human signature; the agent service's own health. Use this first for any 'what is happening' question.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_evaluations",
    description:
      "List the evaluations (review runs), newest first. Each carries the tender reference, status (running / queued / gate / complete), how many findings were raised and how many of those carry a citation.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many to return, newest first. Default 10, max 25." },
      },
      required: [],
    },
  },
  {
    name: "list_approvals",
    description:
      "List the approvals sitting at the human gate — files the agent finished and halted. Each shows its status (PENDING / APPROVED / REJECTED / EXECUTED), the gate tool it corresponds to, when it was filed and, once decided, who signed it and when. Pending items are the ones waiting on a named human.",
    parameters: {
      type: "integer",
      description: "How many to return. Default 15, max 40.",
    },
  },
  {
    name: "list_deadlines",
    description:
      "List every statutory clock the procurement cycles are running: submissions closing, abnormally-low-bid (ALB) responses due, standstill periods ending, contract milestones and complaint responses. Each carries the tender, the due instant and whether it is already overdue.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "committee_state",
    description:
      "Read the committee register: how many seats, how many members are present, the quorum the law requires before an award counts, the roster in roll-call order, and any sitting that is currently open.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_tender",
    description:
      "Look up one tender's live state by reference: its pipeline entry, its cycle record (opening, evaluation matrix, ALB, award report, standstill, contract, complaints), its evaluations and its gates. Use when the officer names a specific tender.",
    parameters: {
      type: "object",
      properties: {
        tenderId: { type: "string", description: "The tender reference, e.g. RW-RURA-2027-021." },
      },
      required: ["tenderId"],
    },
  },
];

/* ── Executors (these stay on the server) ────────────────────────────────── */

async function getJson(path: string, timeoutMs = 6000): Promise<Record<string, unknown>> {
  const res = await fetch(`${SIDECAR}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`sidecar ${res.status} on ${path}`);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/* The sidecar answers with its own shapes; the model sees a trimmed, stable
   projection of each rather than the raw payload. */
type Run = {
  id: string;
  tenderId: string;
  status: string;
  startedAt: string;
  findings?: { id: string; rule: string; item: string; citation: string }[];
  plan?: { pack?: { bids?: number } } | null;
};

type Gate = {
  id: string;
  tenderId: string;
  status: string;
  tool?: string;
  createdAt: string;
  decidedAt?: string;
  approver?: string;
};

type Health = {
  ok?: boolean;
  service?: string;
  version?: string;
  counts?: { toolCalls?: number; runs?: number; gates?: number; pendingGates?: number };
  graphs?: string[];
};

const RUN_STATUS_UI: Record<string, string> = {
  RUNNING: "running (agent still reading)",
  AWAITING_GATE: "at the gate (waiting on a named human)",
  REJECTED: "returned to the agent for clarification",
  FILED: "filed (award sealed and receipted)",
  FAILED: "failed",
};

const GATE_STATUS_UI: Record<string, string> = {
  PENDING: "PENDING — waiting on a named human",
  APPROVED: "APPROVED",
  REJECTED: "RETURNED",
  EXECUTED: "EXECUTED — sealed, filed, receipted",
};

function viewRun(r: Run) {
  const findings = r.findings ?? [];
  return {
    tender: r.tenderId,
    status: RUN_STATUS_UI[r.status] ?? r.status,
    startedAt: r.startedAt,
    bids: r.plan?.pack?.bids ?? null,
    findings: findings.length,
    citations: findings.filter((f) => f.citation).length,
    topFindings: findings.slice(0, 3).map((f) => ({ rule: f.rule, item: f.item, citation: f.citation })),
  };
}

function viewGate(g: Gate) {
  return {
    tender: g.tenderId,
    gate: g.tool ?? "file_gate_submission",
    status: GATE_STATUS_UI[g.status] ?? g.status,
    filedAt: g.createdAt,
    decidedAt: g.decidedAt ?? null,
    signedBy: g.approver ?? null,
  };
}

export async function runDeskTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "desk_snapshot": {
        const [runs, gates, health] = await Promise.all([
          getJson("/api/runs"),
          getJson("/api/gates"),
          getJson("/api/health", 3000).catch(() => null),
        ]);
        const list = (runs.runs ?? []) as Run[];
        const gateList = (gates.gates ?? []) as Gate[];
        const h = health as Health | null;
        return JSON.stringify({
          evaluations: {
            total: list.length,
            running: list.filter((r) => r.status === "RUNNING").length,
            atGate: list.filter((r) => r.status === "AWAITING_GATE").length,
            filed: list.filter((r) => r.status === "FILED").length,
            returned: list.filter((r) => r.status === "REJECTED").length,
            failed: list.filter((r) => r.status === "FAILED").length,
          },
          approvals: {
            total: gateList.length,
            pending: gateList.filter((g) => g.status === "PENDING").length,
            executed: gateList.filter((g) => g.status === "EXECUTED").length,
          },
          agent: h
            ? { online: !!h.ok, version: h.version ?? null, toolCallsLogged: h.counts?.toolCalls ?? null, graphs: h.graphs ?? [] }
            : { online: false },
        });
      }
      case "list_evaluations": {
        const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 25);
        const runs = await getJson("/api/runs");
        const list = ((runs.runs ?? []) as Run[]).slice(0, limit);
        return JSON.stringify({ count: list.length, evaluations: list.map(viewRun) });
      }
      case "list_approvals": {
        const limit = Math.min(Math.max(Number(args.limit ?? 15) || 15, 1), 40);
        const gates = await getJson("/api/gates");
        const list = ((gates.gates ?? []) as Gate[]).slice(0, limit);
        return JSON.stringify({ count: list.length, approvals: list.map(viewGate) });
      }
      case "list_deadlines": {
        const dl = await getJson("/api/cycle/deadlines");
        const items = (dl.deadlines ?? []) as {
          tenderId: string;
          kind: string;
          dueAt: string;
          ref?: string;
          overdue?: boolean;
        }[];
        return JSON.stringify({
          count: items.length,
          clocks: items.slice(0, 30).map((d) => ({
            tender: d.tenderId,
            kind: d.kind,
            dueAt: d.dueAt,
            about: d.ref ?? null,
            overdue: !!d.overdue,
          })),
        });
      }
      case "committee_state": {
        const cm = await getJson("/api/committee");
        return JSON.stringify({
          seats: cm.seats ?? null,
          required: cm.required ?? null,
          present: cm.present ?? null,
          quorumMet: typeof cm.present === "number" && typeof cm.required === "number" ? cm.present >= cm.required : null,
          members: ((cm.members ?? []) as { name: string; role: string; status: string; isChair?: boolean; office?: string }[])
            .slice(0, 20)
            .map((m) => ({ name: m.name, role: m.role, status: m.status, chair: !!m.isChair, office: m.office ?? null })),
          openSitting: cm.sitting ? { title: (cm.sitting as { title?: string }).title ?? null, status: (cm.sitting as { status?: string }).status ?? null } : null,
        });
      }
      case "find_tender": {
        const raw = String(args.tenderId ?? "").trim();
        if (!raw) return JSON.stringify({ error: "A tender reference is required." });
        const detail = await getJson(`/api/tenders/${encodeURIComponent(raw)}`);
        if (detail.error) return JSON.stringify({ error: String(detail.error) });
        const cycle = detail.cycle as Record<string, unknown> | undefined;
        const runs = (detail.runs ?? []) as { id: string; status: string; startedAt: string }[];
        const gates = (detail.gates ?? []) as { id: string; tool?: string; status: string }[];
        return JSON.stringify({
          tender: raw,
          pipeline: detail.pipeline ?? null,
          cycle: cycle
            ? {
                closingDate: cycle.closingDate ?? null,
                opening: cycle.opening ? { rows: (cycle.opening as { rows?: unknown[] }).rows?.length ?? 0, certifiedAt: (cycle.opening as { certifiedAt?: string }).certifiedAt ?? null } : null,
                matrix: cycle.matrix ? { status: (cycle.matrix as { status?: string }).status ?? null, bids: (cycle.matrix as { bids?: unknown[] }).bids?.length ?? 0 } : null,
                albOpen: ((cycle.alb ?? []) as { resolution?: unknown }[]).filter((a) => !a.resolution).length,
                awardReportSigned: !!(cycle.awardReport as { signedAt?: string } | undefined)?.signedAt,
                standstill: cycle.standstill ?? null,
                contract: cycle.contract ? { supplier: (cycle.contract as { supplier?: string }).supplier ?? null, value: (cycle.contract as { value?: number }).value ?? null } : null,
                openComplaints: ((cycle.complaints ?? []) as { status?: string }[]).filter((c) => c.status === "OPEN").length,
              }
            : null,
          evaluations: runs.map((r) => ({ status: RUN_STATUS_UI[r.status] ?? r.status, startedAt: r.startedAt })),
          gates: gates.map((g) => ({ gate: g.tool ?? "file_gate_submission", status: GATE_STATUS_UI[g.status] ?? g.status })),
        });
      }
      default:
        return JSON.stringify({ error: `Unknown tool "${name}".` });
    }
  } catch (err) {
    /* A failed read is reported as a failed read — the model is told, and it
       says so to the officer, rather than filling the gap with a guess. */
    return JSON.stringify({
      error: `The desk could not be read: ${(err as Error).message}. Tell the officer the service is briefly unreachable rather than guessing.`,
    });
  }
}
