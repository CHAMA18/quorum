import type { Guards } from "./store";

/**
 * The published rule register.
 *
 * One source of truth for the documentation, the API and the acceptance test.
 * Thresholds are interpolated from the live guards, never copied into prose —
 * a 25% variance guard must never be described as "two times".
 */

export type RuleSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface RuleCatalogueRow {
  id: string;
  severity: RuleSeverity;
  catches: string;
  action: string;
}

export type RuleGuardView = Pick<Guards, "priceVariancePct" | "checklist" | "registryCrossCheck">;

export function buildRuleCatalogue(guards: RuleGuardView): RuleCatalogueRow[] {
  const variance = guards.priceVariancePct;
  const checklist = guards.checklist === "STRICT" ? "Strict" : "Standard";
  const registry = guards.registryCrossCheck ? "on" : "off";

  return [
    {
      id: "R-DOC-MISSING",
      severity: "MEDIUM",
      catches: `${checklist} checklist — a document the notice lists as REQUIRED that a bid never references.`,
      action: "Ask the bidder to supply it, or mark the bid non-responsive.",
    },
    {
      id: "R-SUPPLIER-ID",
      severity: "HIGH",
      catches: "A supplier identifier that breaks its own national scheme — or a line that states none at all.",
      action: "Verify the identifier against the registry before relying on the bid.",
    },
    {
      id: "R-BUYER-MISSING",
      severity: "MEDIUM",
      catches: "A tender notice that never names the buyer.",
      action: "Trace the buyer to the record; a notice nobody owns is a governance gap.",
    },
    {
      id: "R-AWARD-OVER-BUDGET",
      severity: "HIGH",
      catches: "An OCDS award value above the published tender value.",
      action: "Review the justification before any award moves.",
    },
    {
      id: "R-PRICE-OUTLIER",
      severity: "HIGH",
      catches: `A unit price ${variance}% or more above the peer median on the same line item.`,
      action: "Check the arithmetic and the specification; outliers concentrate abuse.",
    },
    {
      id: "R-SPEC-DEVIATION",
      severity: "HIGH",
      catches: "Bid lines offering alternatives, requesting deviations or stating non-compliance.",
      action: "Weigh the deviation against the specification before scoring.",
    },
    {
      id: "R-VALUE-OUTLIER",
      severity: "HIGH",
      catches: "A bid value more than twice the median of its peers.",
      action: "Confirm the scope is comparable before treating the bid as competitive.",
    },
    {
      id: "R-OVER-BUDGET",
      severity: "HIGH",
      catches: "A bid value above the budget ceiling parsed from the notice — including currency mismatches.",
      action: "A bid above the ceiling cannot be awarded without a lawful revision of the budget.",
    },
    {
      id: "R-BID-SECURITY",
      severity: "HIGH",
      catches: "A bid whose security is absent, below the stated floor or expires inside the validity margin.",
      action: "Treat the bid as administratively non-responsive unless the notice allows a cure.",
    },
    {
      id: "R-REGISTRY-STATUS",
      severity: "HIGH",
      catches: `Registry cross-check is ${registry} — a bidder whose registration status does not match the open register.`,
      action: "Confirm the registry record before evaluation; a mismatch is a question for the bidder.",
    },
    {
      id: "R-DEBARMENT-HIT",
      severity: "HIGH",
      catches: "A bidder that appears on the debarment register.",
      action: "Treat the bid as administratively non-responsive and record the screening source.",
    },
    {
      id: "R-PROMPT-INJECTION",
      severity: "HIGH",
      catches: "A document that tries to instruct the agent — hidden text, fake system prompts or tool names.",
      action: "Treat the document as untrusted evidence; never let it alter scores, findings or a gate.",
    },
  ];
}
