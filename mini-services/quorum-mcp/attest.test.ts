import { describe, expect, test } from "bun:test";
import { ATTEST_SKEW_MS, appendLog, attestSignature, attestVerify, auditHealth, gateSecret, state } from "./store";

const GATE_SECRET = gateSecret();
import { handleCycleRoutes, preApprovalCheck } from "./cycle-routes";
import type { Gate, RosterMemberForGate, TenderCycle } from "./store";

/* ── Gateway attestation — the seal that proves WHO acts ─────────────────── */

function headersWith(method: string, path: string, actor: string, ts: number, secret = GATE_SECRET): Headers {
  const h = new Headers();
  h.set("x-quorum-actor", actor);
  h.set("x-quorum-ts", String(ts));
  h.set("x-quorum-attest", attestSignature(method, path, actor, ts, secret));
  return h;
}

describe("attestVerify", () => {
  test("accepts a correctly sealed mutation", () => {
    const ts = Date.now();
    const v = attestVerify("POST", "/api/gates/g1/decision", headersWith("POST", "/api/gates/g1/decision", "Verify Officer", ts));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.actor).toBe("Verify Officer");
  });
  test("refuses a mutation with no seal", () => {
    const v = attestVerify("POST", "/api/runs", new Headers());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("Unattested mutation");
  });

  test("refuses a tampered actor — the seal covers the identity", () => {
    const ts = Date.now();
    const h = headersWith("POST", "/api/runs", "Verify Officer", ts);
    h.set("x-quorum-actor", "Someone Else");
    const v = attestVerify("POST", "/api/runs", h);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("mismatch");
  });

  test("refuses a tampered path", () => {
    const ts = Date.now();
    const h = headersWith("POST", "/api/runs", "Verify Officer", ts);
    const v = attestVerify("POST", "/api/gates/g1/decision", h);
    expect(v.ok).toBe(false);
  });

  test("refuses a stale seal outside the 5-minute window", () => {
    const ts = Date.now() - ATTEST_SKEW_MS - 1_000;
    const v = attestVerify("POST", "/api/runs", headersWith("POST", "/api/runs", "Verify Officer", ts));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("5-minute window");
  });

  test("refuses a seal made with a different secret", () => {
    const ts = Date.now();
    const v = attestVerify("POST", "/api/runs", headersWith("POST", "/api/runs", "Verify Officer", ts, "wrong-secret"));
    expect(v.ok).toBe(false);
  });
});

/* ── Office-aware gates fail closed (B8) ────────────────────────────────── */

function officeGate(office: Gate["requiredOffice"]): Gate {
  return {
    id: "gate_office",
    runId: "run_office",
    tenderId: "T-OFFICE",
    tool: "certify_evaluation",
    inputs: {},
    status: "PENDING",
    createdAt: new Date().toISOString(),
    requiredOffice: office,
  };
}

describe("preApprovalCheck fail-closed", () => {
  test("an approver on nobody's register is refused, with the office named", () => {
    const reason = preApprovalCheck(officeGate("ACCOUNTING_OFFICER"), "Ghost Officer", [], "Someone Else");
    expect(reason).toContain("not on the committee register");
    expect(reason).toContain("accounting officer");
  });

  test("a member holding the wrong office is still refused with the office named", () => {
    const reason = preApprovalCheck(
      officeGate("ACCOUNTING_OFFICER"),
      "Eng. Bwalya Phiri",
      [{ name: "Eng. Bwalya Phiri", status: "PRESENT", office: "PROCUREMENT_UNIT" }],
      "Someone Else",
    );
    expect(reason).toContain("procurement unit");
    expect(reason).toContain("accounting officer");
  });

  test("a member with no office on the register fails closed", () => {
    const reason = preApprovalCheck(
      officeGate("ACCOUNTING_OFFICER"),
      "Dr. Chanda Mwale",
      [{ name: "Dr. Chanda Mwale", status: "PRESENT" }],
      "Someone Else",
    );
    expect(reason).toContain("no office on the committee register");
  });

  test("the signed-in officer (the gavel) may sign", () => {
    const reason = preApprovalCheck(
      officeGate("ACCOUNTING_OFFICER"),
      "Verify Officer",
      [],
      "Verify Officer",
    );
    expect(reason).toBeNull();
  });

  test("a member holding the exact required office may sign", () => {
    const reason = preApprovalCheck(
      officeGate("PROCUREMENT_UNIT"),
      "Eng. Bwalya Phiri",
      [{ name: "Eng. Bwalya Phiri", status: "PRESENT", office: "PROCUREMENT_UNIT" }],
      "Someone Else",
    );
    expect(reason).toBeNull();
  });
});

/* ── GET /api/tenders/:ref ──────────────────────────────────────────────── */

describe("GET /api/tenders/:ref", () => {
  const TENDER = "T-GET-ROUTE";

  test("returns the tender's cycle, runs and gates", async () => {
    state.cycle = state.cycle.filter((c) => c.tenderId !== TENDER);
    state.cycle.push({ tenderId: TENDER } as unknown as TenderCycle);
    const res = await handleCycleRoutes(`/api/tenders/${TENDER}`, "GET", {});
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { tenderId: string; cycle: { tenderId: string }; runs: unknown[]; gates: unknown[] };
    expect(body.tenderId).toBe(TENDER);
    expect(body.cycle.tenderId).toBe(TENDER);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(Array.isArray(body.gates)).toBe(true);
    state.cycle = state.cycle.filter((c) => c.tenderId !== TENDER);
  });

  test("returns 404 for a tender with no record", async () => {
    const res = await handleCycleRoutes("/api/tenders/T-NOPE-404", "GET", {});
    expect(res?.status).toBe(404);
  });
});

describe("GET /api/procurement-file/:ref/bundle is a sealed, verifiable package", () => {
  test("each artifact hash and the manifest HMAC recompute from the delivered content", async () => {
    const { createHash, createHmac } = await import("node:crypto");
    const res = await handleCycleRoutes("/api/procurement-file/T-BUNDLE-TEST/bundle", "GET", {});
    expect(res?.status).toBe(200);
    const b = (await res?.json()) as {
      manifest: { artifacts: { name: string; sha256: string }[] };
      signature: string;
      signatureAlgorithm: string;
      content: Record<string, unknown>;
    };
    expect(b.signatureAlgorithm).toBe("HMAC-SHA256");
    for (const a of b.manifest.artifacts) {
      const body = b.content[a.name];
      const text = typeof body === "string" ? body : JSON.stringify(body);
      expect(createHash("sha256").update(text).digest("hex")).toBe(a.sha256);
    }
    const recomputed = createHmac("sha256", GATE_SECRET).update(JSON.stringify(b.manifest)).digest("hex");
    expect(b.signature).toBe(recomputed);
  });

  test("refs outside the allowed character set are not served as a bundle", async () => {
    const res = await handleCycleRoutes("/api/procurement-file/bad$ref/bundle", "GET", {});
    expect(res).toBeNull();
  });

  test("dot-only and traversal refs are never served as a procurement file or bundle", async () => {
    for (const ref of ["..", ".", "..x", "x.."]) {
      for (const suffix of ["", "/bundle"]) {
        const res = await handleCycleRoutes(`/api/procurement-file/${ref}${suffix}`, "GET", {});
        // Either the route declines the path, or it refuses the ref with 422 —
        // it must never answer 200 with a file built from the tenders folder.
        expect(res === null || res.status === 422 || res.status === 404).toBe(true);
      }
    }
  });
});

/* ── Conflict-of-interest block on certification ────────────────────────── */

describe("certify_evaluation refuses until every PRESENT member has declared", () => {
  const TENDER = "T-COI-BLOCK";
  const roster: RosterMemberForGate[] = [
    { name: "Eng. Bwalya Phiri", status: "PRESENT", office: "PROCUREMENT_UNIT" },
    { name: "Dr. Chanda Mwale", status: "PRESENT", office: "EVALUATION_COMMITTEE" },
    { name: "Ms. Mutale Banda", status: "EXCUSED", office: "EVALUATION_COMMITTEE" },
  ];

  const seed = (declared: string[]) => {
    state.cycle = state.cycle.filter((c) => c.tenderId !== TENDER);
    const cycle = {
      tenderId: TENDER,
      coi: declared.map((member, i) => ({
        id: `coi_t${i}`,
        member,
        declaration: "NO_CONFLICT" as const,
        declaredAt: new Date().toISOString(),
      })),
    } as unknown as TenderCycle;
    state.cycle.push(cycle);
  };

  test("refused while a PRESENT member has not declared, naming who is missing", () => {
    seed(["Eng. Bwalya Phiri"]);
    const gate = { ...officeGate(undefined), tenderId: TENDER };
    const reason = preApprovalCheck(gate, "Someone Else", roster, "Someone Else");
    expect(reason).toContain("Conflict-of-interest declarations are outstanding");
    expect(reason).toContain("Dr. Chanda Mwale");
    expect(reason).not.toContain("Eng. Bwalya Phiri");
  });

  test("allowed once every PRESENT member has declared (excused members need not)", () => {
    seed(["Eng. Bwalya Phiri", "Dr. Chanda Mwale"]);
    const gate = { ...officeGate(undefined), tenderId: TENDER };
    expect(preApprovalCheck(gate, "Someone Else", roster, "Someone Else")).toBeNull();
  });
});

/* ── The audit spine never fails silently (B9) ──────────────────────────── */

describe("audit spine health flags", () => {
  test("appendLog keeps working and flags nothing when the disk accepts", () => {
    const before = auditHealth.logWriteFailing;
    const entry = appendLog({
      actor: "test",
      server: "quorum-mcp",
      tool: "test_event",
      kind: "READ",
      inputs: {},
      outputs: {},
      status: "OK",
      durationMs: 0,
    });
    expect(entry.self).toBeTruthy();
    expect(entry.prev).toBeTruthy();
    /* the flag was untouched by a healthy append (false stays false) */
    expect(auditHealth.logWriteFailing).toBe(before);
  });

  test("every entry chains to its predecessor", () => {
    const a = appendLog({ actor: "t", server: "s", tool: "chain_a", kind: "READ", inputs: {}, outputs: {}, status: "OK", durationMs: 0 });
    const b = appendLog({ actor: "t", server: "s", tool: "chain_b", kind: "READ", inputs: {}, outputs: {}, status: "OK", durationMs: 0 });
    expect(b.prev).toBe(a.self);
  });
});
