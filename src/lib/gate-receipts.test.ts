import { describe, expect, test } from "bun:test";
import { formatGateReceipt, gateReceiptHash, gateReceiptId, type GateReceipt } from "./gate-receipts";

/**
 * Every shape returned by the sidecar's gate executors:
 *
 *  · engine.ts nodeTransmit        → file_gate_submission
 *  · cycle-routes.ts switch        → the thirteen statutory cycle gates
 *
 * `undefined` is the fourteenth case: an executor returns nothing when the
 * underlying record is gone. These fixtures mirror the real receipts in
 * mini-services/quorum-mcp/data/state.json.
 */
type Shape = {
  tool: string;
  receipt: GateReceipt | null | undefined;
  id: string | null;
  hash: string | null;
  output: string;
};

const SHAPES: Shape[] = [
  {
    tool: "file_gate_submission",
    receipt: { submissionId: "SUB-MVRTXPNH", hash: "8192884f51650093a7f5ebb1a8b8e5cc", portal: "egp-portal (simulated)" },
    id: "SUB-MVRTXPNH",
    hash: "8192884f51650093a7f5ebb1a8b8e5cc",
    output: "SUB-MVRTXPNH · sha 8192884f5165 · egp-portal (simulated)",
  },
  {
    tool: "record_bid_opening",
    receipt: { registerId: "open_cud1ax", sha: "ee9f79b66a87a2702ea04b5001efe57d", admitted: 2 },
    id: "open_cud1ax",
    hash: "ee9f79b66a87a2702ea04b5001efe57d",
    output: "open_cud1ax · sha ee9f79b66a87",
  },
  {
    tool: "certify_evaluation",
    receipt: { matrixId: "mtx_oopp34", status: "CERTIFIED", recommended: "BID BETA" },
    id: "mtx_oopp34",
    hash: null,
    output: "mtx_oopp34",
  },
  {
    tool: "resolve_alb",
    receipt: { dossierId: "alb_1", outcome: "JUSTIFIED" },
    id: "alb_1",
    hash: null,
    output: "alb_1",
  },
  {
    tool: "sign_award_report",
    receipt: { sha: "df0bf32762b08fa72be3d98dfe287343", recommendation: "BID BETA" },
    id: null,
    hash: "df0bf32762b08fa72be3d98dfe287343",
    output: "RECEIPT FILED · sha df0bf32762b0",
  },
  {
    tool: "publish_award_notice",
    receipt: { portal: "egp-portal (simulated)", standstillEndsAt: "2026-11-04T14:57:44.756Z" },
    id: null,
    hash: null,
    output: "RECEIPT FILED · egp-portal (simulated)",
  },
  {
    tool: "issue_debrief",
    receipt: { debriefId: "deb_1", bidder: "Coastline Screening Solutions" },
    id: "deb_1",
    hash: null,
    output: "deb_1",
  },
  {
    tool: "sign_contract_pack",
    receipt: { supplier: "Nyota Energy Ltd", value: 3_900_000 },
    id: null,
    hash: null,
    output: "Nyota Energy Ltd",
  },
  {
    tool: "approve_variation",
    receipt: { variationId: "var_f8j99d", pct: 23.1 },
    id: "var_f8j99d",
    hash: null,
    output: "var_f8j99d",
  },
  {
    tool: "certify_payment",
    receipt: { paymentId: "pay_y86zdn", amount: 1_000_000 },
    id: "pay_y86zdn",
    hash: null,
    output: "pay_y86zdn",
  },
  {
    tool: "record_contract_completion",
    receipt: { completedAt: "2026-10-21T14:57:45.287Z" },
    id: null,
    hash: null,
    output: "RECEIPT FILED",
  },
  {
    tool: "respond_complaint",
    receipt: { complaintId: "cmp_8y4mkq", status: "ANSWERED" },
    id: "cmp_8y4mkq",
    hash: null,
    output: "cmp_8y4mkq",
  },
  {
    tool: "publish_notice",
    receipt: { noticeId: "not_1", published: true, portal: "egp-portal (simulated)" },
    id: "not_1",
    hash: null,
    output: "not_1 · egp-portal (simulated)",
  },
  {
    tool: "executor returned no record",
    receipt: undefined,
    id: null,
    hash: null,
    output: "RECEIPT FILED",
  },
];

describe("gate receipts — every executor shape", () => {
  for (const shape of SHAPES) {
    test(`${shape.tool} formats without assuming a hash`, () => {
      const line = formatGateReceipt(shape.receipt);
      expect(line).toBe(shape.output);
      expect(line).not.toContain("undefined");
      expect(gateReceiptId(shape.receipt)).toBe(shape.id);
      expect(gateReceiptHash(shape.receipt)).toBe(shape.hash);
    });
  }

  test("null and an empty receipt degrade to a filed line", () => {
    expect(formatGateReceipt(null)).toBe("RECEIPT FILED");
    expect(formatGateReceipt({})).toBe("RECEIPT FILED");
  });

  test("a hash without an id still renders its seal", () => {
    expect(formatGateReceipt({ hash: "abcdef1234567890" })).toBe("RECEIPT FILED · sha abcdef123456");
  });

  test("a non-string hash is ignored rather than sliced", () => {
    const malformed = { paymentId: "pay_1", hash: 42 } as unknown as GateReceipt;
    expect(() => formatGateReceipt(malformed)).not.toThrow();
    expect(formatGateReceipt(malformed)).toBe("pay_1");
    expect(gateReceiptHash(malformed)).toBeNull();
  });

  test("blank identifiers fall through to the next real id", () => {
    expect(gateReceiptId({ submissionId: "   ", registerId: "open_1" })).toBe("open_1");
    expect(formatGateReceipt({ submissionId: "", registerId: "open_1", sha: "1234567890abcdef" })).toBe(
      "open_1 · sha 1234567890ab",
    );
  });

  test("hash wins over sha when an executor returns both", () => {
    expect(gateReceiptHash({ hash: "hash_value_1234", sha: "sha_value_5678" })).toBe("hash_value_1234");
  });

  test("a portal is included only when it is a non-empty string", () => {
    expect(formatGateReceipt({ complaintId: "cmp_1", portal: "egp-portal (simulated)" })).toBe(
      "cmp_1 · egp-portal (simulated)",
    );
    expect(formatGateReceipt({ complaintId: "cmp_1", portal: "   " })).toBe("cmp_1");
    expect(formatGateReceipt({ complaintId: "cmp_1", portal: 7 } as unknown as GateReceipt)).toBe("cmp_1");
  });
});
