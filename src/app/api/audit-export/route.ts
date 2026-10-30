import { NextResponse, type NextRequest } from "next/server";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { attestSignature } from "@/lib/sidecar-attest";
import {
  buildAuditPackage,
  renderAuditPdf,
  type AnchorRecord,
  type ChainVerdict,
  type ExportGate,
  type ExportLogEntry,
  type LedgerVerdict,
} from "@/lib/audit-export";

/**
 * GET /api/audit-export?format=json|pdf — the record, in a form that leaves.
 *
 * An oversight body asks for the file, not a screen. This route assembles the
 * gates, the hash-chained audit log, the decision ledger and the verifier's
 * own verdicts into one downloadable package, hashes it, and offers a PDF
 * summary beside the JSON. The JSON is the evidence; the PDF is what a reader
 * opens first.
 *
 * Reading the record is itself a recorded act: the export appends a READ line
 * to the same spine, attested with the officer's workspace, so the fact that a
 * copy left the desk is on the record too.
 *
 * 200 → the package (attachment)
 * 401 → no session  403 → role cannot export  422 → unknown format
 * 429 → rate limited  502 → the sidecar is unreachable or refused a read
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIDECAR = (process.env.QUORUM_SIDECAR_URL?.trim() || "http://127.0.0.1:3031").replace(/\/+$/, "");

type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Workspace-scoped read. The GET endpoints return the record of the workspace
 * named in `x-quorum-workspace`, so the header is taken from the verified
 * session — never from the request — and every call fails loudly.
 */
async function readRecord<T>(path: string, workspaceId: string): Promise<ReadResult<T>> {
  try {
    const res = await fetch(`${SIDECAR}${path}`, {
      headers: { accept: "application/json", "x-quorum-workspace": workspaceId },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `The procurement service refused the read of ${path} (HTTP ${res.status}). No package was produced.`,
      };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return {
      ok: false,
      error: "The procurement service is not reachable, so the record could not be read. No package was produced.",
    };
  }
}

/** The export is a read of supplier, bid and audit data — it gets its own line. */
function auditExportRead(actor: { name: string; workspaceId: string }): void {
  const ts = Date.now();
  void fetch(`${SIDECAR}/api/audit/read`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-quorum-actor": actor.name,
      "x-quorum-workspace": actor.workspaceId,
      "x-quorum-ts": String(ts),
      "x-quorum-attest": attestSignature("POST", "/api/audit/read", actor.name, ts, actor.workspaceId),
    },
    body: JSON.stringify({ path: "/api/audit-export", status: 200 }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workspace";
}

export async function GET(req: NextRequest) {
  const actor = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!actor) {
    return NextResponse.json({ error: "Sign in to export the audit record." }, { status: 401 });
  }
  if (!can(actor.role, "view_oversight")) {
    return NextResponse.json(
      { error: "Exporting the audit record is limited to owners, admins and auditors." },
      { status: 403 },
    );
  }
  if (!rateLimit(`audit-export:${actor.id}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Too many audit exports; wait a minute and try again." },
      { status: 429 },
    );
  }

  const format = (req.nextUrl.searchParams.get("format") ?? "json").trim().toLowerCase();
  if (format !== "json" && format !== "pdf") {
    return NextResponse.json({ error: "Use format=json or format=pdf." }, { status: 422 });
  }

  const requestedFrom = req.nextUrl.searchParams.get("from")?.trim() || null;
  const requestedTo = req.nextUrl.searchParams.get("to")?.trim() || null;
  const from = requestedFrom && !Number.isNaN(Date.parse(requestedFrom)) ? requestedFrom : null;
  const to = requestedTo && !Number.isNaN(Date.parse(requestedTo)) ? requestedTo : null;

  const [gates, log, chain, decisions, anchor] = await Promise.all([
    readRecord<{ gates?: ExportGate[] }>("/api/gates", actor.workspaceId),
    readRecord<{ entries?: ExportLogEntry[] }>("/api/log/export", actor.workspaceId),
    readRecord<ChainVerdict>("/api/log/verify", actor.workspaceId),
    readRecord<{ ledger?: LedgerVerdict; decisions?: Record<string, unknown>[] }>("/api/decisions", actor.workspaceId),
    readRecord<{ anchor?: AnchorRecord | null }>("/api/log/anchor", actor.workspaceId),
  ]);

  /* Five reads, five honest answers. A partial package would look complete
     while missing part of the record, so any refused read aborts the export. */
  for (const result of [gates, log, chain, decisions, anchor]) {
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
  }
  if (!gates.ok || !log.ok || !chain.ok || !decisions.ok || !anchor.ok) {
    return NextResponse.json(
      { error: "The record could not be read in full. No package was produced." },
      { status: 502 },
    );
  }

  const gateRows = gates.data.gates ?? [];
  const logRows =
    log.data.entries?.filter((entry) => {
      if (!from && !to) return true;
      const at = typeof entry.ts === "string" ? Date.parse(entry.ts) : Number.NaN;
      if (Number.isNaN(at)) return true;
      if (from && at < Date.parse(from)) return false;
      if (to && at > Date.parse(to)) return false;
      return true;
    }) ?? [];
  const decisionRows =
    decisions.data.decisions?.filter((row) => {
      if (!from && !to) return true;
      const at = typeof row.decidedAt === "string" ? Date.parse(row.decidedAt) : Number.NaN;
      if (Number.isNaN(at)) return true;
      if (from && at < Date.parse(from)) return false;
      if (to && at > Date.parse(to)) return false;
      return true;
    }) ?? [];

  const pkg = buildAuditPackage({
    workspaceId: actor.workspaceId,
    generatedBy: { id: actor.id, name: actor.name, email: actor.email, role: actor.role },
    gates: gateRows,
    log: logRows,
    decisions: decisionRows,
    verification: chain.data,
    ledger: decisions.data.ledger ?? null,
    anchor: anchor.data.anchor ?? null,
    from,
    to,
  });

  auditExportRead(actor);

  const stamp = pkg.generatedAt.slice(0, 10);
  const base = `quorum-audit-${safeName(actor.workspaceId)}-${stamp}`;

  if (format === "pdf") {
    const pdf = await renderAuditPdf(pkg);
    return new NextResponse(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${base}.pdf"`,
        "cache-control": "no-store",
      },
    });
  }

  return new NextResponse(JSON.stringify(pkg, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${base}.json"`,
      "cache-control": "no-store",
    },
  });
}
