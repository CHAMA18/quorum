import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deleteLocalObject,
  hasLocalObject,
  listLocalObjects,
  localStorageRoot,
  putLocalObject,
  readLocalObject,
} from "./tender-local-store";

/**
 * The local tender store is the fallback that keeps a Deployment working
 * without the edge bucket, so its two promises are tested directly: bytes
 * round-trip through key validation, and nothing can escape the tender's
 * directory.
 */

const roots: string[] = [];
let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "quorum-docs-"));
  roots.push(root);
  process.env.QUORUM_DOCS_DIR = root;
});

afterAll(() => {
  delete process.env.QUORUM_DOCS_DIR;
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const REF = "ZM-2026-001";

function keyFor(name: string): string {
  return `tenders/${REF}/${Date.now()}-${name}`;
}

describe("local tender store", () => {
  test("stores, lists, reads and deletes one object", async () => {
    expect(localStorageRoot()).toBe(path.resolve(root));
    const key = keyFor("notice.pdf");
    const stored = await putLocalObject(REF, key, new Uint8Array([1, 2, 3, 4]), "application/pdf");

    expect(stored.key).toBe(key);
    expect(stored.bytes).toBe(4);
    expect(stored.filename).toBe("notice.pdf");
    expect(stored.contentType).toBe("application/pdf");
    expect(await hasLocalObject(REF, key)).toBe(true);

    const listed = await listLocalObjects(REF);
    expect(listed.map((object) => object.key)).toEqual([key]);

    const read = await readLocalObject(REF, key);
    expect(read).not.toBeNull();
    expect(Array.from(read!.bytes)).toEqual([1, 2, 3, 4]);
    expect(read!.contentType).toBe("application/pdf");

    expect(await deleteLocalObject(REF, key)).toBe(true);
    expect(await hasLocalObject(REF, key)).toBe(false);
    expect(await readLocalObject(REF, key)).toBeNull();
    expect(await deleteLocalObject(REF, key)).toBe(false);
  });

  test("keeps a per-tender index that a fresh read relies on", async () => {
    const first = keyFor("notice.pdf");
    const second = keyFor("bids.xlsx");
    await putLocalObject(
      REF,
      first,
      new Uint8Array([1]),
      "application/pdf",
    );
    await putLocalObject(
      REF,
      second,
      new Uint8Array([2, 2]),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const indexPath = path.join(root, "tenders", REF, ".index.json");
    expect(existsSync(indexPath)).toBe(true);

    const listed = await listLocalObjects(REF);
    expect(listed).toHaveLength(2);
    expect(listed.map((object) => object.key).sort()).toEqual([first, second].sort());
    for (const object of listed) {
      expect(object.uploaded).toBeTruthy();
      expect(object.etag).toMatch(/^"[0-9a-f]{32}"$/);
    }

    /* A second read finds the same descriptions, not freshly guessed ones. */
    const again = await listLocalObjects(REF);
    expect(again.map((object) => object.etag)).toEqual(listed.map((object) => object.etag));
  });

  test("describes files on disk when the index is missing", async () => {
    const dir = path.join(root, "tenders", REF);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "1700000000000-notice.txt"), "notice text");

    const listed = await listLocalObjects(REF);
    expect(listed).toHaveLength(1);
    expect(listed[0].key).toBe(`tenders/${REF}/1700000000000-notice.txt`);
    expect(listed[0].bytes).toBe(Buffer.byteLength("notice text"));
    expect(listed[0].contentType).toBe("text/plain");
  });

  test("refuses a key outside the tender's prefix", async () => {
    const store = localStorageRoot();
    const foreign = "tenders/ZM-2026-999/1700000000000-notice.pdf";
    await expect(
      putLocalObject(REF, foreign, new Uint8Array([1]), "application/pdf"),
    ).rejects.toThrow("storage prefix");

    expect(await hasLocalObject(REF, foreign)).toBe(false);
    expect(await readLocalObject(REF, foreign)).toBeNull();
    expect(await deleteLocalObject(REF, foreign)).toBe(false);
    expect(existsSync(path.join(store, "tenders", "ZM-2026-999"))).toBe(false);
    expect(await listLocalObjects(REF)).toEqual([]);
  });

  test("refuses traversal out of the tender's directory", async () => {
    const escaped = `tenders/${REF}/../escape.pdf`;
    await expect(
      putLocalObject(REF, escaped, new Uint8Array([1]), "application/pdf"),
    ).rejects.toThrow();

    const nested = `tenders/${REF}/../../escape.pdf`;
    expect(await hasLocalObject(REF, nested)).toBe(false);
    expect(await readLocalObject(REF, nested)).toBeNull();
    expect(existsSync(path.join(root, "tenders", "escape.pdf"))).toBe(false);
    expect(existsSync(path.join(root, "escape.pdf"))).toBe(false);
  });
});
