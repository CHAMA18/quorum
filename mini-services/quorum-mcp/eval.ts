/**
 * Offline evaluation of the deterministic review path.
 *
 * For every tender pack it runs the same functions the review graph uses
 * (buildPack → flagPack → verifyFinding), scores the findings against the
 * hand-written labels in data/eval/gold.json, repeats the run to measure
 * variation, and writes data/eval/report.json.
 *
 * Two scores are reported. "original" uses only labels written before the
 * engine was first run. "adjudicated" also counts labels marked postHoc,
 * which were added after reading the engine's unlabelled output.
 *
 * Mutation testing (the variance/sensitivity half of the harness): a run that
 * is identical every time proves stability, not sensitivity. So single defects
 * are injected into copies of each pack — an inflated bid value, a hidden
 * required document, a deleted budget ceiling, an inflated line item — and the
 * engine must notice. Detection rates are published per mutation; a mutation
 * whose precondition does not hold (e.g. removing a ceiling where none is
 * flagged) is reported as skipped, never as a pass.
 *
 * Not covered here: the LLM redline stage and the human gate. Neither runs in
 * this loop, so this measures the rule path only.
 *
 * Usage: bun eval.ts [--runs 5]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "./paths";
import {
  bidNamesDocument,
  buildPack,
  flagPack,
  parseBid,
  requirementOptions,
  RULE_OUTPUT_CAP,
  runRules,
  TENDERS_DIR,
  verifyFinding,
} from "./engine";
import { readPersistedGuardContext } from "./store";
import type { Finding } from "./store";

interface GoldItem {
  rule: string;
  file: string;
  match: string;
  covered: boolean;
  note: string;
  postHoc?: boolean;
}

interface Gold {
  labeller: string;
  covered_means: string;
  tenders: Record<string, GoldItem[]>;
  heldOut: string[];
  heldOutNote: string;
  data_quality_notes: string[];
}

const EVAL_DIR = resolveDataDir() + "eval/";
const runsFlag = process.argv.indexOf("--runs");
const RUNS = runsFlag >= 0 ? Number(process.argv[runsFlag + 1]) : 5;
/* runRules() truncates its output at RULE_OUTPUT_CAP findings — the engine's
   own cap, imported so this report can never drift from what it measures.
   Hitting it means findings may be silently dropped. */
const RULE_CAP = RULE_OUTPUT_CAP;

/* The desk's live guard record and the supplier register it screens against.
   The harness measures the engine the app runs, under the settings the officer
   set — not a fixed default. Read-only: nothing here writes state. */
const { guards, registry } = await readPersistedGuardContext();

const BID_VALUE_LINE = /(\*\*Bid value:\*\*\s*[A-Z]{3}\s*)([\d,]+(?:\.\d+)?)/;
const CEILING_LINE = /^\*\*Budget ceiling:\*\*.*$/m;

async function readPack(tenderId: string) {
  const dir = join(TENDERS_DIR, tenderId);
  const files = (await readdir(dir)).filter((f) => /\.(md|json)$/.test(f)).sort();
  const sources: Record<string, string> = {};
  for (const f of files) sources[f] = await readFile(join(dir, f), "utf8");
  return { files, sources };
}

function evalSources(files: string[], sources: Record<string, string>): Finding[] {
  const pack = buildPack(files, sources);
  const { kept } = flagPack(pack, files, undefined, { guards, registry });
  return kept.filter((f) => verifyFinding(f, sources));
}

async function runOnce(tenderId: string) {
  const { files, sources } = await readPack(tenderId);
  const started = performance.now();
  const pack = buildPack(files, sources);
  const { kept, rejected } = flagPack(pack, files, undefined, { guards, registry });
  const findings = kept.filter((f) => verifyFinding(f, sources));
  const ms = performance.now() - started;

  return {
    findings,
    ms,
    rejectedCount: rejected.length,
    droppedBySelfCheck: kept.length - findings.length,
    ruleCapHit: runRules(pack.bids, "", "", guards).length >= RULE_CAP,
  };
}

/* A bid file's bidder name, as the engine writes it in finding items: "02-bid-mediqueast.md" → "mediqueast". */
function bidderKey(file: string): string {
  return file.replace(/^\d+-bid-/, "").replace(/\.md$/, "").replace(/-/g, " ").toLowerCase();
}

const mentionsBidder = (f: Finding, file: string) => f.item.toLowerCase().includes(bidderKey(file));
const valueFlaggedBefore = (before: Finding[], file: string) =>
  before.some((f) => ["R-VALUE-OUTLIER", "R-OVER-BUDGET"].includes(f.rule) && mentionsBidder(f, file));

/* ── Mutations: one defect at a time, into a copy of the pack ───────────── */

interface Mutation {
  name: string;
  description: string;
  /** Returns the mutated sources, or null when the precondition does not hold (skipped). */
  apply(files: string[], sources: Record<string, string>, before: Finding[]): Record<string, string> | null;
  detect(after: Finding[], before: Finding[]): boolean;
}

const MUTATIONS: Mutation[] = [
  {
    name: "bid-value-x10",
    description: "a clean bid overstates its own value tenfold — value-outlier and over-budget rules must fire on that bidder",
    apply(files, sources, before) {
      const file = files.find((f) => /^\d+-bid-/.test(f) && BID_VALUE_LINE.test(sources[f]) && !valueFlaggedBefore(before, f));
      if (!file) return null;
      ctxFile = file;
      const mutated = { ...sources };
      mutated[file] = sources[file].replace(BID_VALUE_LINE, (_, p1: string, p2: string) => p1 + (Number(p2.replace(/,/g, "")) * 10).toLocaleString("en-US"));
      return mutated;
    },
    detect(after, before) {
      const file = ctxFile;
      return (
        after.some((f) => ["R-VALUE-OUTLIER", "R-OVER-BUDGET"].includes(f.rule) && mentionsBidder(f, file)) &&
        !valueFlaggedBefore(before, file)
      );
    },
  },
  {
    name: "hide-required-document",
    description: "a bid stops naming a REQUIRED document it currently provides — the missing-document rule must fire on that bidder",
    apply(files, sources) {
      const bidFile = files.find((f) => /^\d+-bid-/.test(f));
      const noticeFile = files.find((f) => /^01-/.test(f) && f.endsWith(".md"));
      if (!bidFile || !noticeFile) return null;
      const required = [...sources[noticeFile].matchAll(/^- \[REQUIRED\]\s*(.+)$/gm)].map((m) => m[1].trim());
      const provided = required.find((req) => requirementOptions(req.toLowerCase()).some((o) => bidNamesDocument(sources[bidFile], o)));
      if (!provided) return null;
      const need = requirementOptions(provided.toLowerCase());
      const lines = sources[bidFile].split("\n");
      const idx = lines.findIndex((l) => need.some((o) => bidNamesDocument(l, o)));
      if (idx < 0) return null;
      ctxFile = bidFile;
      ctxDoc = provided.toLowerCase();
      const mutated = { ...sources };
      mutated[bidFile] = lines.filter((_, i) => i !== idx).join("\n");
      return mutated;
    },
    detect(after, before) {
      const wasMissing = before.some((f) => f.rule === "R-DOC-MISSING" && mentionsBidder(f, ctxFile) && f.item.toLowerCase().includes(ctxDoc));
      const isMissing = after.some((f) => f.rule === "R-DOC-MISSING" && mentionsBidder(f, ctxFile) && f.item.toLowerCase().includes(ctxDoc));
      return isMissing && !wasMissing;
    },
  },
  {
    name: "corrupt-supplier-id",
    description: "a bid's KRA PIN is altered so it breaks its own 11-character scheme — the supplier-id rule must flag that identifier",
    apply(files, sources) {
      /* Same identifier-line shape the engine matches (ID_LINE lives in engine.ts). */
      const idLine = /^\s*(?:[-*]\s*)?\**\s*((?:(?:KRA|TAX)\s+)?PIN(?:\s*(?:No\.?|Number))?|TIN(?:\s*(?:No\.?|Number))?)\s*\**\s*[:\u2013\u2014]\s*\**\s*(.*?)\s*$/i;
      const pinValue = /^[PC][0-9]{9}[A-Z]$/; // a WELL-FORMED Kenya KRA PIN — corrupting one digit must fire the rule
      for (const bidFile of files.filter((f) => /^\d+-bid-/.test(f))) {
        const lines = sources[bidFile].split("\n");
        for (let idx = 0; idx < lines.length; idx++) {
          const m = lines[idx].match(idLine);
          if (!m) continue;
          const value = m[2].trim();
          if (!pinValue.test(value)) continue;
          const corrupted = value.replace(/(^\w)(\d{8})(\d)(\w$)/, "$1$2X$4");
          if (corrupted === value) continue;
          ctxFile = bidFile;
          ctxId = corrupted;
          const mutated = { ...sources };
          mutated[bidFile] = lines.map((l, i) => (i === idx ? l.replace(value, corrupted) : l)).join("\n");
          return mutated;
        }
      }
      return null;
    },
    detect(after, before) {
      const wasFlagged = before.some((f) => f.rule === "R-SUPPLIER-ID" && mentionsBidder(f, ctxFile) && f.evidence.includes(ctxId));
      const isFlagged = after.some((f) => f.rule === "R-SUPPLIER-ID" && mentionsBidder(f, ctxFile) && f.evidence.includes(ctxId));
      return isFlagged && !wasFlagged;
    },
  },
  {
    name: "remove-budget-ceiling",
    description: "the notice's published ceiling line is deleted — over-budget flags must go quiet (false-positive guard)",
    apply(files, sources, before) {
      const noticeFile = files.find((f) => /^01-/.test(f) && f.endsWith(".md"));
      if (!noticeFile || !CEILING_LINE.test(sources[noticeFile])) return null;
      if (!before.some((f) => f.rule === "R-OVER-BUDGET")) return null;
      const mutated = { ...sources };
      mutated[noticeFile] = sources[noticeFile].replace(CEILING_LINE, "").replace(/\n{3,}/g, "\n\n");
      return mutated;
    },
    detect(after) {
      return !after.some((f) => f.rule === "R-OVER-BUDGET");
    },
  },
  {
    name: "line-item-price-x10",
    description: "one price-schedule line is inflated tenfold — the peer-median price-outlier rule must fire on that bidder",
    apply(files, sources, before) {
      const bidFile = files.find((f) => /^\d+-bid-/.test(f));
      if (!bidFile) return null;
      const bidder = bidFile.replace(/^\d+-bid-/, "").replace(/\.md$/, "").replace(/-/g, " ").toUpperCase();
      const beforeItems = new Set(before.filter((f) => f.rule === "R-PRICE-OUTLIER").map((f) => f.item.toLowerCase()));
      const items = parseBid(sources[bidFile], "x", bidFile);
      const peers = files
        .filter((f) => /^\d+-bid-/.test(f) && f !== bidFile)
        .flatMap((f) => parseBid(sources[f], "y", f));
      const row = items.find((li) => {
        const key = li.item.split(" ").slice(0, 3).join(" ").toLowerCase();
        const hasPeers = peers.some((p) => p.item.split(" ").slice(0, 3).join(" ").toLowerCase() === key);
        /* Only rows not already flagged: mutating an already-flagged row can't produce a NEW finding. */
        const alreadyFlagged = beforeItems.has(`${li.item} × ${li.qty} — ${bidder}`.toLowerCase());
        return hasPeers && !alreadyFlagged;
      });
      if (!row) return null;
      const lines = sources[bidFile].split("\n");
      const idx = lines.findIndex((l) => l.startsWith("|") && l.includes(row.item.split(" ").slice(0, 3).join(" ")));
      if (idx < 0) return null;
      ctxFile = bidFile;
      const mutated = { ...sources };
      mutated[bidFile] = lines
        .map((l, i) =>
          i === idx
            ? l.replace(/^(\|\s*[^|]+?\s*\|\s*[\d,]+\s*\|\s*[A-Z]{3}\s*)([\d,]+(?:\.\d+)?)(.*)$/, (_, p1: string, p2: string, p3: string) => p1 + (Number(p2.replace(/,/g, "")) * 10).toLocaleString("en-US") + p3)
            : l,
        )
        .join("\n");
      return mutated;
    },
    detect(after, before) {
      const beforeItems = new Set(before.filter((f) => f.rule === "R-PRICE-OUTLIER").map((f) => f.item.toLowerCase()));
      return after.some((f) => f.rule === "R-PRICE-OUTLIER" && mentionsBidder(f, ctxFile) && !beforeItems.has(f.item.toLowerCase()));
    },
  },
];

/* Mutable context a mutation hands to its detector (single-threaded loop — safe). */
let ctxFile = "";
let ctxDoc = "";
let ctxId = "";

/* A finding matches a label when the rule agrees, it names the bid (directly or via the bidder), and the anchor text appears. */
function matches(f: Finding, g: GoldItem): boolean {
  if (f.rule !== g.rule) return false;
  const item = f.item.toLowerCase();
  const named = f.citation.includes(g.file) || (g.file.includes("-bid-") && item.includes(bidderKey(g.file)));
  return named && `${f.item} ${f.evidence}`.toLowerCase().includes(g.match.toLowerCase());
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const gold: Gold = JSON.parse(await readFile(join(EVAL_DIR, "gold.json"), "utf8"));
const tenderIds = Object.keys(gold.tenders).sort();

/* Scores one variant. "original" ignores postHoc labels, so a post-hoc match counts as unlabelled. */
function score(variant: "original" | "adjudicated", ids: string[] = tenderIds) {
  let goldTotal = 0;
  let coveredTotal = 0;
  let goldHits = 0;
  let coveredHits = 0;
  let findingsTotal = 0;
  let findingsMatched = 0;
  const per: Record<string, { missed: GoldItem[]; unlabelled: Finding[]; goldHit: number; gold: number }> = {};
  for (const id of ids) {
    const gl = gold.tenders[id].filter((g) => variant === "adjudicated" || !g.postHoc);
    const f = results[id].findings;
    const hits = gl.map((g) => f.some((x) => matches(x, g)));
    const unlabelled = f.filter((x) => !gl.some((g) => matches(x, g)));
    goldTotal += gl.length;
    coveredTotal += gl.filter((g) => g.covered).length;
    goldHits += hits.filter(Boolean).length;
    coveredHits += gl.filter((g, i) => g.covered && hits[i]).length;
    findingsTotal += f.length;
    findingsMatched += f.length - unlabelled.length;
    per[id] = {
      missed: gl.filter((_, i) => !hits[i]),
      unlabelled,
      goldHit: hits.filter(Boolean).length,
      gold: gl.length,
    };
  }
  return {
    per,
    summary: {
      goldLabels: goldTotal,
      coveredLabels: coveredTotal,
      recallCovered: coveredTotal ? Math.round((coveredHits / coveredTotal) * 1000) / 10 : null,
      recallAll: goldTotal ? Math.round((goldHits / goldTotal) * 1000) / 10 : null,
      precision: findingsTotal ? Math.round((findingsMatched / findingsTotal) * 1000) / 10 : null,
      findingsTotal,
      findingsUnlabelled: findingsTotal - findingsMatched,
    },
  };
}

/* Run once per tender, then repeat to measure variation. */
const results: Record<string, Awaited<ReturnType<typeof runOnce>> & { identical: boolean; medianMs: number; msMin: number; msMax: number }> = {};
for (const tenderId of tenderIds) {
  const first = await runOnce(tenderId);
  const serial = JSON.stringify(first.findings);
  const timings = [first.ms];
  let identical = true;
  for (let i = 1; i < RUNS; i++) {
    const again = await runOnce(tenderId);
    timings.push(again.ms);
    if (JSON.stringify(again.findings) !== serial) identical = false;
  }
  results[tenderId] = {
    ...first,
    identical,
    medianMs: Math.round(median(timings) * 100) / 100,
    msMin: Math.round(Math.min(...timings) * 100) / 100,
    msMax: Math.round(Math.max(...timings) * 100) / 100,
  };
}

const original = score("original");
const adjudicated = score("adjudicated");
const identicalRuns = tenderIds.filter((id) => results[id].identical).length;

/* ── Mutation runs — repeated, with published detection rates ───────────── */
const mutationTenders: { tender: string; mutations: { name: string; description: string; runs: number; detected: number; detectionRate: number | null; skipped: boolean }[] }[] = [];
for (const tenderId of tenderIds) {
  const { files, sources } = await readPack(tenderId);
  const before = evalSources(files, sources);
  const per: { name: string; description: string; runs: number; detected: number; detectionRate: number | null; skipped: boolean }[] = [];
  for (const m of MUTATIONS) {
    ctxFile = "";
    ctxDoc = "";
    ctxId = "";
    let detected = 0;
    let skipped = false;
    for (let i = 0; i < RUNS; i++) {
      const mutated = m.apply(files, structuredClone(sources), before);
      if (mutated === null) {
        skipped = true;
        break;
      }
      if (m.detect(evalSources(files, mutated), before)) detected += 1;
    }
    per.push({
      name: m.name,
      description: m.description,
      runs: skipped ? 0 : RUNS,
      detected,
      detectionRate: skipped ? null : Math.round((detected / RUNS) * 1000) / 10,
      skipped,
    });
  }
  mutationTenders.push({ tender: tenderId, mutations: per });
}

const flatMutations = mutationTenders.flatMap((t) => t.mutations).filter((m) => !m.skipped);
const mutationSummary = {
  repeatsPerMutation: RUNS,
  executed: flatMutations.length,
  skipped: mutationTenders.flatMap((t) => t.mutations).filter((m) => m.skipped).length,
  overallDetectionRate: flatMutations.length
    ? Math.round((flatMutations.reduce((n, m) => n + m.detected, 0) / (flatMutations.length * RUNS)) * 1000) / 10
    : null,
  note: "Detection = the engine raises (or, for the removed-ceiling guard, drops) the expected finding. Skipped = the mutation's precondition did not hold for that tender; reported, never counted as a pass.",
};

const packMedians = tenderIds.map((id) => results[id].medianMs);
const summary = {
  runsPerTender: RUNS,
  tenders: tenderIds.length,
  /* The settings these scores were measured under — the report says it, so a
     reader never has to guess which guard set produced the numbers. */
  guards: {
    priceVariancePct: guards.priceVariancePct,
    checklist: guards.checklist,
    registryCrossCheck: guards.registryCrossCheck,
  },
  original: original.summary,
  adjudicated: adjudicated.summary,
  identicalAcrossRuns: `${identicalRuns}/${tenderIds.length} tenders`,
  llmCallsPerRun: 0,
  variance: {
    findingsIdenticalAcrossRuns: `${identicalRuns}/${tenderIds.length} tenders`,
    msMedianPerPack: Math.round(median(packMedians) * 100) / 100,
    msSpread: [Math.round(Math.min(...packMedians) * 100) / 100, Math.round(Math.max(...packMedians) * 100) / 100],
    note: "Identical findings across repeated runs prove stability, not sensitivity — the mutation detection rates below are the sensitivity check. This report does NOT measure LLM run-to-run variance: no drafting endpoint runs in this loop. On a live endpoint the sidecar records per-draft usage in tool-log.jsonl and state.json, and the run register shows per-run draft variation.",
  },
  cost: {
    llmCallsPerRun: 0,
    promptTokensPerRun: 0,
    completionTokensPerRun: 0,
    costUsdPerRun: 0,
    note: "The rule-path eval makes no model calls, so the measured cost of this report is 0 USD. On a live endpoint, cost per run = (prompt_tokens + completion_tokens) × the endpoint's published per-token price; usage per draft is recorded in tool-log.jsonl and on the run's usage block, so the figure is auditable from the append-only log.",
  },
  mutation: mutationSummary,
  heldOut: {
    tenders: gold.heldOut,
    labelsWrittenBeforeRun: true,
    original: score("original", gold.heldOut).summary,
  },
};

const tenders = tenderIds.map((id) => {
  const r = results[id];
  const a = adjudicated.per[id];
  return {
    tender: id,
    findings: r.findings.length,
    gold: a.gold,
    goldHit: a.goldHit,
    missed: a.missed.map((g) => ({ rule: g.rule, file: g.file, match: g.match, covered: g.covered, postHoc: !!g.postHoc, note: g.note })),
    unlabelled: a.unlabelled.map((f) => ({ rule: f.rule, item: f.item, citation: f.citation, evidence: f.evidence })),
    rejectedUncited: r.rejectedCount,
    droppedBySelfCheck: r.droppedBySelfCheck,
    ruleCapHit: r.ruleCapHit,
    identicalAcrossRuns: r.identical,
    medianMs: r.medianMs,
    msRange: [r.msMin, r.msMax],
    mutations: mutationTenders.find((t) => t.tender === id)?.mutations.map((m) => ({ name: m.name, detectionRate: m.detectionRate, skipped: m.skipped })),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  labeller: gold.labeller,
  covered_means: gold.covered_means,
  summary,
  tenders,
  data_quality_notes: gold.data_quality_notes,
};

await writeFile(join(EVAL_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");

console.log(JSON.stringify(summary, null, 2));
for (const t of tenders) {
  console.log(
    `${t.tender}: findings=${t.findings} gold=${t.goldHit}/${t.gold} unlabelled=${t.unlabelled.length} missed=${t.missed.length} identical=${t.identicalAcrossRuns} ms=${t.medianMs} [${t.msRange[0]}–${t.msRange[1]}]`,
  );
  for (const m of t.mutations ?? []) {
    console.log(`  · ${m.name}: ${m.skipped ? "skipped (precondition)" : `${m.detectionRate}% detected`}`);
  }
}
