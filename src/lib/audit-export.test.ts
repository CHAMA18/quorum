import { describe, expect, test } from "bun:test";
import {
  buildAuditPackage,
  canonicalJson,
  packageHashFor,
  summarizeGates,
  type AuditPackageInput,
  type ChainVerdict,
} from "@/lib/audit-export";

const VERIFICATION: ChainVerdict = {
  ok: true,
  brokenAt: null,
  checked: 3,
  lines: 3,
  segments: 1,
  restarts: [],
  epochs: [{ n: 1, head: "c0ffee", sealedAt: "2026-10-29T00:00:00.000Z", reason: "First segment." }],
};

function input(overrides: Partial<AuditPackageInput> = {}): AuditPackageInput {
  return {
    workspaceId: "ws-demo",
    generatedAt: "2026-10-29T09:00:00.000Z",
    generatedBy: { id: "u_1", name: "A. Officer", email: "officer@example.org", role: "ADMIN" },
    gates: [
      { id: "g_1", tenderId: "KE-MOH-2026-117", status: "EXECUTED", signature: { value: "sig" }, stepUp: {} },
      { id: "g_2", tenderId: "KE-MOH-2026-117", status: "PENDING" },
      { id: "g_3", tenderId: "KE-MOH-2026-118", status: "EXECUTED" },
      { id: "g_4", tenderId: "KE-MOH-2026-118", status: "REJECTED" },
    ],
    log: [
      { seq: 1, id: "tl_00001", ts: "2026-10-29T08:00:00.000Z", prev: "genesis", self: "c0ffee" },
      { seq: 2, id: "tl_00002", ts: "2026-10-29T08:30:00.000Z", prev: "c0ffee", self: "beef" },
    ],
    decisions: [
      { gateId: "g_1", decision: "APPROVE", actor: "A. Officer", decidedAt: "2026-10-29T08:45:00.000Z" },
    ],
    verification: VERIFICATION,
    ledger: { ok: true, lines: 1 },
    anchor: { at: "2026-10-29T00:00:00.000Z", lines: 2, head: "beef" },
    ...overrides,
  };
}

describe("canonical JSON", () => {
  test("sorts object keys at every depth and keeps array order", () => {
    const value = { b: 1, a: { d: [3, 2, { z: 1, y: 2 }], c: true } };
    expect(canonicalJson(value)).toBe('{"a":{"c":true,"d":[3,2,{"y":2,"z":1}]},"b":1}');
  });

  test("omits undefined members but keeps nulls, so a missing field is not a crash", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson(undefined)).toBe("null");
  });
});

describe("audit package", () => {
  test("summarises gates by status and counts executed gates without a receipt", () => {
    const summary = summarizeGates(input().gates);
    expect(summary.gatesByStatus).toEqual({ EXECUTED: 2, PENDING: 1, REJECTED: 1 });
    expect(summary.executedUnsigned).toBe(1);
  });

  test("an empty signature object is unsigned, and unknown statuses are counted as UNKNOWN", () => {
    const summary = summarizeGates([
      { id: "g", status: "EXECUTED", signature: {} },
      { id: "g2", status: "  " },
      { id: "g3" },
    ]);
    expect(summary.executedUnsigned).toBe(1);
    expect(summary.gatesByStatus.UNKNOWN).toBe(2);
  });

  test("builds a reproducible package hash across differently ordered inputs", () => {
    const first = buildAuditPackage(input());
    const second = buildAuditPackage(
      input({
        gates: [
          { status: "EXECUTED", signature: { value: "sig" }, stepUp: {}, tenderId: "KE-MOH-2026-117", id: "g_1" },
          { status: "PENDING", tenderId: "KE-MOH-2026-117", id: "g_2" },
          { status: "EXECUTED", tenderId: "KE-MOH-2026-118", id: "g_3" },
          { status: "REJECTED", tenderId: "KE-MOH-2026-118", id: "g_4" },
        ],
      }),
    );
    expect(first.format).toBe("quorum-audit-package/1");
    expect(first.integrity.algorithm).toBe("sha256");
    expect(first.integrity.packageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.integrity.packageHash).toBe(first.integrity.packageHash);
  });

  test("changing any recorded decision changes the package hash", () => {
    const original = buildAuditPackage(input());
    const altered = buildAuditPackage(
      input({
        decisions: [
          { gateId: "g_1", decision: "REJECT", actor: "A. Officer", decidedAt: "2026-10-29T08:45:00.000Z" },
        ],
      }),
    );
    expect(altered.integrity.packageHash).not.toBe(original.integrity.packageHash);
  });

  test("packageHashFor hashes the canonical digest, not the pretty-printed package", () => {
    const pkg = buildAuditPackage(input());
    const recomputed = packageHashFor({
      workspaceId: pkg.workspaceId,
      scope: pkg.scope,
      summary: pkg.summary,
      record: pkg.record,
      verification: pkg.verification,
    });
    expect(recomputed).toBe(pkg.integrity.packageHash);
  });

  test("records the export scope and the full record, and states how to verify it", () => {
    const pkg = buildAuditPackage(input({ from: "2026-10-01T00:00:00.000Z", to: null }));
    expect(pkg.scope).toEqual({ from: "2026-10-01T00:00:00.000Z", to: null });
    expect(pkg.record.gates).toHaveLength(4);
    expect(pkg.record.log).toHaveLength(2);
    expect(pkg.record.decisions).toHaveLength(1);
    expect(pkg.summary).toMatchObject({ decisionsRecorded: 1, logLines: 2, executedUnsigned: 1 });
    expect(pkg.verification.ledger).toEqual({ ok: true, lines: 1 });
    expect(pkg.verification.anchor?.head).toBe("beef");
    expect(pkg.verificationInstructions.length).toBeGreaterThanOrEqual(6);
    expect(pkg.verificationInstructions[0]).toContain("integrity.packageHash");
  });

  test("a failed chain verdict is carried, never flipped to a pass", () => {
    const pkg = buildAuditPackage(
      input({ verification: { ok: false, brokenAt: 41, lines: 400, checked: 400, segments: 2, restarts: [], epochs: [] } }),
    );
    expect(pkg.verification.chain.ok).toBe(false);
    expect(pkg.verification.chain.brokenAt).toBe(41);
  });
});
