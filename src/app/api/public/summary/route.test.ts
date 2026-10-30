import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET } from "./route";

/**
 * The public summary is the only anonymous window onto the desk, so the
 * contract under test is subtraction: counts and tool names may leave, but
 * actors, inputs, outputs, bidder names and bid values never do.
 */

type SidecarRow = Record<string, unknown>;

const RUNS: SidecarRow[] = [
  {
    tenderId: "T-ALPHA",
    status: "COMPLETED",
    findings: [{ bidder: "Northwind", price: 185000 }, { bidder: "Acme", price: 210000 }],
    drafts: [{ body: "draft one" }],
    updatedAt: "2026-10-29T09:00:00.000Z",
    bidderName: "Northwind Clinical",
    bidValue: 185000,
    supplierContact: "tenders@northwind.example",
  },
  {
    tenderId: "T-BETA",
    status: "RUNNING",
    findings: [],
    drafts: [{ body: "draft two" }, { body: "draft three" }],
    updatedAt: "2026-10-29T08:00:00.000Z",
    bidderName: "Acme Supplies",
  },
  {
    tenderId: "T-ALPHA",
    status: "FAILED",
    findings: [],
    drafts: [],
    updatedAt: "2026-10-28T08:00:00.000Z",
  },
];

const GATES: SidecarRow[] = [
  { status: "PENDING", approver: "Secret Approver" },
  { status: "EXECUTED", approver: "Secret Approver" },
  { status: "EXECUTED", approver: "Secret Approver" },
  { status: "REJECTED", approver: "Secret Approver" },
];

function activityRow(index: number): SidecarRow {
  return {
    id: `tl_${index}`,
    seq: index,
    tool: "record_read",
    status: "OK",
    ts: `2026-10-29T10:00:${String(index).padStart(2, "0")}.000Z`,
    actor: "Secret Officer",
    inputs: '{"bidder":"Northwind","value":185000}',
    outputs: '{"token":"leaked"}',
  };
}

function supplierRow(
  kind: "supplier_application" | "supplier_add",
  index: number,
  status = "OK",
): SidecarRow {
  return {
    id: `tl_sup_${index}`,
    seq: 100 + index,
    tool: kind,
    status,
    ts: `2026-10-29T11:00:${String(index).padStart(2, "0")}.000Z`,
    actor: "org:Northwind Clinical",
    inputs: '{"tenderRef":"T-ALPHA","registrationNo":"KE-123"}',
    outputs: '{"refused":"price too high for the lot"}',
  };
}

const FILINGS = [1, 2, 3, 4, 5, 6].map((n) =>
  supplierRow("supplier_application", n, n % 3 === 0 ? "ERROR" : "OK"),
);
const ENROLMENTS = [7, 8, 9, 10, 11].map((n) => supplierRow("supplier_add", n));

const realFetch = globalThis.fetch;
let seen: string[] = [];

function fakeOk(input: RequestInfo | URL): Response {
  const href = input instanceof Request ? input.url : String(input);
  const url = new URL(href);
  seen.push(url.pathname + url.search);

  if (url.pathname === "/api/runs") return Response.json({ runs: RUNS });
  if (url.pathname === "/api/gates") return Response.json({ gates: GATES });
  if (url.pathname === "/api/log") {
    const tool = url.searchParams.get("tool");
    if (tool === "supplier_application") return Response.json({ entries: FILINGS });
    if (tool === "supplier_add") return Response.json({ entries: ENROLMENTS });
    return Response.json({ entries: Array.from({ length: 10 }, (_, i) => activityRow(i)) });
  }
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  seen = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => fakeOk(input)) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("GET /api/public/summary", () => {
  test("counts runs, tenders, findings, drafts and gates", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { counts: Record<string, number> };
    expect(body.counts).toEqual({
      runs: 3,
      tenders: 2,
      findings: 2,
      drafts: 3,
      pendingGates: 1,
      executedGates: 2,
    });
  });

  test("the sample run carries counts, never the bidder or the price", async () => {
    const body = (await (await GET()).json()) as { sample: Record<string, unknown> | null };
    expect(body.sample).toEqual({
      tenderId: "T-ALPHA",
      status: "COMPLETED",
      findings: 2,
      drafts: 1,
      updatedAt: "2026-10-29T09:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("Northwind");
    expect(JSON.stringify(body)).not.toContain("185000");
    expect(JSON.stringify(body)).not.toContain("tenders@northwind.example");
  });

  test("activity is capped at eight rows and keeps only the public fields", async () => {
    const body = (await (await GET()).json()) as { activity: Array<Record<string, unknown>> };
    expect(seen).toContain("/api/log?limit=80");
    expect(body.activity).toHaveLength(8);
    for (const entry of body.activity) {
      expect(Object.keys(entry).sort()).toEqual(["id", "seq", "status", "tool", "ts"]);
    }
    const serialised = JSON.stringify(body.activity);
    expect(serialised).not.toContain("Secret Officer");
    expect(serialised).not.toContain("Northwind");
    expect(serialised).not.toContain("185000");
    expect(serialised).not.toContain("leaked");
  });

  test("supplier activity merges filings and enrolments, newest first, capped at eight", async () => {
    const body = (await (await GET()).json()) as {
      supplierActivity: Array<Record<string, unknown>>;
    };
    expect(body.supplierActivity).toHaveLength(8);
    expect(body.supplierActivity.map((row) => row.ts)).toEqual([
      "2026-10-29T11:00:11.000Z",
      "2026-10-29T11:00:10.000Z",
      "2026-10-29T11:00:09.000Z",
      "2026-10-29T11:00:08.000Z",
      "2026-10-29T11:00:07.000Z",
      "2026-10-29T11:00:06.000Z",
      "2026-10-29T11:00:05.000Z",
      "2026-10-29T11:00:04.000Z",
    ]);
    for (const row of body.supplierActivity) {
      expect(Object.keys(row).sort()).toEqual(["status", "tool", "ts"]);
    }
    const serialised = JSON.stringify(body.supplierActivity);
    expect(serialised).not.toContain("Northwind");
    expect(serialised).not.toContain("KE-123");
    expect(serialised).not.toContain("price too high");
    expect(serialised).not.toContain("org:");
  });

  test("keeps the supplier outcome so a refusal stays visible", async () => {
    const body = (await (await GET()).json()) as {
      supplierActivity: Array<{ tool?: string; status?: string }>;
    };
    const refusals = body.supplierActivity.filter((row) => row.status === "ERROR");
    expect(refusals.length).toBeGreaterThan(0);
    expect(body.supplierActivity.some((row) => row.tool === "supplier_add")).toBe(true);
    expect(body.supplierActivity.some((row) => row.tool === "supplier_application")).toBe(true);
  });

  test("an unreachable sidecar degrades to empty counts and a null sample", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      counts: Record<string, number>;
      activity: unknown[];
      supplierActivity: unknown[];
      sample: unknown;
    };
    expect(body.counts).toEqual({
      runs: 0,
      tenders: 0,
      findings: 0,
      drafts: 0,
      pendingGates: 0,
      executedGates: 0,
    });
    expect(body.activity).toEqual([]);
    expect(body.supplierActivity).toEqual([]);
    expect(body.sample).toBeNull();
  });
});
