/**
 * Key custody — a receipt is only as trustworthy as the key that signs it.
 *
 * Proven here: GATE_SIGNING_KEY wins, an existing key file continues the
 * previous key, development may generate and keep a key, and production
 * without either is a refusal — an unmanaged signing key is how gate
 * receipts lose their evidentiality after the machine is lost.
 */

import { describe, expect, test } from "bun:test";
import { keyCustodyDecision, type KeyCustodyAction } from "./receipts";

describe("key custody decisions", () => {
  test("an injected (KMS) key always wins", () => {
    expect(keyCustodyDecision({ NODE_ENV: "production", GATE_SIGNING_KEY: "pem" }, false).action).toBe("ENV_KEY");
    expect(keyCustodyDecision({ NODE_ENV: "development", GATE_SIGNING_KEY: "pem" }, true).action).toBe("ENV_KEY");
  });

  test("an existing key file continues the same key in every environment", () => {
    expect(keyCustodyDecision({ NODE_ENV: "production" }, true).action).toBe("FILE_KEY");
    expect(keyCustodyDecision({}, true).action).toBe("FILE_KEY");
  });

  test("production without provisioned custody REFUSES to generate an unmanaged key", () => {
    const decision: KeyCustodyAction = keyCustodyDecision({ NODE_ENV: "production" }, false);
    expect(decision.action).toBe("REFUSE");
    if (decision.action === "REFUSE") {
      expect(decision.reason).toContain("GATE_SIGNING_KEY");
      expect(decision.reason).toContain("UNMANAGED");
    }
  });

  test("development still generates and keeps a key so the sandbox boots", () => {
    expect(keyCustodyDecision({ NODE_ENV: "development" }, false).action).toBe("GENERATE_DEV");
    expect(keyCustodyDecision({}, false).action).toBe("GENERATE_DEV");
  });
});
