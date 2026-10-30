import { state, toolLog, type Gate, type Run } from "./store";
import { modelAttributionForRun } from "./model";

/**
 * GET /api/runs/:id/report — the sourced report as a downloadable Markdown file.
 *
 * Committee-facing and citations-first: every finding carries its source path
 * and evidence, drafts carry model attribution, and the human-gate decision is
 * part of the record. Content-Disposition: attachment so a browser click
 * downloads the file instead of navigating.
 */

function mdEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "\\`").replace(/\n/g, " ");
}

function gateWord(g: Gate | undefined): string {
  if (!g) return "—";
  if (g.status === "EXECUTED") return `APPROVED by ${g.approver ?? "—"} → FILED (receipt ${g.receipt?.submissionId ?? "—"}, sha256 ${g.receipt?.hash ?? "—"})`;
  if (g.status === "APPROVED") return `APPROVED by ${g.approver ?? "—"} (filing in progress)`;
  if (g.status === "REJECTED") return `RETURNED by ${g.approver ?? "—"}${g.note ? ` — "${g.note}"` : ""}`;
  if (g.status === "PENDING") return `AWAITING NAMED SIGN-OFF (gate ${g.id})`;
  return g.status;
}

/* Explicit, conservative price assumptions for the cost line. These are ASSUMPTIONS, not a
   quote — replace them with the endpoint's real pricing. Every sourced report labels the
   estimate as estimated, and records the token counts it was computed from. */
const ASSUMED_USD_PER_MTOK = { input: 2, output: 8 };

function costLine(run: Run): string {
  const u = run.usage ?? { drafts: 0, llmDrafts: 0, promptTokens: 0, completionTokens: 0 };
  const tokens = u.promptTokens + u.completionTokens;
  const usd = (u.promptTokens / 1e6) * ASSUMED_USD_PER_MTOK.input + (u.completionTokens / 1e6) * ASSUMED_USD_PER_MTOK.output;
  if (tokens === 0) {
    return `Template mode — 0 model tokens, estimated model spend **$0.0000**. Redlines came from the deterministic fallback, so the recorded cost is drafting latency only.`;
  }
  return `Estimated model spend **$${usd.toFixed(4)}** for ${tokens.toLocaleString()} tokens (${u.promptTokens.toLocaleString()} in / ${u.completionTokens.toLocaleString()} out) across ${u.drafts} draft(s), ${u.llmDrafts} from the model. Assumes USD ${ASSUMED_USD_PER_MTOK.input.toFixed(2)}/1M input + USD ${ASSUMED_USD_PER_MTOK.output.toFixed(2)}/1M output — an explicit assumption, not a quote; replace with the endpoint's real pricing.`;
}

export function buildReport(runId: string): { filename: string; markdown: string } | null {
  const run = state.runs.find((r) => r.id === runId);
  if (!run) return null;

  const gate = state.gates.find((g) => g.runId === run.id);
  const audit = toolLog.filter((l) => l.runId === run.id);
  const lines: string[] = [];

  lines.push(`# Sourced report — tender ${run.tenderId}`);
  lines.push("");
  lines.push(`> Prepared by the quorum-agent (MCP tool registry, LangGraph.js graphs).`);
  lines.push(`> The agent prepares the file; the committee awards the tender.`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Run | ${run.id} |`);
  lines.push(`| Tender | ${run.tenderId} |`);
  lines.push(`| Status | ${run.status} |`);
  lines.push(`| Started | ${run.startedAt} |`);
  lines.push(`| Updated | ${run.updatedAt} |`);
  lines.push(`| Human gate | ${gateWord(gate)} |`);
  lines.push("");

  /* Attribution is part of the committee file: which model planned the review,
     which model wrote each accepted draft, and the exact strings the endpoint
     returned. Template mode is stated, never disguised as model output. */
  const attribution = modelAttributionForRun(run);
  lines.push("## Model attribution");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Review plan | ${attribution.planSource === "llm" ? `model-led (\`${attribution.planModel ?? "model"}\`)` : "deterministic pack inspection"} |`);
  lines.push(`| Drafts from the model | ${attribution.draftLlm} of ${attribution.draftTotal} |`);
  lines.push(`| Drafts from template | ${attribution.draftTemplate} |`);
  lines.push(`| Model(s) returned by the endpoint | ${attribution.models.length ? attribution.models.map((m) => `\`${m}\``).join(", ") : "none — template mode"} |`);
  lines.push(`| Tokens | ${(attribution.promptTokens + attribution.completionTokens).toLocaleString()} (${attribution.promptTokens.toLocaleString()} in / ${attribution.completionTokens.toLocaleString()} out) |`);
  lines.push("");

  if (run.plan) {
    lines.push(`## Review plan (${run.plan.source})`);
    lines.push("");
    lines.push(
      `Decided before any rule ran — ${run.plan.source === "llm" ? `by the model (\`${run.plan.model ?? "llm"}\`)` : "by deterministic pack inspection (no model configured)"}. ${run.plan.note}`,
    );
    lines.push("");
    lines.push("| Plan field | Value |");
    lines.push("| --- | --- |");
    lines.push(`| Value parsing | ${run.plan.parseMarkdownValues ? "deep (markdown bid values + OCDS records)" : "OCDS records only"} |`);
    lines.push(`| Rule focus | ${run.plan.focusRules.join(" > ")} |`);
    lines.push(`| Max redline drafts | ${run.plan.maxDrafts} |`);
    lines.push(`| Pack | ${run.plan.pack.files} files · ${run.plan.pack.bids} bids · ${run.plan.pack.ocdsRecords} OCDS records |`);
    lines.push("");
  }

  lines.push("## Review timeline");
  lines.push("");
  if (run.progress.length > 0) for (const step of run.progress) lines.push(`- ${step}`);
  else lines.push("_No progress recorded._");
  lines.push("");

  lines.push(`## Requirements pinned (${run.requirements.length})`);
  lines.push("");
  if (run.requirements.length > 0) {
    lines.push("| Req | Clause | Page |");
    lines.push("| --- | --- | --- |");
    for (const req of run.requirements) lines.push(`| ${req.id} | ${mdEscape(req.clause)} | ${req.page} |`);
  } else lines.push("_No SHALL/must clauses pinned._");
  lines.push("");

  lines.push(`## Findings (${run.findings.length}) — every claim cites its source`);
  lines.push("");
  if (run.findings.length > 0) {
    for (const f of run.findings) {
      lines.push(`### ${f.id} · ${f.rule} · ${f.severity}`);
      lines.push("");
      lines.push(`- **Issue:** ${f.item}`);
      lines.push(`- **Evidence:** ${f.evidence}`);
      lines.push(`- **Citation:** \`${f.citation}\``);
      if (f.repaired) {
        lines.push(`- **Self-check repair:** initially refused by verify_findings; re-anchored by the bounded repair loop (verify → revise → verify) and re-confirmed against the cited document.`);
      }
      const draft = run.drafts.find((d) => d.findingId === f.id);
      if (draft) {
        lines.push(`- **Original clause:** ${mdEscape(draft.original)}`);
        lines.push(`- **Proposed redline:** ${mdEscape(draft.proposed)}`);
        lines.push(`- **Rationale** (drafted by \`${draft.model}\`): ${mdEscape(draft.rationale)}`);
      }
      if (f.review) {
        lines.push(`- **Human disposition:** ${f.review.decision} by **${mdEscape(f.review.by)}** at ${f.review.at}${f.review.note ? ` — “${mdEscape(f.review.note)}”` : ""}`);
      } else {
        lines.push("- **Human disposition:** pending — this model-surfaced finding has not been accepted or rejected by a named reviewer yet.");
      }
      lines.push("");
    }
  } else lines.push("_No findings raised — the pack reviewed clean against the selected checks._");
  lines.push("");

  /* Phase 6 (AI safety): the disposition roll-up — an auditor reads this
     section to see exactly which model suggestions a human accepted, which
     they refused and why, without reconstructing it from the log. */
  const dispositions = run.findings.filter((f) => f.review);
  lines.push("## Human review of model output");
  lines.push("");
  if (dispositions.length > 0) {
    lines.push("| Finding | Rule | Decision | Reviewer | When | Reason |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const f of dispositions) {
      lines.push(`| ${f.id} | ${f.rule} | ${f.review!.decision} | ${mdEscape(f.review!.by)} | ${f.review!.at.slice(0, 16).replace("T", " ")} | ${f.review!.note ? mdEscape(f.review!.note) : "—"} |`);
    }
    const accepted = dispositions.filter((f) => f.review!.decision === "ACCEPTED").length;
    const rejected = dispositions.length - accepted;
    lines.push("");
    lines.push(`_${accepted} accepted · ${rejected} rejected · ${run.findings.length - dispositions.length} still pending human review._`);
  } else {
    lines.push(run.findings.length > 0
      ? "_No dispositions recorded yet — every finding above still awaits a named reviewer._"
      : "_Nothing to review — the model raised no findings on this run._");
  }
  lines.push("");

  lines.push(`## Redline drafts (${run.drafts.length})`);
  lines.push("");
  if (run.drafts.length > 0) {
    for (const d of run.drafts) {
      lines.push(`### ${d.id} (finding ${d.findingId})`);
      lines.push("");
      lines.push(`- **Original:** ${mdEscape(d.original)}`);
      lines.push(`- **Proposed:** ${mdEscape(d.proposed)}`);
      lines.push(`- **Rationale:** ${mdEscape(d.rationale)}`);
      lines.push(`- **Model:** \`${d.model}\``);
      lines.push("");
    }
  } else lines.push("_No redlines drafted._");
  lines.push("");

  lines.push(`## Audit trail (${audit.length} logged calls for this run)`);
  lines.push("");
  if (audit.length > 0) {
    lines.push("| Time | Actor | Server | Tool | Kind | Status |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const l of audit) {
      lines.push(
        `| ${l.ts} | ${mdEscape(l.actor)} | ${mdEscape(l.server)} | ${l.tool} | ${l.kind} | ${l.status} |`
      );
    }
  } else lines.push("_No audit entries reference this run._");
  lines.push("");

  lines.push("## Run cost (estimated)");
  lines.push("");
  lines.push(costLine(run));
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    `*Signed off per the standing rule: irreversible filing only after a named human approved (${
      gateWord(gate)
    }). Full ledger: tool-log.jsonl (append-only).*`
  );

  const filename = `quorum-report-${run.tenderId.replace(/[^A-Za-z0-9._-]+/g, "_")}-${run.id}.md`;
  return { filename, markdown: lines.join("\n") };
}

export function handleReportRequest(runId: string): Response {
  const report = buildReport(runId);
  if (!report) {
    return new Response(JSON.stringify({ error: "run not found" }), {
      status: 404,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }
  return new Response(report.markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${report.filename}"`,
      "access-control-allow-origin": "*",
    },
  });
}
