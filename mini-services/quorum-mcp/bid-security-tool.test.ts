import { describe, expect, it } from "bun:test";
import { checkBidSecurities } from "./engine";

const bid = (securityLine: string) => ({ bidder: "Bidder", text: `Bid\n**Bid security:** ${securityLine}`, source: "bid.md" });

describe("checkBidSecurities", () => {
  it("marks a security with enough margin OK", () => {
    const [s] = checkBidSecurities([bid("KES 5,000,000 valid until 2027-03-15")], "2027-01-30");
    expect(s.status).toBe("OK");
    expect(s.validUntil).toBe("2027-03-15");
    expect(s.daysBeyondClosing).toBe(44);
  });

  it("flags short margin as EXPIRING_SOON and past validity as EXPIRED", () => {
    const [soon] = checkBidSecurities([bid("KES 5,000,000 valid until 2027-02-10")], "2027-01-30");
    expect(soon.status).toBe("EXPIRING_SOON");
    const [gone] = checkBidSecurities([bid("KES 5,000,000 valid until 2027-02-10")], "2027-01-30", { asOf: "2027-03-01" });
    expect(gone.status).toBe("EXPIRED");
  });

  it("distinguishes missing, unspecified and not-required", () => {
    const [missing] = checkBidSecurities([{ bidder: "B", text: "no security here", source: "b.md" }], "2027-01-30", { required: true });
    expect(missing.status).toBe("MISSING");
    const [open] = checkBidSecurities([{ bidder: "B", text: "no security here", source: "b.md" }], "2027-01-30");
    expect(open.status).toBe("NOT_REQUIRED");
    const [unspec] = checkBidSecurities([bid("KES 5,000,000")], "2027-01-30");
    expect(unspec.status).toBe("UNSPECIFIED");
  });
});
