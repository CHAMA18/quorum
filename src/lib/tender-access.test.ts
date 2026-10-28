import { describe, expect, test } from "bun:test";
import {
  isSafeTenderRef,
  isTenderKeyFor,
  MAX_SIGNED_DOWNLOAD_TTL_MS,
  signTenderDownload,
  SIGNED_DOWNLOAD_TTL_MS,
  tenderDownloadFilename,
  verifyTenderDownload,
} from "@/lib/tender-access";

const REF = "KE-MOH-2026-117";
const KEY = `tenders/${REF}/1793216253256-audit-e2e.pdf`;
const USER = "u_test_officer";

function signed(overrides: { key?: string; ref?: string; expiresAt?: number; userId?: string } = {}) {
  const ref = overrides.ref ?? REF;
  const key = overrides.key ?? KEY;
  const expiresAt = overrides.expiresAt ?? Date.now() + SIGNED_DOWNLOAD_TTL_MS;
  const userId = overrides.userId ?? USER;
  return {
    ref,
    key,
    expiresAt,
    userId,
    signature: signTenderDownload(ref, key, expiresAt, userId),
  };
}

describe("signed tender downloads", () => {
  test("a fresh link for the same tender, key and user verifies", () => {
    const input = signed();
    expect(verifyTenderDownload(input)).toEqual({ ok: true });
  });

  test("changing the object key invalidates the signature", () => {
    const input = { ...signed(), key: `${KEY}.other` };
    expect(verifyTenderDownload(input)).toMatchObject({ ok: false, status: 403 });
  });

  test("changing the tender or the user invalidates the signature", () => {
    const input = signed();
    expect(verifyTenderDownload({ ...input, ref: "KE-MOH-2026-118" })).toMatchObject({ ok: false, status: 403 });
    expect(verifyTenderDownload({ ...input, userId: "u_someone_else" })).toMatchObject({ ok: false, status: 403 });
  });

  test("expiry is enforced, and returns 410 rather than leaking the object", () => {
    const expiresAt = Date.now() - 1;
    const input = signed({ expiresAt });
    expect(verifyTenderDownload(input)).toMatchObject({ ok: false, status: 410 });
  });

  test("a link may not carry a lifetime longer than the service allows", () => {
    const expiresAt = Date.now() + MAX_SIGNED_DOWNLOAD_TTL_MS + 60_000;
    const input = signed({ expiresAt });
    expect(verifyTenderDownload(input)).toMatchObject({ ok: false, status: 403 });
  });

  test("only keys directly under the tender's own prefix are accepted", () => {
    expect(isTenderKeyFor(REF, KEY)).toBe(true);
    expect(isTenderKeyFor(REF, `tenders/OTHER/${KEY.split("/").pop()}`)).toBe(false);
    expect(isTenderKeyFor(REF, `tenders/${REF}/../secret.pdf`)).toBe(false);
    expect(isTenderKeyFor(REF, `tenders/${REF}/`)).toBe(false);
    expect(isTenderKeyFor(REF, `other/${REF}/file.pdf`)).toBe(false);
  });

  test("tender references and attachment names are sanitized for headers", () => {
    expect(isSafeTenderRef(REF)).toBe(true);
    expect(isSafeTenderRef("../etc")).toBe(false);
    expect(isSafeTenderRef("")).toBe(false);
    expect(tenderDownloadFilename(KEY)).toBe("audit-e2e.pdf");
    expect(tenderDownloadFilename(`tenders/${REF}/1793216253256-bid\".pdf`)).toBe("bid-.pdf");
  });
});
