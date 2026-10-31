import { describe, expect, test } from "bun:test";
import { bidCommitment, formatPriceRead, reconcileOpening, revealBid, sealBid, verifyBidReceipt } from "./bid-vault";
import type { SupplierApplication } from "./store";

function filed(overrides: Partial<SupplierApplication> = {}): SupplierApplication {
  const envelope = sealBid({
    tenderId: "T-VAULT",
    orgId: "org-1",
    orgName: "Acme Ltd",
    amount: 1_250_000,
    currency: "ZMW",
  });
  return {
    id: "app_1",
    tenderId: "T-VAULT",
    orgId: "org-1",
    orgName: "Acme Ltd",
    actor: "org:Acme Ltd",
    registrationNo: "PACRA-1",
    sealed: envelope,
    receiptId: envelope.receipt.id,
    version: 1,
    receivedAt: envelope.sealedAt,
    status: "RECEIVED",
    ...overrides,
  };
}

describe("sealed bid vault", () => {
  test("seals the price, signs the receipt and reveals the identical payload", () => {
    const application = filed();
    expect(application.amount).toBeUndefined();
    expect(application.sealed?.ciphertext).toBeTruthy();
    expect(verifyBidReceipt(application.sealed!.receipt)).toBe(true);
    const revealed = revealBid(application.sealed!);
    expect(revealed.amount).toBe(1_250_000);
    expect(revealed.currency).toBe("ZMW");
    expect(formatPriceRead(revealed)).toBe("ZMW 1,250,000");
    expect(application.sealed!.commitment).toBe(
      bidCommitment({
        tenderId: "T-VAULT",
        orgId: "org-1",
        orgName: "Acme Ltd",
        amount: 1_250_000,
        currency: "ZMW",
      }),
    );
  });

  test("a tampered ciphertext fails authentication instead of yielding a wrong price", () => {
    const application = filed();
    const envelope = { ...application.sealed!, ciphertext: Buffer.from("not the sealed payload").toString("base64") };
    expect(() => revealBid(envelope)).toThrow(/authentication/);
  });

  test("a forged receipt is refused before decryption", () => {
    const application = filed();
    const envelope = { ...application.sealed!, receipt: { ...application.sealed!.receipt, orgName: "Someone Else" } };
    expect(verifyBidReceipt(envelope.receipt)).toBe(false);
    expect(() => revealBid(envelope)).toThrow(/receipt signature/);
  });

  test("reconciliation requires every sealed envelope and every register row to match", () => {
    const application = filed();
    const row = {
      bidder: "Acme Ltd",
      applicationId: application.id,
      receiptId: application.receiptId,
    };
    expect(reconcileOpening([application], [row])).toMatchObject({ matches: true, sealed: 1, derived: 1 });
    expect(reconcileOpening([application], [])).toMatchObject({ matches: false, sealed: 1, derived: 0 });
    expect(reconcileOpening([application], [{ bidder: "Paper Co" }])).toMatchObject({
      matches: false,
      manual: 1,
      missingFromRegister: ["Acme Ltd (app_1)"],
    });
  });

  test("a withdrawn sealed bid is excluded from the received count", () => {
    const application = filed();
    const withdrawn = { ...application, status: "WITHDRAWN" as const };
    expect(reconcileOpening([withdrawn], [])).toMatchObject({ matches: true, sealed: 0, withdrawn: 1 });
  });
});
