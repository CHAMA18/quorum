/** Validate the model's evidence against the exact bidder documents sent to it.
 * An exact quote proves the source exists; it does not prove the assessment's
 * legal or semantic correctness. Officers still review the reasoning. */
export interface GroundedBidAssessment {
  recommendation: { bidder: string | null };
  bidders: {
    bidder: string;
    criteria: {
      criterionId: string;
      alignment: "SUPPORTED" | "PARTIAL" | "NOT_EVIDENCED" | "UNCLEAR";
      evidence: { citation: string; quote: string }[];
    }[];
  }[];
}

export interface BidReviewSource {
  bidders: { bidder: string; criteria: { id: string }[]; documents: { citation: string; text: string }[] }[];
}

export function validateBidReviewGrounding(result: GroundedBidAssessment, input: BidReviewSource): string | null {
  const expectedBidders = new Map(input.bidders.map((bid) => [bid.bidder.toLowerCase(), bid]));
  if (result.bidders.length !== expectedBidders.size) return "Meta AI did not assess every admitted bidder.";
  const seenBidders = new Set<string>();
  for (const assessed of result.bidders) {
    const key = assessed.bidder.toLowerCase();
    const sourceBid = expectedBidders.get(key);
    if (!sourceBid || seenBidders.has(key)) return "Meta AI returned a bidder that does not match the certified opening register.";
    seenBidders.add(key);
    const expectedCriteria = new Set(sourceBid.criteria.map((criterion) => criterion.id));
    const seenCriteria = new Set<string>();
    if (assessed.criteria.length !== expectedCriteria.size) return `Meta AI did not assess every published criterion for ${assessed.bidder}.`;
    for (const criterion of assessed.criteria) {
      if (!expectedCriteria.has(criterion.criterionId) || seenCriteria.has(criterion.criterionId)) {
        return `Meta AI returned criteria that do not match the issued matrix for ${assessed.bidder}.`;
      }
      seenCriteria.add(criterion.criterionId);
      if ((criterion.alignment === "SUPPORTED" || criterion.alignment === "PARTIAL") && !criterion.evidence.length) {
        return `Meta AI marked a criterion supported without source evidence for ${assessed.bidder}. The assessment was not shown.`;
      }
      for (const evidence of criterion.evidence) {
        const source = sourceBid.documents.find((document) => document.citation === evidence.citation);
        if (!evidence.quote.trim() || !source || !source.text.includes(evidence.quote)) {
          return `Meta AI returned an unsupported source quote for ${assessed.bidder}. The assessment was not shown.`;
        }
      }
    }
  }
  if (result.recommendation.bidder) {
    const key = result.recommendation.bidder.toLowerCase();
    if (!expectedBidders.has(key)) return "Meta AI recommended a bidder outside the certified opening register. The assessment was not shown.";
    const assessed = result.bidders.find((bidder) => bidder.bidder.toLowerCase() === key);
    if (!assessed?.criteria.some((criterion) =>
      (criterion.alignment === "SUPPORTED" || criterion.alignment === "PARTIAL") && criterion.evidence.length > 0,
    )) return "Meta AI recommended a bidder without any supported source evidence. The assessment was not shown.";
  }
  return null;
}

export function bidReviewEvidenceSummary(result: GroundedBidAssessment) {
  const criteria = result.bidders.flatMap((bidder) => bidder.criteria);
  return {
    policy: "exact-source-match" as const,
    verifiedQuotes: criteria.reduce((count, criterion) => count + criterion.evidence.length, 0),
    criteriaAssessed: criteria.length,
    criteriaWithQuotes: criteria.filter((criterion) => criterion.evidence.length > 0).length,
  };
}
