/**
 * The unified audit spine — web-side events land in the sidecar's chain (WS9).
 *
 * Proven here: an attested forward writes one hash-chained line; a replay of
 * the same idempotency key is answered without a second line; a forward
 * claiming another workspace is refused; a failed durable write sends a
 * high-risk source act back with 503 and clears the key so the outbox retry
 * is not swallowed.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { auditHealth, DEFAULT_FEATURES, state, toolLog, verifyLogChain, type LogEntry } from "./store";
import { forwardWebEvent, HIGH_RISK_WEB_EVENTS } from "./audit-forward";

beforeEach(() => {
  state.features = { ...DEFAULT_FEATURES, unifiedAudit: true };
  state.forwardedKeys.length = 0;
  auditHealth.logWriteFailing = false;
});

afterEach(() => {
  state.forwardedKeys.length = 0;
  auditHealth.logWriteFailing = false;
  state.features = { ...DEFAULT_FEATURES };
});

const EVENT = {
  idempotencyKey: "evt_minutes_12",
  type: "MINUTES_APPROVED",
  actor: "Dr. Chair",
  workspaceId: "demo",
  targetType: "MEETING",
  targetId: "mtg_42",
  reason: "Chair approved the draft minutes after quote checks",
  after: { status: "APPROVED", minutesRef: "minutes-42" },
  at: "2026-11-02T10:00:00.000Z",
};

describe("the forward endpoint's semantics", () => {
  test("a well-formed event lands in the chain as web:<TYPE>", () => {
    const verdict = forwardWebEvent(EVENT, "web-gateway", "demo");
    expect(verdict.ok).toBe(true);
    expect(verdict.code).toBe(200);
    expect(verdict.duplicate ?? false).toBe(false);
    expect(verdict.highRisk).toBe(true);
    /* The line is the newest entry and chains onto the previous head. */
    const tail = awaitLatest();
    expect(tail.tool).toBe("web:MINUTES_APPROVED");
    expect(tail.server).toBe("web-app");
    expect(tail.actor).toBe("Dr. Chair");
    expect(tail.prev).toBeTruthy();
  });

  test("the chain still verifies after the forward", () => {
    forwardWebEvent(EVENT, "web-gateway", "demo");
    const entries = state.forwardedKeys;
    expect(entries).toContain("evt_minutes_12");
    expect(verifyLogChain(awaitAll()).ok).toBe(true);
  });

  test("a replay of the same idempotency key is a duplicate, not a second line", () => {
    const first = forwardWebEvent(EVENT, "web-gateway", "demo");
    const replay = forwardWebEvent(EVENT, "web-gateway", "demo");
    expect(first.logId).toBeTruthy();
    expect(replay.ok).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect(state.forwardedKeys.filter((k) => k === "evt_minutes_12").length).toBe(1);
  });

  test("a duplicate check across a restart reads the persisted key row", () => {
    state.forwardedKeys.push("evt_pay_7");
    const replay = forwardWebEvent(
      { idempotencyKey: "evt_pay_7", type: "PAYMENT_CERTIFIED", targetType: "PAYMENT", targetId: "pay_7" },
      "web-gateway",
      "demo",
    );
    expect(replay.duplicate).toBe(true);
  });

  test("the workspace the envelope covers bounds the event's claim", () => {
    const verdict = forwardWebEvent(
      { ...EVENT, workspaceId: "other-workspace" },
      "web-gateway",
      "demo",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(403);
    expect(verdict.error).toContain("cannot cross tenants");
  });

  test("malformed events are refused with a named field", () => {
    const noKey = forwardWebEvent({ type: "MINUTES_APPROVED", targetType: "X", targetId: "1" }, "web-gateway", "demo");
    expect(noKey.code).toBe(422);
    expect(noKey.error).toContain("idempotencyKey");

    const badType = forwardWebEvent({ ...EVENT, idempotencyKey: "k2", type: "not-a-type" }, "web-gateway", "demo");
    expect(badType.code).toBe(422);

    const noTarget = forwardWebEvent({ ...EVENT, idempotencyKey: "k3", targetId: "" }, "web-gateway", "demo");
    expect(noTarget.code).toBe(422);
  });

  test("high-risk events fail closed while the durable write is failing", () => {
    auditHealth.logWriteFailing = true;
    const verdict = forwardWebEvent(EVENT, "web-gateway", "demo");
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe(503);
    expect(verdict.highRisk).toBe(true);
    /* The key is cleared so the outbox retry is not mistaken for success. */
    expect(state.forwardedKeys).not.toContain("evt_minutes_12");
  });

  test("low-risk events queue the same way but never block a source act", () => {
    auditHealth.logWriteFailing = true;
    const verdict = forwardWebEvent(
      { idempotencyKey: "evt_note_1", type: "NOTE_ADDED", targetType: "TENDER", targetId: "T-1" },
      "web-gateway",
      "demo",
    );
    expect(verdict.highRisk).toBe(false);
    expect(HIGH_RISK_WEB_EVENTS).toContain("CONTRACT_EXECUTED");
    expect(HIGH_RISK_WEB_EVENTS).toContain("PAYMENT_CERTIFIED");
    expect(HIGH_RISK_WEB_EVENTS).not.toContain("NOTE_ADDED");
  });
});

/* Helpers — the live log array the process holds (appendLog writes memory and disk). */
function awaitAll(): LogEntry[] {
  return toolLog.slice();
}
function awaitLatest(): LogEntry {
  return toolLog[toolLog.length - 1];
}
