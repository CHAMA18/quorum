import { describe, expect, it } from "bun:test";
import { notificationEmail, plainTitle } from "./notifications";

const row = {
  id: "n1",
  userId: "u1",
  kind: "GATE_WAITING",
  title: "Gate waiting: T-WS5",
  body: "sign contract pack needs a named human (accounting officer). The agent has prepared the file; only the committee can sign it.",
  href: "mc-gates",
  entityType: "gate",
  entityId: "g1",
  dedupeKey: "k",
  readAt: null,
  createdAt: new Date("2026-11-12T09:56:00Z"),
} as never;
const user = { email: "officer@example.com" } as never;

describe("plain email copy", () => {
  it("translates stored gate titles into plain words", () => {
    expect(plainTitle("Gate waiting: T-WS5")).toBe("Approval needed: T-WS5");
    expect(plainTitle("Gate signed: T-WS5")).toBe("Approved: T-WS5");
  });

  it("renders no gate/committee/agent jargon in the approval email", () => {
    const mail = notificationEmail(row, user);
    const all = `${mail.subject}\n${mail.html}\n${mail.text}`.toLowerCase();
    expect(mail.subject).toContain("Approval needed: T-WS5");
    expect(all).not.toContain("gate waiting");
    expect(all).not.toContain("named human");
    expect(all).not.toContain("committee");
    expect(all).toContain("designated approver");
    expect(all).toContain("waiting for approval");
  });
});
