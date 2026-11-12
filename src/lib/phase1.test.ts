import { describe, expect, it } from "bun:test";
import { gateRisk, sortGateQueue } from "./gate-queue";
import { deadlineDedupeSuffix, deadlineLevel } from "./deadline-escalation";
import { channelAllowed, parsePrefs } from "./notification-prefs";
import { documentTick } from "./document-tick";

describe("sortGateQueue", () => {
  const gates = [
    { id: "a", flags: 0, tool: "record_bid_opening", status: "PENDING", agoHours: 1 },
    { id: "b", flags: 3, tool: "file_gate_submission", status: "AWAITING_SECOND", agoHours: 50 },
  ];
  it("ranks the irreversible flagged gate first by risk and urgency", () => {
    expect(gateRisk(gates[1])).toBeGreaterThan(gateRisk(gates[0]));
    expect(sortGateQueue(gates, "risk")[0].id).toBe("b");
    expect(sortGateQueue(gates, "queue")[0].id).toBe("a");
  });
});

describe("deadlineLevel", () => {
  const now = new Date("2026-11-12T09:00:00Z");
  it("escalates after two overdue days and re-fires daily", () => {
    expect(deadlineLevel("2026-11-09T09:00:00Z", now)).toBe("escalated");
    expect(deadlineLevel("2026-11-11T09:00:00Z", now)).toBe("overdue");
    expect(deadlineLevel("2026-11-15T09:00:00Z", now)).toBe("approaching");
    expect(deadlineDedupeSuffix("escalated", now)).toContain("2026-11-12");
    expect(deadlineDedupeSuffix("overdue", now)).toBe("");
  });
});

describe("notification prefs", () => {
  it("defaults on and honours stored opt-outs", () => {
    expect(channelAllowed(parsePrefs(null), "email")).toBe(true);
    expect(channelAllowed(parsePrefs('{"email":false}'), "email")).toBe(false);
    expect(channelAllowed(parsePrefs("junk"), "whatsapp")).toBe(true);
  });
});

describe("documentTick", () => {
  it("only ticks verified when an evidence hash exists", () => {
    expect(documentTick({ sha256: "a".repeat(64) })).toBe("verified");
    expect(documentTick({})).toBe("on-file");
    expect(documentTick(undefined)).toBe("missing");
  });
});
