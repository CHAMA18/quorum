import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendDecision, readLedger, verifyLedger } from "./decisions-ledger";

describe("decision ledger idempotency", () => {
  test("a retry returns the original line and preserves one hash-chain act", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "quorum-decisions-"));
    const file = path.join(dir, "decisions.jsonl");
    const input = {
      gateId: "gate_123",
      tenderId: "KE-MOH-2026-117",
      workspaceId: "workspace_1",
      actor: "Officer One",
      decision: "APPROVE" as const,
      gateStatus: "EXECUTED",
      idempotencyKey: "gate:gate_123:approve:officer-one",
    };
    try {
      const first = appendDecision(file, input);
      const retry = appendDecision(file, input);
      const rows = readLedger(file);
      expect(retry).toEqual(first);
      expect(rows).toHaveLength(1);
      expect(verifyLedger(rows).ok).toBe(true);
      expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reusing a decision key for another act fails closed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "quorum-decisions-"));
    const file = path.join(dir, "decisions.jsonl");
    try {
      appendDecision(file, {
        gateId: "gate_123", tenderId: "T-1", workspaceId: "workspace_1", actor: "Officer One",
        decision: "APPROVE", gateStatus: "EXECUTED", idempotencyKey: "one-key",
      });
      expect(() => appendDecision(file, {
        gateId: "gate_456", tenderId: "T-2", workspaceId: "workspace_1", actor: "Officer One",
        decision: "APPROVE", gateStatus: "EXECUTED", idempotencyKey: "one-key",
      })).toThrow("different act");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
