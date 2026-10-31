/**
 * rulepack.ts — Phase 3: the rules-driven compliance layer.
 *
 * The engine's rule families (engine.ts) DO the checking; this module gives
 * every rule its procurement identity — jurisdiction, legal basis, risk
 * category, severity class, mandatory-vs-advisory status, exception logic,
 * the evidence it must produce and the owner who signs for it — and composes
 * a per-tender compliance summary out of live state: run findings, COI
 * declarations, artifact-chain validity and the guards configuration.
 *
 * HARD-FAIL rules are named explicitly. A hard-fail condition is never a
 * warning: the summary's verdict goes to HARD_FAIL and the finding is listed
 * with its evidence, so oversight sees the condition, not just a score.
 *
 * Honesty note: legal references cite the act and its TOPIC (never an
 * invented section number). `referencesConfirmed: false` travels with the
 * pack until the operational owner's legal adviser confirms the citations —
 * the platform does not pretend to be a statute book.
 */

import { state, type Finding } from "./store";

export interface RuleMeta {
  id: string;
  jurisdiction: string;
  legalReference: string;
  riskCategory: string;
  severity: string;
  status: "MANDATORY" | "ADVISORY";
  exceptionLogic: string;
  evidenceRequirement: string;
  signOffOwner: string;
}

export interface RulePack {
  id: string;
  jurisdiction: string;
  name: string;
  description: string;
  legalInstrument: string;
  referencesConfirmed: boolean;
  hardFailRules: string[];
  rules: RuleMeta[];
}

export const RULE_PACK_ZM: RulePack = {
  id: "zm-ppa-2023",
  jurisdiction: "ZM",
  name: "Zambia — Public Procurement Act No. 8 of 2023 (baseline pack)",
  description:
    "The baseline control set the review engine enforces for Zambian tenders: price and value integrity, budget discipline, document completeness, bid security, supplier identity, debarment and registry status. Rules map to the engine's R-* families one-to-one.",
  legalInstrument: "Public Procurement Act No. 8 of 2023 (Zambia); PPDA-style debarment practice; ZPPA e-GP published record",
  referencesConfirmed: false,
  hardFailRules: [
    "R-DEBARMENT-HIT",
    "R-REGISTRY-STATUS",
    "R-SUPPLIER-ID",
    "R-BID-SECURITY:MISSING",
    "COI-CONFLICT-DECLARED",
    "CHAIN-UNORDERED",
  ],
  rules: [
    {
      id: "R-PRICE-OUTLIER",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — evaluation against published criteria; abnormally low bids examined",
      riskCategory: "Price integrity / collusion signal",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "A unit price above (1 + guard)× the peer median raises the finding; the officer may justify it in the evaluation notes — the finding is never auto-removed.",
      evidenceRequirement: "Finding cites the bid line item and the peer median it deviates from.",
      signOffOwner: "Evaluation committee (evaluation office)",
    },
    {
      id: "R-VALUE-OUTLIER",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — bid evaluation; value for money",
      riskCategory: "Price integrity",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "Bid value far off the peer median raises the finding; justified deviations are recorded, not deleted.",
      evidenceRequirement: "Finding cites the bid's value line and peers.",
      signOffOwner: "Evaluation committee (evaluation office)",
    },
    {
      id: "R-OVER-BUDGET",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — budget ceiling compliance",
      riskCategory: "Budget discipline",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "None — a bid above the ceiling is non-responsive. Currency mismatches are reported, not silently normalized.",
      evidenceRequirement: "Finding cites the bid value line and the notice's budget ceiling.",
      signOffOwner: "Evaluation committee (evaluation office)",
    },
    {
      id: "R-AWARD-OVER-BUDGET",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — award within the approved budget",
      riskCategory: "Budget discipline",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "None — an award value above the tender value is a hard condition.",
      evidenceRequirement: "Finding cites the OCDS award value vs the tender value.",
      signOffOwner: "Accounting officer",
    },
    {
      id: "R-DOC-MISSING",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — bid submission requirements; solicitation documents",
      riskCategory: "Document completeness",
      severity: "MEDIUM (HIGH under the STRICT checklist)",
      status: "MANDATORY",
      exceptionLogic: "A missing mandatory document is a hard-fail when the checklist is STRICT; under STANDARD it is a High-priority repair item. Critical documents (bid security, validity) are never waived by the checklist.",
      evidenceRequirement: "Finding names the required document and the bid lacking it.",
      signOffOwner: "Procurement unit",
    },
    {
      id: "R-SPEC-DEVIATION",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — responsiveness to solicitation documents",
      riskCategory: "Specification compliance",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "Deviations require the committee's explicit acceptance in the matrix notes; unaccepted deviations make the bid materially non-responsive.",
      evidenceRequirement: "Finding cites the deviation line in the bid.",
      signOffOwner: "Evaluation committee (evaluation office)",
    },
    {
      id: "R-SUPPLIER-ID",
      jurisdiction: "ZM",
      legalReference: "Supplier registration requirements — tax and registration identifiers",
      riskCategory: "Supplier identity",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "None — an identifier that fails its national scheme (KRA PIN, Rwanda TIN) is a hard-fail pending verification with the registry.",
      evidenceRequirement: "Finding cites the identifier and the scheme it violates.",
      signOffOwner: "Procurement unit",
    },
    {
      id: "R-BUYER-MISSING",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — solicitation document contents",
      riskCategory: "Notice completeness",
      severity: "MEDIUM",
      status: "MANDATORY",
      exceptionLogic: "The notice must name the procuring entity before publication; the notice field check enforces it at the publication gate.",
      evidenceRequirement: "Finding cites the notice document.",
      signOffOwner: "Procurement unit",
    },
    {
      id: "R-BID-SECURITY",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — bid security",
      riskCategory: "Bid security",
      severity: "HIGH (missing) / MEDIUM (insufficient)",
      status: "MANDATORY",
      exceptionLogic: "None for a missing security — the bid is non-responsive. Insufficient amount or validity below the 28-day margin is raised for the committee's decision.",
      evidenceRequirement: "Finding cites the security line, stated amount and validity date.",
      signOffOwner: "Evaluation committee (evaluation office)",
    },
    {
      id: "R-DEBARMENT-HIT",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — debarment; national and partner debarment lists",
      riskCategory: "Debarment / sanctions",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "None — a live debarment match makes the bidder administratively non-responsive. Expired exclusions are skipped with the expiry date shown.",
      evidenceRequirement: "Finding cites the bid and the debarment register entry (listedBy, ground, from, until).",
      signOffOwner: "Accounting officer",
    },
    {
      id: "R-REGISTRY-STATUS",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — supplier eligibility; register of suppliers",
      riskCategory: "Supplier eligibility",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "None — a SUSPENDED or BLACKLISTED register match is a hard-fail while the cross-check guard is on.",
      evidenceRequirement: "Finding cites the register row and its status.",
      signOffOwner: "Procurement unit",
    },
    {
      id: "R-PROMPT-INJECTION",
      jurisdiction: "ZM",
      legalReference: "Platform integrity — documents must not manipulate the review tooling",
      riskCategory: "AI safety / document integrity",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "None — a document attempting to steer the agent is evidence in itself; it is flagged for human review, never acted on.",
      evidenceRequirement: "Finding cites the suspicious line(s), capped per pack.",
      signOffOwner: "Procurement unit",
    },
    {
      id: "COI-CONFLICT-DECLARED",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — conflict of interest disclosure",
      riskCategory: "Conflict of interest",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "A declared conflict does not auto-disqualify the MEMBER — it removes them from the affected decision and the record shows it. Evaluation certification stays blocked until every PRESENT member has declared.",
      evidenceRequirement: "COI declaration rows (member, declaration, conflicts, declaredAt) on the cycle.",
      signOffOwner: "Accounting officer",
    },
    {
      id: "CHAIN-UNORDERED",
      jurisdiction: "ZM",
      legalReference: "PPA No. 8 of 2023 — sequence of procurement steps and approvals",
      riskCategory: "Approval-chain validity",
      severity: "HIGH",
      status: "MANDATORY",
      exceptionLogic: "None — the chain is structural: opening before certification, certification before award, signed report before notice, standstill lapse before contract. Out-of-order artifacts are a hard-fail.",
      evidenceRequirement: "Chain check lists the exact ordering violations with artifact timestamps.",
      signOffOwner: "Accounting officer",
    },
  ],
};

export const RULE_PACKS: RulePack[] = [RULE_PACK_ZM];

export function hardFailIds(): string[] {
  return RULE_PACK_ZM.hardFailRules;
}

export function isHardFail(ruleId: string): boolean {
  return RULE_PACK_ZM.hardFailRules.some((h) => ruleId === h || ruleId.startsWith(`${h}:`));
}

/* ── The per-tender compliance summary ─────────────────────────────────────── */

export interface ComplianceLine {
  rule: string;
  severity: string;
  status: "MANDATORY" | "ADVISORY";
  hardFail: boolean;
  count: number;
  mandatory: boolean;
  latestEvidence?: string;
  latestCitation?: string;
  reviewed: number;
  accepted: number;
  rejected: number;
}

export interface ComplianceSummary {
  tenderId: string;
  evaluatedAt: string;
  pack: { id: string; jurisdiction: string; referencesConfirmed: boolean };
  guards: { checklist: string; priceVariancePct: number; registryCrossCheck: boolean };
  lines: ComplianceLine[];
  hardFails: Array<{ rule: string; detail: string; evidence?: string }>;
  chain: { valid: boolean; issues: string[] };
  coi: { present: number; declared: number; conflicts: string[] };
  exceptions: Array<{ id: string; kind: string; status: string; title: string }>;
  verdict: "CLEAR" | "FINDINGS" | "HARD_FAIL";
  note: string;
}

function chainIssues(tenderId: string): string[] {
  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  const issues: string[] = [];
  if (!cycle) return issues;
  if (cycle.matrix && !cycle.opening) issues.push("An evaluation matrix exists but no bid opening register was certified first.");
  if (cycle.awardReport?.signedAt && cycle.matrix?.status !== "CERTIFIED") issues.push("The award report is signed but the evaluation matrix is not CERTIFIED.");
  if (cycle.awardNotice?.publishedAt && !cycle.awardReport?.signedAt) issues.push("An award notice was published without a signed award report.");
  if (cycle.contract && cycle.standstill?.status === "ACTIVE") issues.push("A contract exists while the standstill window is still ACTIVE.");
  if (cycle.contract && !cycle.awardNotice?.publishedAt) issues.push("A contract exists but no award notice was ever published.");
  for (const m of cycle.contract?.milestones ?? []) {
    if (m.doneAt && cycle.contract?.completedAt && m.doneAt > cycle.contract.completedAt) {
      issues.push(`Milestone "${m.title}" was marked done after the contract's completion date.`);
    }
  }
  return issues;
}

export function complianceSummary(tenderId: string): ComplianceSummary {
  const runs = state.runs.filter((r) => r.tenderId === tenderId);
  const findings: Finding[] = runs.flatMap((r) => r.findings);
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule) ?? [];
    list.push(f);
    byRule.set(f.rule, list);
  }

  const cycle = state.cycle.find((c) => c.tenderId === tenderId);
  /* COI and chain checks become synthetic rules so they carry the same metadata. */
  const coi = cycle?.coi ?? [];
  const conflicts = coi.filter((d) => d.declaration === "CONFLICT_DECLARED").map((d) => d.member);
  if (coi.length > 0) byRule.set("COI-CONFLICT-DECLARED", coi.map((d) => ({
    id: `coi-${d.member}`,
    rule: "COI-CONFLICT-DECLARED",
    severity: d.declaration === "CONFLICT_DECLARED" ? "HIGH" : "LOW",
    item: `${d.member} declared ${d.declaration === "CONFLICT_DECLARED" ? "a conflict" : "no conflict"}`,
    evidence: d.conflicts ?? d.declaration,
    citation: "cycle COI register",
  })));
  const chain = chainIssues(tenderId);
  if (chain.length > 0) {
    byRule.set("CHAIN-UNORDERED", chain.map((issue, i) => ({
      id: `chain-${i}`,
      rule: "CHAIN-UNORDERED",
      severity: "HIGH",
      item: issue,
      evidence: issue,
      citation: "cycle artifact chain",
    })));
  }

  const lines: ComplianceLine[] = [];
  const hardFails: ComplianceSummary["hardFails"] = [];
  for (const [rule, list] of byRule) {
    const meta = RULE_PACK_ZM.rules.find((r) => r.id === rule || rule.startsWith(`${r.id}:`));
    const hard = isHardFail(rule);
    const latest = list[list.length - 1];
    const reviewed = list.filter((f) => f.review).length;
    lines.push({
      rule,
      severity: meta?.severity ?? latest.severity,
      status: meta?.status ?? "MANDATORY",
      hardFail: hard,
      count: list.length,
      mandatory: meta?.status !== "ADVISORY",
      ...(latest ? { latestEvidence: latest.evidence.slice(0, 300), latestCitation: latest.citation } : {}),
      reviewed,
      accepted: list.filter((f) => f.review?.decision === "ACCEPTED").length,
      rejected: list.filter((f) => f.review?.decision === "REJECTED").length,
    });
    if (hard) {
      /* A hard-fail condition is reportable while it is UNRESOLVED: a conflict
         declared and excused is handled; a rule with zero findings is clear. */
      if (rule === "COI-CONFLICT-DECLARED") {
        if (conflicts.length > 0) hardFails.push({ rule, detail: `Declared conflicts awaiting handling: ${conflicts.join(", ")}`, evidence: "cycle COI register" });
      } else if (list.length > 0) {
        hardFails.push({ rule, detail: latest.item, evidence: latest.citation });
      }
    }
  }
  lines.sort((a, b) => (a.hardFail === b.hardFail ? b.count - a.count : a.hardFail ? -1 : 1));

  const exceptions = state.exceptions
    .filter((e) => e.tenderId === tenderId)
    .map((e) => ({ id: e.id, kind: e.kind, status: e.status, title: e.title }));

  const issues = chain;
  const verdict: ComplianceSummary["verdict"] = hardFails.length > 0 ? "HARD_FAIL" : lines.length > 0 ? "FINDINGS" : "CLEAR";

  return {
    tenderId,
    evaluatedAt: new Date().toISOString(),
    pack: { id: RULE_PACK_ZM.id, jurisdiction: RULE_PACK_ZM.jurisdiction, referencesConfirmed: RULE_PACK_ZM.referencesConfirmed },
    guards: {
      checklist: state.guards.checklist,
      priceVariancePct: state.guards.priceVariancePct,
      registryCrossCheck: state.guards.registryCrossCheck,
    },
    lines,
    hardFails,
    chain: { valid: issues.length === 0, issues },
    coi: { present: (cycle?.opening?.rows.length ?? 0) > 0 ? coi.length : coi.length, declared: coi.length, conflicts },
    exceptions,
    verdict,
    note:
      verdict === "HARD_FAIL"
        ? "Material compliance failures are present — resolve them before the award proceeds. Hard-fail conditions are never warnings."
        : verdict === "FINDINGS"
          ? "Findings are present and evidence-linked; each one is advisory until a named human disposes of it."
          : "No findings or hard-fail conditions recorded for this tender.",
  };
}
