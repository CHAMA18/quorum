/**
 * Evaluation integrity (WS7).
 *
 * An evaluation is not one officer's score sheet. Each evaluator scores every
 * bid on their own sheet; the committee meets, reconciles the spreads and
 * records a consensus; the matrix's technical column is drawn from that
 * consensus and nothing else. Conflicts are structured names, screened against
 * the bidders and their beneficial owners, not prose nobody can check.
 *
 * Prices from different currencies are scored on one evaluated basis. A quote
 * must name its source and observation date, and a stale quote is not a quote.
 *
 * Everything here is pure. The route layer records; this module decides whether
 * what was recorded is good enough to certify.
 */

import type {
  CoiDeclaration,
  EvalConsensus,
  EvalCriterion,
  EvalDivergence,
  EvalMatrix,
  EvalScoreSheet,
  EvalSheetScore,
  FxRate,
  RosterMemberForGate,
  Supplier,
} from "./store";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** ISO-4217-shaped currency codes only — a typo must not become a currency. */
export function normalizeCurrency(value: unknown): string | null {
  const code = str(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function jurisdictionCurrency(jurisdictionId: string): string {
  return jurisdictionId === "KE" ? "KES" : "ZMW";
}

/* ── Structured conflicts ─────────────────────────────────────────────────── */

const PERSON_TITLES = new Set(["dr", "mr", "mrs", "ms", "miss", "prof", "eng", "hon", "sir", "madam", "chief", "rev"]);
const ENTITY_SUFFIXES = new Set([
  "ltd",
  "limited",
  "plc",
  "inc",
  "llc",
  "co",
  "company",
  "corporation",
  "corp",
  "sa",
  "ag",
  "gmbh",
  "pty",
  "bv",
  "nv",
  "llp",
  "lp",
]);

/** Fold a name to comparable tokens: case, punctuation, accents, titles and
 *  company suffixes are presentation, not identity. */
export function normalizeEntityName(name: unknown, kind: "ENTITY" | "PERSON" = "ENTITY"): string {
  const tokens = str(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => (kind === "PERSON" ? !PERSON_TITLES.has(token) : !ENTITY_SUFFIXES.has(token)));
  return tokens.join(" ");
}

/**
 * Whether two names describe the same entity. Exact after folding, or one
 * contains the other when the shorter side is a multi-word name — so "Acme
 * Holdings" matches "Acme Holdings Limited", while a single surname does not
 * match every person who shares it.
 */
export function sameEntity(a: unknown, b: unknown, kind: "ENTITY" | "PERSON" = "ENTITY"): boolean {
  const left = normalizeEntityName(a, kind);
  const right = normalizeEntityName(b, kind);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.split(" ").length >= 2 && longer.includes(shorter);
}

export interface ConflictHit {
  member: string;
  declaration: "NO_CONFLICT" | "CONFLICT_DECLARED";
  entity: string;
  relationship?: string;
  bidder: string;
  matchedName: string;
  matchedKind: "BIDDER" | "BENEFICIAL_OWNER";
}

/**
 * Screen every structured declaration against the bidders on the matrix and
 * the beneficial owners on the supplier register. A declaration only protects
 * the record if it names the connection; screening is how the record checks.
 */
export function conflictScreening(
  coi: CoiDeclaration[],
  bidders: string[],
  suppliers: Supplier[],
): ConflictHit[] {
  const candidates: { bidder: string; name: string; kind: "BIDDER" | "BENEFICIAL_OWNER" }[] = [];
  for (const bidder of bidders) {
    candidates.push({ bidder, name: bidder, kind: "BIDDER" });
    const supplier = suppliers.find((s) => sameEntity(s.name, bidder));
    for (const owner of supplier?.verification?.beneficialOwners ?? []) {
      if (str(owner.name)) candidates.push({ bidder, name: owner.name, kind: "BENEFICIAL_OWNER" });
    }
  }
  const hits: ConflictHit[] = [];
  for (const declaration of coi) {
    for (const entity of declaration.entities ?? []) {
      const name = str(entity.name);
      if (!name) continue;
      const kind = entity.kind === "PERSON" ? "PERSON" : "ENTITY";
      for (const candidate of candidates) {
        if (!sameEntity(name, candidate.name, kind)) continue;
        if (
          hits.some(
            (hit) =>
              hit.member.toLowerCase() === declaration.member.toLowerCase() &&
              hit.bidder.toLowerCase() === candidate.bidder.toLowerCase() &&
              hit.entity.toLowerCase() === name.toLowerCase(),
          )
        ) {
          continue;
        }
        hits.push({
          member: declaration.member,
          declaration: declaration.declaration,
          entity: name,
          ...(str(entity.relationship) ? { relationship: str(entity.relationship) } : {}),
          bidder: candidate.bidder,
          matchedName: candidate.name,
          matchedKind: candidate.kind,
        });
      }
    }
  }
  return hits;
}

/** Everyone who must not score or certify: declared conflicts and recusals. */
export function conflictedMembers(coi: CoiDeclaration[]): Set<string> {
  return new Set(
    coi
      .filter((declaration) => declaration.declaration === "CONFLICT_DECLARED" || declaration.recused === true)
      .map((declaration) => declaration.member.trim().toLowerCase()),
  );
}

/** PANEL members who hold the evaluation-committee office. No fallback: a
 *  missing office is not evidence that everyone is an evaluator. */
export function assignedEvaluators(roster: RosterMemberForGate[]): RosterMemberForGate[] {
  return roster.filter((member) => member.status === "PRESENT" && member.office === "EVALUATION_COMMITTEE");
}

/* ── FX — one evaluated-price basis ──────────────────────────────────────── */

/**
 * Validate and normalise a set of quotes. Invalid shapes are refused with the
 * field named; the route records nothing until every line is explicit.
 */
export function normalizeFxRates(raw: unknown, evaluationCurrency: unknown, now = new Date()): FxRate[] {
  const quote = normalizeCurrency(evaluationCurrency);
  if (!quote) throw new Error("evaluationCurrency must be a three-letter currency code (e.g. ZMW).");
  const entries = Array.isArray(raw) ? raw : [];
  if (entries.length > 12) throw new Error("At most 12 FX quotes can be recorded at once.");
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const base = normalizeCurrency(line.base);
    if (!base) throw new Error(`FX quote ${index + 1} needs a three-letter base currency (the bid's currency).`);
    if (base === quote) throw new Error(`FX quote ${index + 1} converts ${base} to ${quote} — a same-currency quote is not a conversion.`);
    if (seen.has(base)) throw new Error(`Two FX quotes are recorded for ${base}; one rate per currency, with its own date.`);
    seen.add(base);
    const statedQuote = normalizeCurrency(line.quote);
    if (statedQuote && statedQuote !== quote) {
      throw new Error(`FX quote ${index + 1} is quoted in ${statedQuote}, but the evaluation currency is ${quote}.`);
    }
    const rate = Number(line.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`FX quote ${index + 1} (${base}) needs a rate greater than 0.`);
    const source = str(line.source).slice(0, 160);
    if (!source) throw new Error(`FX quote ${index + 1} (${base}) must name its source — an unsourced rate is an assertion.`);
    const asOfRaw = str(line.asOf);
    const asOfDate = asOfRaw ? new Date(asOfRaw) : null;
    if (!asOfDate || Number.isNaN(asOfDate.getTime())) {
      throw new Error(`FX quote ${index + 1} (${base}) must carry the date the rate was observed.`);
    }
    if (asOfDate.getTime() > now.getTime() + 86_400_000) {
      throw new Error(`FX quote ${index + 1} (${base}) is dated in the future.`);
    }
    return { base, quote, rate, source, asOf: asOfDate.toISOString() };
  });
}

export type EvaluatedPrice =
  | { state: "NONE" }
  | { state: "LEGACY"; amount: number }
  | { state: "SAME"; amount: number }
  | {
      state: "CONVERTED";
      amount: number;
      baseCurrency: string;
      currency: string;
      rate: number;
      source: string;
      asOf: string;
    }
  | { state: "UNCONVERTIBLE"; reason: string };

/** The price the financial formula should score for one bid. */
export function evaluatedPrice(
  matrix: Pick<EvalMatrix, "evaluationCurrency" | "fxRates">,
  financial: { amount: number; currency?: string } | undefined,
): EvaluatedPrice {
  if (!financial || !Number.isFinite(financial.amount) || financial.amount <= 0) return { state: "NONE" };
  const evaluation = normalizeCurrency(matrix.evaluationCurrency);
  const base = normalizeCurrency(financial.currency);
  if (!evaluation) return { state: "LEGACY", amount: financial.amount };
  if (!base || base === evaluation) return { state: "SAME", amount: financial.amount };
  const quote = (matrix.fxRates ?? []).find(
    (rate) => normalizeCurrency(rate.base) === base && normalizeCurrency(rate.quote) === evaluation,
  );
  if (!quote) {
    return {
      state: "UNCONVERTIBLE",
      reason: `the price is in ${base} and no ${base}→${evaluation} rate is on record`,
    };
  }
  if (!Number.isFinite(quote.rate) || quote.rate <= 0) {
    return { state: "UNCONVERTIBLE", reason: `the ${base}→${evaluation} rate is not a positive number` };
  }
  const asOf = new Date(quote.asOf);
  if (Number.isNaN(asOf.getTime())) {
    return { state: "UNCONVERTIBLE", reason: `the ${base}→${evaluation} quote has no observation date` };
  }
  return {
    state: "CONVERTED",
    amount: round2(financial.amount * quote.rate),
    baseCurrency: base,
    currency: evaluation,
    rate: quote.rate,
    source: quote.source,
    asOf: asOf.toISOString(),
  };
}

/** Why the evaluated-price basis cannot be certified, or null. */
export function fxBlockReason(
  matrix: Pick<EvalMatrix, "bids" | "evaluationCurrency" | "fxRates">,
  stalenessDays: number,
  now = new Date(),
): string | null {
  const currencies = [
    ...new Set(
      matrix.bids
        .map((bid) => normalizeCurrency(bid.financial?.currency))
        .filter((currency): currency is string => !!currency),
    ),
  ];
  const evaluation = normalizeCurrency(matrix.evaluationCurrency);
  if (!evaluation) {
    if (currencies.length <= 1) return null;
    return `Bids are priced in ${currencies.join(", ")}, but no evaluation currency is set — record the basis (and a quote for every foreign currency) before certification.`;
  }
  const reasons: string[] = [];
  for (const bid of matrix.bids) {
    const price = evaluatedPrice(matrix, bid.financial);
    if (price.state === "CONVERTED") {
      const source = str(price.source);
      if (!source) reasons.push(`${bid.bidder}: the ${price.baseCurrency}→${price.currency} quote names no source.`);
      const ageDays = Math.floor((now.getTime() - new Date(price.asOf).getTime()) / 86_400_000);
      if (ageDays > stalenessDays) {
        reasons.push(
          `${bid.bidder}: the ${price.baseCurrency}→${price.currency} quote is ${ageDays} days old (limit ${stalenessDays}) — refresh it.`,
        );
      }
    } else if (price.state === "UNCONVERTIBLE") {
      reasons.push(`${bid.bidder}: ${price.reason}.`);
    }
  }
  for (const rate of matrix.fxRates ?? []) {
    const quote = normalizeCurrency(rate.quote);
    if (quote && quote !== evaluation) {
      reasons.push(`The rate for ${rate.base} is quoted in ${quote}, not the evaluation currency ${evaluation}.`);
    }
  }
  if (!reasons.length) return null;
  return `${reasons.join(" ")} The financial formula cannot score a foreign price without a fresh, sourced quote.`;
}

/* ── Sheets, divergences and consensus ───────────────────────────────────── */

/** Weighted technical total for one sheet — the same arithmetic as the matrix. */
export function sheetTechnicalTotal(criteria: EvalCriterion[], scores: { criterionId: string; score: number }[]): number {
  const total = criteria.reduce((sum, criterion) => {
    const score = scores.find((entry) => entry.criterionId === criterion.id);
    return sum + (score ? score.score * criterion.weight : 0);
  }, 0);
  return round1(total / 100);
}

/** Every cell where the sheets disagree, widest spread first. */
export function computeDivergences(sheets: EvalScoreSheet[]): EvalDivergence[] {
  const cells = new Map<string, EvalDivergence>();
  for (const sheet of sheets) {
    for (const score of sheet.scores) {
      const key = `${score.bidder.toLowerCase()}\u0000${score.criterionId}`;
      const cell =
        cells.get(key) ??
        ({
          bidder: score.bidder,
          criterionId: score.criterionId,
          min: score.score,
          max: score.score,
          spread: 0,
          values: [],
        } satisfies EvalDivergence);
      cell.min = Math.min(cell.min, score.score);
      cell.max = Math.max(cell.max, score.score);
      cell.spread = round1(cell.max - cell.min);
      cell.values.push({ evaluator: sheet.evaluator, score: score.score });
      cells.set(key, cell);
    }
  }
  return [...cells.values()]
    .filter((cell) => cell.values.length > 1)
    .map((cell) => ({ ...cell, values: [...cell.values].sort((a, b) => a.evaluator.localeCompare(b.evaluator)) }))
    .sort((a, b) => b.spread - a.spread || a.bidder.localeCompare(b.bidder));
}

/** The mean score for every bidder/criterion cell, one decimal. */
export function consensusScores(sheets: EvalScoreSheet[]): EvalSheetScore[] {
  const cells = new Map<string, { bidder: string; criterionId: string; total: number; count: number }>();
  for (const sheet of sheets) {
    for (const score of sheet.scores) {
      const key = `${score.bidder.toLowerCase()}\u0000${score.criterionId}`;
      const cell = cells.get(key) ?? { bidder: score.bidder, criterionId: score.criterionId, total: 0, count: 0 };
      cell.total += score.score;
      cell.count += 1;
      cells.set(key, cell);
    }
  }
  return [...cells.values()].map((cell) => ({
    bidder: cell.bidder,
    criterionId: cell.criterionId,
    score: round1(cell.total / cell.count),
  }));
}

/** Validate one evaluator sheet against the matrix's bidders and criteria. */
export function sheetValidationError(
  matrix: Pick<EvalMatrix, "bids" | "criteria">,
  scores: { bidder: unknown; criterionId: unknown; score: unknown }[],
): string | null {
  const expected = matrix.bids.reduce((n, bid) => n + matrix.criteria.length, 0);
  if (scores.length !== expected) {
    return `A sheet needs one score for every bidder and criterion — ${expected} cells, got ${scores.length}.`;
  }
  const seen = new Set<string>();
  for (const raw of scores) {
    const bidder = str(raw.bidder);
    const criterionId = str(raw.criterionId);
    if (!matrix.bids.some((bid) => bid.bidder.toLowerCase() === bidder.toLowerCase())) {
      return `"${bidder}" is not a bidder on this matrix.`;
    }
    if (!matrix.criteria.some((criterion) => criterion.id === criterionId)) {
      return `"${criterionId}" is not a criterion on this matrix.`;
    }
    const key = `${bidder.toLowerCase()}\u0000${criterionId}`;
    if (seen.has(key)) return `The sheet scores ${bidder} / ${criterionId} more than once.`;
    seen.add(key);
    const score = Number(raw.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return `The score for ${bidder} / ${criterionId} must be 0-100.`;
    }
  }
  return null;
}

export function consensusValidationError(
  matrix: Pick<EvalMatrix, "id" | "bids" | "criteria" | "sheets">,
  attendeesRaw: string[],
  notesRaw: string,
  divergencePoints: number,
): string | null {
  const sheets = matrix.sheets ?? [];
  if (sheets.length < 2) {
    return `At least two evaluator sheets are needed before the committee can record a consensus — ${sheets.length} on file.`;
  }
  const attendees = [...new Set(attendeesRaw.map((name) => str(name)).filter(Boolean))];
  if (attendees.length < 2) return "A consensus needs at least two named attendees.";
  const absent = sheets.filter(
    (sheet) => !attendees.some((attendee) => attendee.toLowerCase() === sheet.evaluator.trim().toLowerCase()),
  );
  if (absent.length) {
    return `The consensus is missing the evaluator(s) whose sheets it reconciles: ${absent.map((sheet) => sheet.evaluator).join(", ")}.`;
  }
  const notes = str(notesRaw);
  if (!notes) return "The consensus needs a minute — what the committee reconciled and why.";
  const divergent = computeDivergences(sheets).filter((cell) => cell.spread > divergencePoints);
  if (divergent.length && notes.length < 20) {
    const widest = divergent[0];
    return `${divergent.length} cell(s) disagree by more than ${divergencePoints} points (widest: ${widest.bidder} / ${widest.criterionId}, spread ${widest.spread}) — the minute must explain how the committee reconciled them (at least 20 characters).`;
  }
  const agreed = consensusScores(sheets);
  const expected = matrix.bids.reduce((n, bid) => n + matrix.criteria.length, 0);
  if (agreed.length !== expected) return "The consensus does not cover every bidder and criterion.";
  return null;
}

/* ── The certification gate ──────────────────────────────────────────────── */

export interface EvaluationGateInput {
  matrix: EvalMatrix;
  coi: CoiDeclaration[];
  suppliers: Supplier[];
  /** The live roster, when the caller has it. The executor does not, so the
   *  panel-composition checks are skipped there and re-run at decision time. */
  roster?: RosterMemberForGate[];
  divergencePoints: number;
  fxStalenessDays: number;
  now?: Date;
}

/**
 * Why the evaluation cannot be certified, or null. Fail closed: missing
 * sheets, an unminuted divergence, an unreconciled conflict or an unsourced
 * foreign price all stop the gate.
 */
export function evaluationBlockReason(input: EvaluationGateInput): string | null {
  const matrix = input.matrix;
  const sheets = matrix.sheets ?? [];
  const conflicted = conflictedMembers(input.coi);
  const hits = conflictScreening(
    input.coi,
    matrix.bids.map((bid) => bid.bidder),
    input.suppliers,
  );

  /* A screened connection under a NO_CONFLICT declaration is a conflict the
     record already knows about. It must be amended, not certified around. */
  const undisclosed = hits.filter((hit) => hit.declaration !== "CONFLICT_DECLARED");
  if (undisclosed.length) {
    const hit = undisclosed[0];
    const through = hit.matchedKind === "BENEFICIAL_OWNER" ? `beneficial owner of ${hit.bidder}` : `bidder ${hit.bidder}`;
    return `${hit.member} declared no conflict but is connected to ${hit.entity}, which matches ${hit.matchedName} (${through}). Amend the declaration and recuse before the matrix is certified.`;
  }

  if (input.roster) {
    const assigned = assignedEvaluators(input.roster);
    if (assigned.length < 2) {
      return "Fewer than two PRESENT evaluators hold the evaluation-committee office — a matrix cannot be certified by a panel that is not constituted.";
    }
    const required = assigned.filter((member) => !conflicted.has(member.name.trim().toLowerCase()));
    if (required.length < 2) {
      return "Fewer than two evaluators remain after conflict recusals — the evaluation panel is not quorate.";
    }
    const missing = required.filter(
      (member) =>
        !sheets.some((sheet) => sheet.evaluator.trim().toLowerCase() === member.name.trim().toLowerCase()),
    );
    if (missing.length) {
      return `Score sheets are outstanding from: ${missing.map((member) => member.name).join(", ")} — every evaluator must submit their own sheet before consensus.`;
    }
    const outsider = sheets.find(
      (sheet) => !required.some((member) => member.name.trim().toLowerCase() === sheet.evaluator.trim().toLowerCase()),
    );
    if (outsider) {
      return `${outsider.evaluator} submitted a score sheet but is not an active evaluator on this panel${conflicted.has(outsider.evaluator.trim().toLowerCase()) ? " (declared conflict or recused)" : ""} — that sheet cannot count.`;
    }
  } else {
    if (sheets.length < 2) {
      return `At least two evaluator sheets are required before certification — ${sheets.length} on file.`;
    }
    const tainted = sheets.find((sheet) => conflicted.has(sheet.evaluator.trim().toLowerCase()));
    if (tainted) {
      return `${tainted.evaluator} is recused or has declared a conflict, but their score sheet is on the matrix — remove it from the consensus.`;
    }
  }

  const consensus = matrix.consensus;
  if (!consensus) {
    return "No committee consensus is recorded — the matrix's technical column cannot be certified from one officer's scores.";
  }
  if (consensus.matrixId !== matrix.id) {
    return "The recorded consensus belongs to a different matrix — record it against the matrix being certified.";
  }
  const attendeeNames = new Set(consensus.attendees.map((name) => name.trim().toLowerCase()));
  const unminuted = sheets.find((sheet) => !attendeeNames.has(sheet.evaluator.trim().toLowerCase()));
  if (unminuted) {
    return `The consensus does not name ${unminuted.evaluator} among its attendees, so it cannot have reconciled their sheet.`;
  }
  if (consensus.attendees.length < 2) {
    return "The consensus names fewer than two attendees — one evaluator cannot constitute a committee.";
  }
  const consensusError = consensusValidationError(matrix, consensus.attendees, consensus.notes, input.divergencePoints);
  if (consensusError) return consensusError;
  if (consensus.scores.length !== matrix.bids.reduce((n, bid) => n + matrix.criteria.length, 0)) {
    return "The consensus does not carry a score for every bidder and criterion.";
  }

  const fx = fxBlockReason(matrix, input.fxStalenessDays, input.now);
  if (fx) return fx;

  return null;
}
