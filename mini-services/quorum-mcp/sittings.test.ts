/**
 * Sittings — the refusal every gate now answers to (WS8).
 *
 * Each test drives `sittingQuorumRefusal`, the one truth the gate decision
 * path reads: quorum comes from a noticed sitting's admitted attendance,
 * never from a hand-set PRESENT flag, and the emergency path is named,
 * reasoned or refused.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_FEATURES, normalizeSitting, state, type Sitting } from "./store";
import { createSitting, endSitting, recordAttendance, sittingQuorumRefusal } from "./sittings";
import { readLogEntries } from "./store";

const TENDER = "ZM-SIT-001";
const NOW = new Date("2026-11-02T09:00:00.000Z");

function sittingBase(overrides: Partial<Sitting> = {}): Sitting {
  return normalizeSitting({
    id: "sit_test_1",
    workspaceId: "demo",
    tenderIds: [TENDER],
    scheduledAt: "2026-11-01T08:00:00.000Z",
    noticeAt: "2026-10-28T09:00:00.000Z",
    noticeIssuedBy: "Procurement Officer",
    quorumRequired: 2,
    attendance: [],
    status: "LIVE",
    ...overrides,
  })!;
}

beforeEach(() => {
  state.sittings.length = 0;
  state.features = { ...DEFAULT_FEATURES, sittingQuorum: true };
});

afterEach(() => {
  state.sittings.length = 0;
  state.features = { ...DEFAULT_FEATURES };
});

describe("the sitting quorum refusal", () => {
  test("the flag off keeps the committee-roll quorum (legacy behaviour)", () => {
    expect(sittingQuorumRefusal({ tenderId: TENDER, required: 2, flagOn: false, sittings: [] })).toBeNull();
  });

  test("a tender with no sitting at all is refused, naming the tender", () => {
    const refusal = sittingQuorumRefusal({ tenderId: TENDER, required: 2, now: NOW, sittings: [], flagOn: true });
    expect(refusal).toContain("No sitting is on record for ZM-SIT-001");
  });

  test("an unnoticed sitting is not a committee", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      now: NOW,
      sittings: [sittingBase({ noticeAt: undefined })],
      flagOn: true,
    });
    expect(refusal).toContain("notice");
    expect(String(refusal).toLowerCase()).toContain("unnoticed");
  });

  test("a notice that has not taken effect yet cannot carry quorum", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      now: NOW,
      sittings: [sittingBase({ noticeAt: "2026-11-03T09:00:00.000Z" })],
      flagOn: true,
    });
    expect(refusal).toContain("before the notice is live");
  });

  test("attendance below the required seats keeps the gate closed", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      now: NOW,
      sittings: [
        sittingBase({
          attendance: [{ name: "Alice Mwale", status: "ADMITTED", at: NOW.toISOString() }],
        }),
      ],
      flagOn: true,
    });
    expect(refusal).toContain("1 admitted of 2 required");
  });

  test("the attested gavel counts once in addition to admitted members", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      signedInAs: "Bob Banda",
      now: NOW,
      sittings: [
        sittingBase({
          attendance: [{ name: "Alice Mwale", status: "ADMITTED", at: NOW.toISOString() }],
        }),
      ],
      flagOn: true,
    });
    expect(refusal).toBeNull();
  });

  test("the gavel who is already admitted is not seated twice", () => {
    /* Alice and Bob are admitted; the approving gavel IS Alice. Two seats are
       filled — the count stays two, never three. */
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      signedInAs: "Alice Mwale",
      now: NOW,
      sittings: [
        sittingBase({
          attendance: [
            { name: "Alice Mwale", status: "ADMITTED", at: NOW.toISOString() },
            { name: "Bob Banda", status: "ADMITTED", at: NOW.toISOString() },
          ],
        }),
      ],
      flagOn: true,
    });
    expect(refusal).toBeNull();
  });

  test("an admitted gavel does not conjure a third seat", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 3,
      signedInAs: "Alice Mwale",
      now: NOW,
      sittings: [
        sittingBase({
          attendance: [
            { name: "Alice Mwale", status: "ADMITTED", at: NOW.toISOString() },
            { name: "Bob Banda", status: "ADMITTED", at: NOW.toISOString() },
          ],
        }),
      ],
      flagOn: true,
    });
    expect(refusal).toContain("2 admitted of 3 required");
  });

  test("a member who left the room after being seated stops counting", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      signedInAs: undefined,
      now: NOW,
      sittings: [
        sittingBase({
          attendance: [
            { name: "Alice Mwale", status: "ADMITTED", at: NOW.toISOString() },
            { name: "Bob Banda", status: "ADMITTED", at: NOW.toISOString() },
            { name: "Carl Zulu", status: "WITHDRAWN", at: NOW.toISOString() },
          ],
        }),
      ],
      flagOn: true,
    });
    expect(refusal).toBeNull();
  });

  test("an ended sitting cannot carry a later decision", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      now: NOW,
      sittings: [
        sittingBase({
          status: "ENDED",
          endedAt: "2026-11-01T12:00:00.000Z",
          attendance: [
            { name: "Alice Mwale", status: "ADMITTED", at: NOW.toISOString() },
            { name: "Bob Banda", status: "ADMITTED", at: NOW.toISOString() },
          ],
        }),
      ],
      flagOn: true,
    });
    expect(refusal).toContain("has ended");
  });

  test("the emergency path needs the sitting's own named reason — with one it passes", () => {
    const withoutReason = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      now: NOW,
      sittings: [sittingBase({ noticeAt: undefined, noticeIssuedBy: undefined })],
      flagOn: true,
    });
    expect(withoutReason).toContain("unnoticed");
    const declared = sittingQuorumRefusal({
      tenderId: TENDER,
      required: 2,
      now: NOW,
      sittings: [
        sittingBase({
          noticeAt: undefined,
          status: "LIVE",
          emergency: { by: "Accounting Officer", reason: "Procurement failure could close the health ward", at: NOW.toISOString() },
        }),
      ],
      flagOn: true,
    });
    expect(declared).toBeNull();
  });

  test("a sitting linked to another tender does not carry this one", () => {
    const refusal = sittingQuorumRefusal({
      tenderId: "ZM-SIT-002",
      required: 2,
      now: NOW,
      sittings: [sittingBase({ tenderIds: [TENDER] })],
      flagOn: true,
    });
    expect(refusal).toContain("ZM-SIT-002");
  });
});

describe("the sitting routes", () => {
  beforeEach(() => {
    state.cycle.length = 0;
    state.pipeline.length = 0;
  });

  test("a sitting needs a real scheduled time and a known tender", () => {
    const missingTender = createSitting({ tenderIds: [TENDER], scheduledAt: "2026-11-10T09:00:00Z" }, "Officer");
    expect(missingTender.code).toBe(422);
    expect(JSON.stringify(missingTender.body)).toContain("the record does not know");

    state.pipeline.push({ ref: TENDER, title: "x", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), createdById: "u1", stage: "REVIEW", currency: "ZMW", budgetEstimate: 1_000_000 } as never);
    const badDate = createSitting({ tenderIds: [TENDER], scheduledAt: "not-a-date" }, "Officer");
    expect(badDate.code).toBe(422);

    const pastNoEmergency = createSitting({ tenderIds: [TENDER], scheduledAt: "2026-01-01T09:00:00Z" }, "Officer");
    expect(pastNoEmergency.code).toBe(422);
    expect(JSON.stringify(pastNoEmergency.body)).toContain("emergency");
  });

  test("creating a sitting issues the notice in one act and writes the audit line", async () => {
    state.pipeline.push({ ref: TENDER, title: "x", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), createdById: "u1", stage: "REVIEW", currency: "ZMW", budgetEstimate: 1_000_000 } as never);
    const out = createSitting(
      { tenderIds: [TENDER], scheduledAt: "2026-11-10T09:00:00Z", location: "Committee Room 2", quorumRequired: 3 },
      "Procurement Officer",
    );
    expect(out.code).toBe(201);
    const sitting = state.sittings[0];
    expect(sitting.noticeAt).toBeTruthy();
    expect(sitting.noticeIssuedBy).toBe("Procurement Officer");
    expect(sitting.quorumRequired).toBe(3);
    expect(sitting.status).toBe("NOTICED");
    const log = await readLogEntries();
    expect(log.some((l) => l.tool === "schedule_sitting" && JSON.stringify(l.inputs).includes(TENDER))).toBe(true);
  });

  test("an emergency sitting must carry a reason of substance", () => {
    state.pipeline.push({ ref: TENDER, title: "x", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), createdById: "u1", stage: "REVIEW", currency: "ZMW", budgetEstimate: 1_000_000 } as never);
    const weak = createSitting({ tenderIds: [TENDER], scheduledAt: "2020-01-01T09:00:00Z", emergencyReason: "hurry" }, "Officer");
    expect(weak.code).toBe(422);
    const strong = createSitting(
      { tenderIds: [TENDER], scheduledAt: "2020-01-01T09:00:00Z", emergencyReason: "Sole-source failure required immediate award review" },
      "Accounting Officer",
    );
    expect(strong.code).toBe(201);
    expect(state.sittings[0].emergency?.reason).toContain("immediate");
  });

  test("attendance is admitted at the door, withdrawn on leaving, and audited", async () => {
    /* The sandbox audit file persists across runs — judge growth, not total. */
    const before = (await readLogEntries()).filter((l) => l.tool === "record_attendance").length;
    state.pipeline.push({ ref: TENDER, title: "x", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), createdById: "u1", stage: "REVIEW", currency: "ZMW", budgetEstimate: 1_000_000 } as never);
    createSitting({ tenderIds: [TENDER], scheduledAt: "2026-11-10T09:00:00Z" }, "Clerk");
    const id = state.sittings[0].id;
    const admitted = recordAttendance(id, { name: "Alice Mwale" }, "Clerk");
    expect(admitted.code).toBe(200);
    expect(state.sittings[0].status).toBe("LIVE");
    recordAttendance(id, { name: "Bob Banda" }, "Clerk");
    recordAttendance(id, { name: "Bob Banda", admit: false }, "Clerk");
    const rows = state.sittings[0].attendance;
    const bob = rows.find((r) => r.name === "Bob Banda");
    expect(bob?.status).toBe("WITHDRAWN");
    const log = await readLogEntries();
    expect(log.filter((l) => l.tool === "record_attendance").length - before).toBe(3);
  });

  test("ending the sitting closes attendance and the quorum with it", async () => {
    state.pipeline.push({ ref: TENDER, title: "x", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), createdById: "u1", stage: "REVIEW", currency: "ZMW", budgetEstimate: 1_000_000 } as never);
    createSitting({ tenderIds: [TENDER], scheduledAt: "2026-11-10T09:00:00Z" }, "Clerk");
    const id = state.sittings[0].id;
    recordAttendance(id, { name: "Alice Mwale" }, "Clerk");
    const quit = recordAttendance(id, { name: "Alice Mwale" }, "Clerk");
    expect(quit.code).toBe(200);
    const ended = endSitting(id, { minutesRef: "minutes-sit-1" }, "Chair");
    expect(ended.code).toBe(200);
    expect(state.sittings[0].status).toBe("ENDED");
    expect(endSitting(id, {}, "Chair").code).toBe(409);
    const late = recordAttendance(id, { name: "Dave Ngoma" }, "Clerk");
    expect(late.code).toBe(409);
    const refusal = sittingQuorumRefusal({ tenderId: TENDER, required: 1, now: new Date(), flagOn: true });
    expect(refusal).toContain("has ended");
    const log = await readLogEntries();
    expect(log.some((l) => l.tool === "end_sitting" && JSON.stringify(l.inputs).includes("minutes-sit-1"))).toBe(true);
  });
});
