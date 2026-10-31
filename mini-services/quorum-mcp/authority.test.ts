import { describe, expect, test } from "bun:test";
import { preApprovalCheck } from "./cycle-routes";
import type { Gate, RosterMemberForGate } from "./store";

const gate = {
  id: "gate_1",
  runId: "cycle",
  tenderId: "T-AUTH",
  tool: "sign_award_report",
  inputs: {},
  status: "PENDING",
  createdAt: new Date().toISOString(),
  requiredOffice: "ACCOUNTING_OFFICER",
} as Gate;

const roster: RosterMemberForGate[] = [
  { id: "user_alice", name: "Alice Mwale", status: "PRESENT", office: "ACCOUNTING_OFFICER" },
];

describe("actor-bound office authority", () => {
  test("a typed name cannot borrow another member's office", () => {
    const reason = preApprovalCheck(gate, "Alice Mwale", roster, "Bob Banda", "user_bob");
    expect(reason).toContain("bound to a different signed-in user");
  });

  test("the office holder's own id signs", () => {
    expect(preApprovalCheck(gate, "Alice Mwale", roster, "Bob Banda", "user_alice")).toBeNull();
  });

  test("a roster row without a user id fails closed when an actor id is attested", () => {
    const legacy: RosterMemberForGate[] = [{ name: "Alice Mwale", status: "PRESENT", office: "ACCOUNTING_OFFICER" }];
    expect(preApprovalCheck(gate, "Alice Mwale", legacy, "Bob Banda", "user_alice")).toContain(
      "bound to a different signed-in user",
    );
  });

  test("without an attested id the legacy name check still applies", () => {
    expect(preApprovalCheck(gate, "Alice Mwale", roster, "Bob Banda")).toBeNull();
  });
});
