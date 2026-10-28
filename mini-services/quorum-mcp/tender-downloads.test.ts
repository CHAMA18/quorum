import { describe, expect, test } from "bun:test";
import { recordTenderDownload } from "./tender-downloads";

const TENDER = "KE-MOH-2026-117";
const KEY = `tenders/${TENDER}/1793216253256-notice.pdf`;
const EXPIRES = Date.now() + 5 * 60 * 1000;

function download(overrides: Record<string, unknown> = {}) {
  return recordTenderDownload(
    {
      tenderId: TENDER,
      key: KEY,
      filename: "notice.pdf",
      userId: "u_test_officer",
      role: "OFFICER",
      bytes: 2048,
      partial: false,
      linkExpiresAt: EXPIRES,
      durationMs: 17,
      ...overrides,
    },
    "Test Officer",
  );
}

describe("tender download audit entries", () => {
  test("a full delivery appends a READ entry with the user and object facts", () => {
    const result = download();
    expect(result.status).toBe(201);
    if (result.status !== 201) return;

    expect(result.entry.tool).toBe("tender_download");
    expect(result.entry.kind).toBe("READ");
    expect(result.entry.status).toBe("OK");
    expect(result.entry.actor).toBe("Test Officer");
    expect(result.entry.server).toBe("quorum-mcp");
    expect(JSON.parse(result.entry.inputs as string)).toMatchObject({
      tenderId: TENDER,
      key: KEY,
      filename: "notice.pdf",
      userId: "u_test_officer",
      role: "OFFICER",
      linkExpiresAt: new Date(EXPIRES).toISOString(),
    });
    expect(JSON.parse(result.entry.outputs as string)).toEqual({
      served: true,
      partial: false,
      bytes: 2048,
    });
    expect(result.entry.durationMs).toBe(17);
    expect(result.entry.prev).toBeTruthy();
    expect(result.entry.self).toBeTruthy();
  });

  test("a ranged delivery records the exact slice and stays on the same chain", () => {
    const first = download({ bytes: 2048 });
    const second = download({
      bytes: 5,
      partial: true,
      range: "bytes=5-9",
      contentRange: "bytes 5-9/2048",
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    if (first.status !== 201 || second.status !== 201) return;

    expect(JSON.parse(second.entry.inputs as string)).toMatchObject({ range: "bytes=5-9" });
    expect(JSON.parse(second.entry.outputs as string)).toEqual({
      served: true,
      partial: true,
      bytes: 5,
      contentRange: "bytes 5-9/2048",
    });
    expect(second.entry.seq).toBe(first.entry.seq + 1);
    expect(second.entry.prev).toBe(first.entry.self ?? "");
  });

  test("refuses keys, sizes and identities that do not belong to the tender", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ key: `tenders/OTHER/${KEY.split("/").pop()}` }, "key must live under"],
      [{ key: `tenders/${TENDER}/../secret.pdf` }, "key must live under"],
      [{ key: "" }, "key must live under"],
      [{ tenderId: "../etc" }, "key must live under"],
      [{ bytes: -1 }, "bytes must be between"],
      [{ bytes: 10 * 1024 * 1024 + 1 }, "bytes must be between"],
      [{ bytes: "lots" }, "bytes must be between"],
      [{ linkExpiresAt: 0 }, "linkExpiresAt must be a valid timestamp"],
      [{ linkExpiresAt: undefined }, "linkExpiresAt must be a valid timestamp"],
      [{ userId: "" }, "userId is required"],
    ];
    for (const [overrides, error] of cases) {
      const result = download(overrides);
      expect(result.status).toBe(422);
      if (result.status === 422) expect(result.error).toContain(error);
    }
  });
});
