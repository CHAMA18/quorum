import { describe, expect, test } from "bun:test";
import { bidReviewEvidenceSummary, validateBidReviewGrounding, type GroundedBidAssessment, type BidReviewSource } from "./bid-review-grounding";

const sources: BidReviewSource = { bidders: [
  { bidder: "Demo Clinic Supplies", criteria: [{ id: "delivery" }], documents: [{ citation: "bid-a.md", text: "Delivery is committed within 30 days." }] },
  { bidder: "Demo Medical Works", criteria: [{ id: "delivery" }], documents: [{ citation: "bid-b.md", text: "Delivery will be agreed later." }] },
] };
function valid(): GroundedBidAssessment {
  return { recommendation: { bidder: "Demo Clinic Supplies" }, bidders: [
    { bidder: "Demo Clinic Supplies", criteria: [{ criterionId: "delivery", alignment: "SUPPORTED", evidence: [{ citation: "bid-a.md", quote: "Delivery is committed within 30 days." }] }] },
    { bidder: "Demo Medical Works", criteria: [{ criterionId: "delivery", alignment: "NOT_EVIDENCED", evidence: [] }] },
  ] };
}
describe("bid review source grounding", () => {
  test("accepts a quoted positive assessment and an explicit missing-evidence result", () => {
    expect(validateBidReviewGrounding(valid(), sources)).toBeNull();
    expect(bidReviewEvidenceSummary(valid())).toEqual({ policy: "exact-source-match", verifiedQuotes: 1, criteriaAssessed: 2, criteriaWithQuotes: 1 });
  });
  test("refuses a positive assessment with no source quote", () => {
    const result = valid(); result.bidders[0].criteria[0].evidence = [];
    expect(validateBidReviewGrounding(result, sources)).toContain("supported without source evidence");
  });
  test("refuses invented quotations", () => {
    const result = valid(); result.bidders[0].criteria[0].evidence[0].quote = "Delivery is guaranteed in 2 days.";
    expect(validateBidReviewGrounding(result, sources)).toContain("unsupported source quote");
  });
  test("a quote from another bidder cannot support this bidder", () => {
    const result = valid(); result.bidders[0].criteria[0].evidence = [{ citation: "bid-b.md", quote: "Delivery will be agreed later." }];
    expect(validateBidReviewGrounding(result, sources)).toContain("unsupported source quote");
  });
  test("refuses omitted bidders, duplicate criteria and unknown recommendations", () => {
    const omitted = valid(); omitted.bidders.pop();
    expect(validateBidReviewGrounding(omitted, sources)).toContain("every admitted bidder");
    const unknown = valid(); unknown.bidders[0].criteria[0].criterionId = "invented";
    expect(validateBidReviewGrounding(unknown, sources)).toContain("issued matrix");
    const outsider = valid(); outsider.recommendation.bidder = "Outsider";
    expect(validateBidReviewGrounding(outsider, sources)).toContain("outside the certified opening register");
  });
  test("refuses recommending a bidder whose criteria have no supporting evidence", () => {
    const result = valid(); result.recommendation.bidder = "Demo Medical Works";
    expect(validateBidReviewGrounding(result, sources)).toContain("without any supported source evidence");
  });
  test("permits abstention when neither bidder has supporting evidence", () => {
    const result = valid(); result.recommendation.bidder = null;
    result.bidders[0].criteria[0] = { criterionId: "delivery", alignment: "UNCLEAR", evidence: [] };
    expect(validateBidReviewGrounding(result, sources)).toBeNull();
  });
});
