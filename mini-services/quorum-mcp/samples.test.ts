import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPack } from "./engine";
import { SAMPLE_TENDERS } from "./samples";

/* The shipped packs, not the sandboxed data dir the preload points the store
   at — this test is about the files that travel with the repository. */
const PACKS = join(import.meta.dir, "data", "tenders");

async function packFor(ref: string) {
  const dir = join(PACKS, ref);
  const files = (await readdir(dir)).filter((f) => !f.startsWith("."));
  const sources: Record<string, string> = {};
  for (const f of files) sources[f] = await readFile(join(dir, f), "utf8").catch(() => "");
  return { files, pack: buildPack(files, sources) };
}

describe("sample tender metadata", () => {
  test("every advertised bidder count is its pack's real distinct-firm count", async () => {
    for (const sample of SAMPLE_TENDERS) {
      const { pack } = await packFor(sample.ref);
      expect({ ref: sample.ref, bidders: pack.bidders }).toEqual({ ref: sample.ref, bidders: sample.bids });
      /* These packs file one document per firm, so documents and bidders agree.
         If a pack ever carries two documents from one firm, this is the line
         that notices the difference. */
      expect({ ref: sample.ref, documents: pack.bids.length }).toEqual({ ref: sample.ref, documents: sample.bids });
    }
  });

  test("a supporting document in a real pack is never counted as a bidder", async () => {
    const { files, pack } = await packFor("KE-MOH-2026-117");
    expect(files).toContain("91-addendum-r2-gate-verification.md");
    expect(pack.bids).toHaveLength(2);
    expect(pack.bidders).toBe(2);
  });
});
