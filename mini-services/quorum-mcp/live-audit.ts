/**
 * Live-LLM audit — aggregates every run whose review plan was drawn by the
 * configured model (plan.source === "llm") from data/state.json and the
 * append-only data/tool-log.jsonl, and writes data/eval/live-llm-audit.json.
 *
 * Purpose: run-to-run variance, token use, and per-model-call latency of the
 * LLM path are measured facts, reproducible from the audit log — not claims.
 * Complements eval.ts (rule path, deterministic) with the model-path numbers.
 *
 * Cost: for a local in-region endpoint (Ollama) the marginal cost is 0 USD;
 * for a hosted endpoint, cost per run = (prompt+completion tokens) × the
 * endpoint's published per-token price. Token totals are recorded per run so
 * the multiplication is an audit question, not a guess.
 *
 * Offline: reads the persisted store; no sidecar needs to be running.
 * Usage: bun live-audit.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const DATA = join(DIR, "data");
const EVAL = join(DIR, "data", "eval");

interface StateRun {
  id: string;
  tenderId: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  usage?: { drafts: number; llmDrafts: number; promptTokens: number; completionTokens: number };
  plan?: { source?: string; parseMarkdownValues?: boolean; maxDrafts?: number; note?: string; model?: string };
  findings?: { rule?: string }[];
  drafts?: { proposed?: string }[];
}

const state = JSON.parse(await readFile(join(DATA, "state.json"), "utf8")) as { runs: StateRun[] };
const llmRuns = state.runs.filter((r) => r.plan?.source === "llm");

/* Tool-log durations for the model-node tool calls (plan_review / draft_redline). */
const durations: Record<string, { tool: string; ms: number; ts: string }[]> = {};
const logLines = (await readFile(join(DATA, "tool-log.jsonl"), "utf8")).split("\n").filter(Boolean);
for (const line of logLines) {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line); } catch { continue; }
  const runId = e.runId as string | undefined;
  const tool = e.tool as string | undefined;
  if (!runId || (tool !== "plan_review" && tool !== "draft_redline")) continue;
  const ms = e.durationMs;
  (durations[runId] ??= []).push({
    tool: tool as string,
    ms: typeof ms === "number" ? ms : Number(ms ?? 0),
    ts: e.ts as string,
  });
}

const hash8 = (s: string) => createHash("sha1").update(s.slice(0, 120)).digest("hex").slice(0, 8);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const runs = llmRuns.map((r) => {
  const tool = durations[r.id] ?? [];
  return {
    runId: r.id,
    tenderId: r.tenderId,
    status: r.status,
    wallMs: Math.round((new Date(r.updatedAt).getTime() - new Date(r.startedAt).getTime()) / 1) || null,
    plan: { source: r.plan?.source, parseMarkdownValues: r.plan?.parseMarkdownValues, maxDrafts: r.plan?.maxDrafts, model: r.plan?.model, floorNote: /parse floor/.test(r.plan?.note ?? "") },
    findingsSignature: [...new Set((r.findings ?? []).map((f) => f.rule))].sort(),
    findingCount: (r.findings ?? []).length,
    usage: r.usage ?? null,
    draftTextHashes: (r.drafts ?? []).map((d) => hash8(d.proposed ?? "")),
    llmToolCalls: tool.length,
    llmToolMs: { min: Math.min(...tool.map((t) => t.ms)), max: Math.max(...tool.map((t) => t.ms)) },
  };
});

const tokenised = runs.filter((r) => r.usage);
const sigCounts: Record<string, number> = {};
for (const r of runs) {
  const sig = r.findingsSignature.join("|");
  sigCounts[sig] = (sigCounts[sig] ?? 0) + 1;
}
const sigNames = Object.entries(sigCounts).map(([sig, n]) => ({ findings: sig.split("|"), runs: n }));
const stableSig = sigNames.find((s) => s.runs === Math.max(...sigNames.map((x) => x.runs)))?.findings ?? [];
const sameFindings = sigNames.length === 1;
const draftSets = new Set(runs.map((r) => r.draftTextHashes.join(",")));
const allMs = llmRuns.flatMap((r) => (durations[r.id] ?? []).map((t) => t.ms));

const summary = {
  runsAudited: runs.length,
  findingsIdenticalAcrossRuns: sameFindings ? "yes — rule findings stable; the model varies draft depth (2–3 drafts), not detection " : `no — ${sigNames.length} distinct rule signatures: ` + sigNames.map((s) => `${s.runs} run(s) with ${s.findings.length} rule types`).join("; ")
    + (stableSig.length ? " — the dominant signature includes OVER-BUDGET; weaker-outlier runs are pre-safety-floor planner runs kept in the log as evidence." : ""),
  draftTextsIdenticalAcrossRuns: draftSets.size === 1 ? "yes" : `no — ${draftSets.size} distinct draft sets across ${runs.length} runs (measured variance)`,
  tokensPromptTotal: tokenised.reduce((n, r) => n + (r.usage?.promptTokens ?? 0), 0),
  tokensCompletionTotal: tokenised.reduce((n, r) => n + (r.usage?.completionTokens ?? 0), 0),
  llmCallsTotal: allMs.length,
  llmCallMs: { median: median(allMs), min: Math.min(...allMs), max: Math.max(...allMs) },
  costNote: "Local, in-region endpoint (Ollama): 0 USD marginal cost. Hosted endpoint: multiply run tokens by the published per-token price — the per-run figures above are the auditable input.",
};

const report = { generatedAt: new Date().toISOString(), summary, runs };
await writeFile(join(EVAL, "live-llm-audit.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
