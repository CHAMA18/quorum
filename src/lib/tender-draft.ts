/**
 * The tender brief — the artefact behind the Tender Builder.
 *
 * The builder is a conversation, but the thing being built is one structured
 * record. This module owns that record: its shape, the merge rule that lets a
 * later sentence refine an earlier draft without wiping it, the gaps that tell
 * the officer what is still missing, and a deterministic composer that turns a
 * plain brief into a usable draft with no model at all.
 *
 * The composer is not a stub. It is the floor the product stands on: an
 * air-gapped laptop, an expired key or an unreachable endpoint all still
 * produce a tender brief an officer can edit and commit. The open-weight model
 * refines what this writes; it is never the only thing that can write it.
 */

export interface EvaluationCriterion {
  criterion: string;
  weight: number;
}

export interface TenderDraft {
  title: string;
  buyer: string;
  category: string;
  summary: string;
  budget: number | null;
  currency: string;
  /** ISO date (YYYY-MM-DD) or null when the officer has not said. */
  closingDate: string | null;
  contractMonths: number | null;
  eligibility: string[];
  evaluation: EvaluationCriterion[];
  documents: string[];
}

export function emptyDraft(): TenderDraft {
  return {
    title: "",
    buyer: "",
    category: "",
    summary: "",
    budget: null,
    currency: "ZMW",
    closingDate: null,
    contractMonths: null,
    eligibility: [],
    evaluation: [],
    documents: [],
  };
}

const MAX_LIST = 10;

function text(value: unknown, fallback: string, max = 400): string {
  const next = typeof value === "string" ? value.trim() : "";
  return next ? next.slice(0, max) : fallback;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_LIST);
  return list.length ? list : fallback;
}

function criterionList(value: unknown, fallback: EvaluationCriterion[]): EvaluationCriterion[] {
  if (!Array.isArray(value)) return fallback;
  const list: EvaluationCriterion[] = [];
  for (const entry of value.slice(0, MAX_LIST)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const label = text(row.criterion ?? row.name, "", 120);
    const weight = Number(row.weight ?? row.score ?? row.percent);
    if (!label || !Number.isFinite(weight) || weight <= 0) continue;
    list.push({ criterion: label, weight: Math.min(100, Math.round(weight)) });
  }
  return list.length ? list : fallback;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function isoOf(year: number, month: number, day: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** A date the officer actually wrote, never an invented one. */
export function parseClosing(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const named = raw.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?\s*(\d{4})?/i,
  );
  if (named) {
    const month = MONTHS.findIndex((name) => name.startsWith(named[2].toLowerCase().slice(0, 3)));
    const year = named[3] ? Number(named[3]) : now.getUTCFullYear();
    const candidate = isoOf(year, month, Number(named[1]));
    /* No year written and the day already passed means next year. */
    if (candidate && !named[3] && candidate < now.toISOString().slice(0, 10)) {
      return isoOf(year + 1, month, Number(named[1]));
    }
    return candidate;
  }

  const slash = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    /* East-African order is day/month first. Only when that reading is
       impossible (month above 12) do we try the US month/day reading. */
    const dayFirst = isoOf(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]));
    if (dayFirst) return dayFirst;
    const monthFirst = isoOf(Number(slash[3]), Number(slash[1]) - 1, Number(slash[2]));
    if (monthFirst) return monthFirst;
  }

  const relative = raw.match(/\bin\s+(\d{1,2})\s+(days?|weeks?)\b/i);
  if (relative) {
    const days = Number(relative[1]) * (/week/i.test(relative[2]) ? 7 : 1);
    const date = new Date(now.getTime() + days * 86_400_000);
    return date.toISOString().slice(0, 10);
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

const CURRENCY_WORDS: { pattern: RegExp; code: string }[] = [
  { pattern: /\bzmw\b|kwacha/i, code: "ZMW" },
  { pattern: /\busd\b|dollars?|\$/i, code: "USD" },
  { pattern: /\beur\b|euros?|€/i, code: "EUR" },
  { pattern: /\bgbp\b|pounds?|£/i, code: "GBP" },
  { pattern: /\bkes\b|kshs?\b|kenyan shillings?/i, code: "KES" },
  { pattern: /\brwf\b|rwanda francs?/i, code: "RWF" },
  { pattern: /\bugx\b|ugandan shillings?/i, code: "UGX" },
  { pattern: /\btzs\b|tsh\b|tanzanian shillings?/i, code: "TZS" },
  { pattern: /\bzar\b|rand\b/i, code: "ZAR" },
];

const MULTIPLIERS: { pattern: RegExp; factor: number }[] = [
  { pattern: /billion|bn\b/i, factor: 1_000_000_000 },
  { pattern: /million|\bm\b/i, factor: 1_000_000 },
  { pattern: /thousand|\bk\b/i, factor: 1_000 },
];

/** Money the officer actually wrote — a bare number with no currency is not a budget. */
export function parseBudget(value: string): { budget: number; currency: string } | null {
  const currency = CURRENCY_WORDS.find((entry) => entry.pattern.test(value));
  if (!currency) return null;

  const withCurrencyFirst = value.match(
    /(?:zmw|usd|eur|gbp|kes|kshs?|rwf|ugx|tzs|tsh|zar|kwacha|kenyan shillings?|rwanda francs?|ugandan shillings?|tanzanian shillings?|dollars?|euros?|pounds?|\$|€|£)\s*([\d][\d,]*(?: \d{3})*(?:\.\d+)?)\s*(billion|million|thousand|bn|m|k)?/i,
  );
  const withCurrencyLast = value.match(
    /([\d][\d,]*(?: \d{3})*(?:\.\d+)?)\s*(billion|million|thousand|bn|m|k)?\s*(?:zmw|usd|eur|gbp|kes|kshs?|rwf|ugx|tzs|tsh|zar|kwacha|kenyan shillings?|rwanda francs?|ugandan shillings?|tanzanian shillings?|dollars?|euros?|pounds?)/i,
  );
  const hit = withCurrencyFirst ?? withCurrencyLast;
  if (!hit) return null;

  const amount = Number(hit[1].replace(/[ ,]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const suffix = hit[2] ?? "";
  const factor = MULTIPLIERS.find((entry) => entry.pattern.test(suffix))?.factor ?? 1;
  const budget = Math.round(amount * factor);
  if (budget < 1_000) return null;
  return { budget, currency: currency.code };
}

type Profile = {
  category: string;
  match: RegExp;
  eligibility: string[];
  evaluation: EvaluationCriterion[];
  documents: string[];
};

const COMMON_ELIGIBILITY = [
  "ZPPA registration in the relevant category",
  "PACRA certificate of incorporation",
  "Valid ZRA tax clearance certificate",
  "No current suspension or blacklisting on the supplier register",
];

const COMMON_DOCUMENTS = [
  "Invitation for bids",
  "Instructions to bidders and bid data sheet",
  "Bid security declaration",
  "General and special conditions of contract",
];

const PROFILES: Profile[] = [
  {
    category: "Vehicles & fleet",
    match: /ambulance|vehicle|truck|lorr(y|ies)|motorcycle|bus\b|fleet/i,
    eligibility: [...COMMON_ELIGIBILITY, "Manufacturer authorisation or franchise letter"],
    evaluation: [
      { criterion: "Technical specification and warranty", weight: 45 },
      { criterion: "Delivery schedule and after-sales support", weight: 25 },
      { criterion: "Price", weight: 30 },
    ],
    documents: [...COMMON_DOCUMENTS, "Technical specification sheet", "Delivery schedule and price schedule"],
  },
  {
    category: "ICT & software",
    match: /software|system|platform|licen[cs]e|\bict\b|computer|laptop|server|network|digital|data ?base/i,
    eligibility: [...COMMON_ELIGIBILITY, "Evidence of comparable deployments in the last three years"],
    evaluation: [
      { criterion: "Functional fit and technical approach", weight: 40 },
      { criterion: "Implementation plan, support and data protection", weight: 30 },
      { criterion: "Price", weight: 30 },
    ],
    documents: [...COMMON_DOCUMENTS, "Functional and technical requirements", "Service level and support schedule"],
  },
  {
    category: "Works & construction",
    match: /road|construct|rehabilitat|building|borehole|water reticulation|civil works|renovat/i,
    eligibility: [...COMMON_ELIGIBILITY, "National Council for Construction registration in the relevant grade"],
    evaluation: [
      { criterion: "Methodology and programme", weight: 35 },
      { criterion: "Key personnel and plant", weight: 25 },
      { criterion: "Price", weight: 40 },
    ],
    documents: [...COMMON_DOCUMENTS, "Bill of quantities", "Drawings and site schedule"],
  },
  {
    category: "Consultancy",
    match: /consultan|advisory|feasibility|study\b|assessment|technical assistance|terms of reference/i,
    eligibility: [...COMMON_ELIGIBILITY, "Curricula vitae for the proposed team"],
    evaluation: [
      { criterion: "Methodology and work plan", weight: 40 },
      { criterion: "Team experience and references", weight: 30 },
      { criterion: "Price", weight: 30 },
    ],
    documents: [...COMMON_DOCUMENTS, "Terms of reference", "Expression of interest form"],
  },  { category: "Medical supplies", match: /drug|medicine|pharmaceutic|vaccine|medical|clinic|cold[- ]?chain|refrigerat|hospital equipment|cold rooms?|consumables/i,
    eligibility: [...COMMON_ELIGIBILITY, "Pharmaceutical Services registration and product dossiers"],
    evaluation: [
      { criterion: "Product quality and registration", weight: 45 },
      { criterion: "Supply reliability and shelf life on delivery", weight: 25 },
      { criterion: "Price", weight: 30 },
    ],
    documents: [...COMMON_DOCUMENTS, "Schedule of requirements with quantities", "Product registration evidence"],
  },
  {
    category: "Furniture & office equipment",
    match: /furniture|desks?\b|chairs?\b|office equipment|cabinet/i,
    eligibility: COMMON_ELIGIBILITY,
    evaluation: [
      { criterion: "Specification compliance and finish", weight: 40 },
      { criterion: "Delivery and installation", weight: 20 },
      { criterion: "Price", weight: 40 },
    ],
    documents: [...COMMON_DOCUMENTS, "Schedule of furniture and quantities", "Delivery and installation plan"],
  },
  {
    category: "Security services",
    match: /security|guards?\b|surveillance/i,
    eligibility: [...COMMON_ELIGIBILITY, "Licence to provide private security services"],
    evaluation: [
      { criterion: "Operational plan and supervision", weight: 40 },
      { criterion: "Staff vetting and training", weight: 25 },
      { criterion: "Price", weight: 35 },
    ],
    documents: [...COMMON_DOCUMENTS, "Scope of security services", "Staffing schedule"],
  },
  {
    category: "Cleaning services",
    match: /cleaning|janitorial|fumigation|sanitation services/i,
    eligibility: COMMON_ELIGIBILITY,
    evaluation: [
      { criterion: "Method statement and equipment", weight: 40 },
      { criterion: "Supervision and reporting", weight: 20 },
      { criterion: "Price", weight: 40 },
    ],
    documents: [...COMMON_DOCUMENTS, "Scope of cleaning services", "Staffing and equipment schedule"],
  },
  {
    category: "Training",
    match: /training|workshop|capacity building|curriculum/i,
    eligibility: COMMON_ELIGIBILITY,
    evaluation: [
      { criterion: "Course design and materials", weight: 40 },
      { criterion: "Facilitator experience", weight: 25 },
      { criterion: "Price", weight: 35 },
    ],
    documents: [...COMMON_DOCUMENTS, "Training needs and course outline", "Facilitator profiles"],
  },
];

const GENERIC_PROFILE: Profile = {
  category: "",
  match: /$^/,
  eligibility: COMMON_ELIGIBILITY,
  evaluation: [
    { criterion: "Technical compliance and delivery plan", weight: 40 },
    { criterion: "Capacity and references", weight: 25 },
    { criterion: "Price", weight: 35 },
  ],
  documents: [...COMMON_DOCUMENTS, "Schedule of requirements"],
};

function profileFor(brief: string): Profile {
  /* A brief that opens by offering a service ("Consultancy to design …") is
     that service even when the subject touches works or ICT words. */
  const firstWords = brief.trim().toLowerCase().split(/\s+/).slice(0, 4).join(" ");
  if (/^(consultancy|consultant|advisory|feasibility|design|engineering design|a study)\b/.test(firstWords)) {
    const consulting = PROFILES.find((profile) => profile.category === "Consultancy");
    if (consulting) return consulting;
  }
  return PROFILES.find((profile) => profile.match.test(brief)) ?? GENERIC_PROFILE;
}

const OPENING_VERB = /^\s*(?:please\s+)?(?:can you\s+)?(?:create|draft|write|prepare|build|design|set\s*up|start|i\s+(?:need|want|have\s+to\s+do))\b/i;

/** True when the message opens or restates a tender, rather than editing one. */
export function opensNewBrief(brief: string): boolean {
  return OPENING_VERB.test(brief);
}

export function titleFrom(brief: string): string {
  let line = brief.replace(/\s+/g, " ").trim();
  line = line.replace(
    /^(?:please\s+)?(?:can you\s+)?(?:create|draft|write|prepare|build|design|set\s*up|start)\s+(?:me\s+)?(?:an?\s+)?(?:new\s+)?(?:tender|procurement|rfp|rfq|bid|notice)\s*(?:for|to|:)?\s*/i,
    "",
  );
  line = line.replace(/^i\s+(?:need|want)\s+(?:an?\s+)?(?:tender|procurement)\s+(?:for|to)\s+/i, "");
  line = line.split(/[.;\n]/)[0];
  line = line.split(/,\s*(?:with\s+)?(?:a\s+)?(?:budget|closing|value|funded|estimated)/i)[0];
  line = line.replace(/^(?:the\s+)?(?:supply|supplying)\b/i, (match) => match[0].toUpperCase() + match.slice(1));
  line = line.trim().replace(/[,:;\s]+$/, "");
  if (!line) return "";
  line = line.charAt(0).toUpperCase() + line.slice(1);
  return line.slice(0, 110);
}

export function buyerFrom(brief: string): string {
  const entity = brief.match(
    /(?:for|to|on behalf of|by)\s+(?:the\s+)?((?:County\s+(?:Health\s+)?|National\s+|Regional\s+)?(?:Ministry|City Council|Municipal Council|District Council|Council|County|Commission|Authority|Agency|Hospital|University|College|Board|Institute|Department|Municipality|Parastatal)[A-Za-z &'’.,-]{0,60})/i,
  );
  if (!entity) return "";
  /* The regex can run on into the rest of the sentence; a buyer name ends at
     the next comma or at the clause that starts describing the money. */
  const name = entity[1]
    .split(/,\s*/)[0]
    .split(/\s+(?:with\s+(?:a\s+)?(?:budget|value)|and\s+the\s+budget|budget\s+of|at\s+a\s+value|closing)\b/i)[0]
    .trim()
    .replace(/[,.]$/, "")
    .slice(0, 90);
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

export function contractMonthsFrom(brief: string): number | null {
  const hit = brief.match(/\b(\d{1,2})[- ]months?\b/i);
  const months = hit ? Number(hit[1]) : NaN;
  return Number.isFinite(months) && months > 0 && months <= 120 ? months : null;
}

export function summaryFrom(brief: string): string {
  const clean = brief.replace(/\s+/g, " ").trim();
  if (clean.length <= 320) return clean;
  const cut = clean.slice(0, 320);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (lastStop > 120 ? cut.slice(0, lastStop + 1) : `${cut.replace(/[,;\s]+$/, "")}…`).trim();
}

/**
 * Compose a draft from a plain brief. Every field is only written when the
 * officer's words actually support it, and an existing draft is preserved
 * field by field — this is the merge rule the model inherits.
 */
export function composeTenderDraft(brief: string, previous: TenderDraft, now: Date = new Date()): TenderDraft {
  const draft: TenderDraft = {
    ...previous,
    eligibility: [...previous.eligibility],
    evaluation: previous.evaluation.map((row) => ({ ...row })),
    documents: [...previous.documents],
  };
  const opens = opensNewBrief(brief);

  const title = titleFrom(brief);
  if (title && (!previous.title || opens)) draft.title = title;

  if (!previous.summary || opens) {
    const summary = summaryFrom(brief);
    if (summary) draft.summary = summary;
  }

  const money = parseBudget(brief);
  if (money) {
    draft.budget = money.budget;
    draft.currency = money.currency;
  }

  const closing = parseClosing(brief, now);
  if (closing) draft.closingDate = closing;

  const months = contractMonthsFrom(brief);
  if (months) draft.contractMonths = months;

  const buyer = buyerFrom(brief);
  if (buyer) draft.buyer = buyer;

  const profile = profileFor(`${brief} ${previous.category}`);
  if (profile.category) draft.category = profile.category;

  /* Suggested content is filled once, then left to the officer and the model.
     A later sentence must not quietly rewrite a pack they have edited. */
  if (!draft.eligibility.length) draft.eligibility = [...profile.eligibility];
  if (!draft.evaluation.length) draft.evaluation = profile.evaluation.map((row) => ({ ...row }));
  if (!draft.documents.length) draft.documents = [...profile.documents];

  return draft;
}

/** Merge a model's tender object over the deterministic draft. */
export function normalizeDraft(value: unknown, previous: TenderDraft): TenderDraft {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const budgetRaw = Number(row.budget);
  const monthsRaw = Number(row.contractMonths);
  return {
    title: text(row.title, previous.title, 140),
    buyer: text(row.buyer, previous.buyer, 120),
    category: text(row.category, previous.category, 60),
    summary: text(row.summary, previous.summary, 600),
    budget: Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.round(budgetRaw) : previous.budget,
    currency: text(row.currency, previous.currency, 8).toUpperCase(),
    closingDate: parseClosing(row.closingDate) ?? previous.closingDate,
    contractMonths: Number.isFinite(monthsRaw) && monthsRaw > 0 ? Math.round(monthsRaw) : previous.contractMonths,
    eligibility: stringList(row.eligibility, previous.eligibility),
    evaluation: criterionList(row.evaluation, previous.evaluation),
    documents: stringList(row.documents, previous.documents),
  };
}

/**
 * Pull one JSON object out of a model's reply. A 3B model wraps JSON in
 * prose or a code fence often enough that trusting JSON.parse on the whole
 * body would throw away good drafts.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function formatBudget(draft: Pick<TenderDraft, "budget" | "currency">): string {
  if (draft.budget === null) return "Not set";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: draft.currency || "ZMW",
      maximumFractionDigits: 0,
    })
      .format(draft.budget)
      /* Intl uses a non-breaking space between code and amount; keep it plain
         so the same string reads correctly in copy, tests and the audit log. */
      .replace(/\u00a0/g, " ");
  } catch {
    return `${draft.currency || "ZMW"} ${draft.budget.toLocaleString("en-GB")}`;
  }
}

export function formatClosing(iso: string | null): string {
  if (!iso) return "Not set";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The officer's own words outrank the model's inference.
 *
 * A 3B model rewrites titles, rounds budgets and moves dates. Whatever the
 * composer read verbatim from the brief stays; the model fills the blanks and
 * owns the parts that are genuinely drafting (scope, criteria, documents).
 */
export function preferVerbatim(composed: TenderDraft, modelled: TenderDraft): TenderDraft {
  return {
    ...modelled,
    title: composed.title || modelled.title,
    buyer: composed.buyer || modelled.buyer,
    budget: composed.budget ?? modelled.budget,
    currency: composed.budget !== null ? composed.currency : modelled.currency,
    closingDate: composed.closingDate ?? modelled.closingDate,
    contractMonths: composed.contractMonths ?? modelled.contractMonths,
  };
}

export interface DraftGap {
  field: keyof TenderDraft | "scope";
  label: string;
  hint: string;
}

/** What the officer still has to say before this can be published. */
export function draftGaps(draft: TenderDraft): DraftGap[] {
  const gaps: DraftGap[] = [];
  if (!draft.title.trim()) gaps.push({ field: "title", label: "Title", hint: "What is being bought?" });
  if (!draft.buyer.trim()) gaps.push({ field: "buyer", label: "Buyer", hint: "Which office is procuring?" });
  if (!draft.category.trim()) gaps.push({ field: "category", label: "Category", hint: "Goods, works, consultancy or a service?" });
  if (!draft.summary.trim()) gaps.push({ field: "scope", label: "Scope", hint: "What must the supplier deliver?" });
  if (draft.budget === null) gaps.push({ field: "budget", label: "Budget", hint: "How much is set aside, and in which currency?" });
  if (!draft.closingDate) gaps.push({ field: "closingDate", label: "Closing date", hint: "When do bids close?" });
  return gaps;
}

/**
 * The status line. It is written here, from the draft itself, never by the
 * model: a small model asked "what is missing?" will happily invent a missing
 * budget that the officer just gave it. What changed and what is absent are
 * facts about the record, so the record reports them.
 */
export function composerReply(draft: TenderDraft, previous?: TenderDraft): string {
  const gaps = draftGaps(draft);
  const changes: string[] = [];
  if (previous) {
    if (previous.title !== draft.title && draft.title) changes.push(`Title: ${draft.title}`);
    if (previous.buyer !== draft.buyer && draft.buyer) changes.push(`Buyer: ${draft.buyer}`);
    if (previous.budget !== draft.budget && draft.budget !== null) changes.push(`Budget: ${formatBudget(draft)}`);
    if (previous.closingDate !== draft.closingDate && draft.closingDate) {
      changes.push(`Closing: ${formatClosing(draft.closingDate)}`);
    }
    if (previous.category !== draft.category && draft.category) changes.push(`Category: ${draft.category}`);
  }

  const head = changes.length
    ? `${changes.join(" · ")}.`
    : draft.title
      ? `Draft: ${draft.title}.`
      : "I've opened a tender draft.";
  if (!gaps.length) return `${head} The brief is complete — add it to the Tender Workflow when you are ready.`;
  const list = gaps.map((gap) => gap.label.toLowerCase()).join(", ");
  return `${head} Still needed: ${list}. Tell me any of them in a sentence and I'll fold it in.`;
}
