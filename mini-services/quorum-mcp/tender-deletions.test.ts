import { describe, expect, test } from "bun:test";
import { recordTenderDeletion } from "./tender-deletions";

const TENDER = "KE-MOH-2026-117";
const KEY = `tenders/${TENDER}/1793216253256-notice.pdf`;

function deletion(overrides: Record<string, unknown> = {}) {
  return recordTenderDeletion(
    {
      tenderId: TENDER,
      key: KEY,
      filename: "notice.pdf",
      userId: "u_test_officer",
      role: "OFFICER",
      durationMs: 11,
      ...overrides,
    },
    "Test Officer",
  );
}

describe("tender deletion audit entries", () => {
  test("a removal appends a WRITES entry and chains to the previous line", () => {
    const first = deletion();
    const second = deletion({ key: `tenders/${TENDER}/1793216253257-bid.pdf` });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    if (first.status !== 201 || second.status !== 201) return;

    expect(first.entry.tool).toBe("tender_delete");
    expect(first.entry.kind).toBe("WRITES");
    expect(first.entry.status).toBe("OK");
    expect(first.entry.actor).toBe("Test Officer");
    expect(JSON.parse(first.entry.inputs as string)).toMatchObject({
      tenderId: TENDER,
      key: KEY,
      filename: "notice.pdf",
      userId: "u_test_officer",
      role: "OFFICER",
    });
    expect(JSON.parse(first.entry.outputs as string)).toEqual({ deleted: true });
    expect(second.entry.seq).toBe(first.entry.seq + 1);
    expect(second.entry.prev).toBe(first.entry.self ?? "");
  });

  test("refuses a key outside the tender or a body-declared identity", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ key: `tenders/OTHER/${KEY.split("/").pop()}` }, "key must live under"],
      [{ key: `tenders/${TENDER}/../secret.pdf` }, "key must live under"],
      [{ key: "" }, "key must live under"],
      [{ tenderId: "../etc" }, "key must live under"],
      [{ userId: "" }, "userId is required"],
    ];
    for (const [overrides, error] of cases) {
      const result = deletion(overrides);
      expect(result.status).toBe(422);
      if (result.status === 422) expect(result.error).toContain(error);
    }
  });
});
