import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SimulatedEgpAdapter, type EgpSubmission } from "./egp-adapter";

const submission: EgpSubmission = {
  idempotencyKey: "gate:gate_test_01:filing",
  gateId: "gate_test_01",
  tenderId: "KE-MOH-2026-117",
  bundleHash: "a".repeat(64),
  approvedBy: "Independent Officer",
  approvedAt: "2026-11-03T10:00:00.000Z",
};

describe("e-GP adapter contract: simulated transport", () => {
  test("retries return one persistent, clearly simulated receipt", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "quorum-egp-"));
    try {
      const adapter = new SimulatedEgpAdapter(dir);
      const first = await adapter.submit(submission);
      const second = await new SimulatedEgpAdapter(dir).submit(submission);
      expect(first).toEqual(second);
      expect(first.simulated).toBe(true);
      expect(first.status).toBe("SIMULATED");
      expect(first.portal).toContain("simulation only");
      const files = await (await import("node:fs/promises")).readdir(dir);
      expect(files).toHaveLength(1);
      const saved = JSON.parse(await readFile(path.join(dir, files[0]), "utf8"));
      expect(saved.submission.gateId).toBe(submission.gateId);
      expect(saved.receipt).toEqual(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a key cannot silently be reused for a different tender bundle", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "quorum-egp-"));
    try {
      const adapter = new SimulatedEgpAdapter(dir);
      await adapter.submit(submission);
      await expect(adapter.submit({ ...submission, bundleHash: "b".repeat(64) })).rejects.toThrow("already used");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("concurrent retries share one operation and receipt", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "quorum-egp-"));
    try {
      const adapter = new SimulatedEgpAdapter(dir);
      const results = await Promise.all([adapter.submit(submission), adapter.submit(submission)]);
      expect(results[0]).toEqual(results[1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
