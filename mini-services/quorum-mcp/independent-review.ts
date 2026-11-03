/**
 * Independent second-review pack and scorecard.
 *
 * The reviewer packet includes source documents and a blank annotation form;
 * it deliberately excludes gold labels, model observations and engine results.
 * The later score is reported as rule-and-source-file agreement, not as a
 * broader clinical/legal accuracy claim.
 *
 * Usage:
 *   bun mini-services/quorum-mcp/independent-review.ts prepare
 *   bun mini-services/quorum-mcp/independent-review.ts score <completed-reviewer-pack.json>
 */

import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "./paths";
import { buildPack, flagPack, maskedQuoteMatches, TENDERS_DIR, verifyFinding } from "./engine";
import { readPersistedGuardContext, type Finding } from "./store";

interface ReviewerFinding {
  rule: string;
  citation: string;
  bidder?: string;
  issue: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  quote: string;
  rationale?: string;
}

interface ReviewerCase {
  caseId: string;
  sourceBundleSha256: string;
  completed: boolean;
  findings: ReviewerFinding[];
}

interface ReviewerPack {
  schemaVersion: 1;
  reviewerId: string;
  cases: ReviewerCase[];
}

const ROOT = path.join(resolveDataDir(), "eval", "independent-review");
const TEMPLATE = path.join(ROOT, "reviewer-pack.json");
const CODES: string[] = ["R-DOC-MISSING", "R-PRICE-OUTLIER", "R-VALUE-OUTLIER", "R-OVER-BUDGET", "R-AWARD-OVER-BUDGET", "R-SPEC-DEVIATION", "R-SUPPLIER-ID", "R-BUYER-MISSING", "R-BID-SECURITY", "R-DEBARMENT-HIT", "R-REGISTRY", "R-REGISTRY-STATUS", "R-INJECTION", "R-PROMPT-INJECTION", "R-ID", "R-OTHER"];

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function preparePack(): Promise<string> {
  const dirs = await readdir(TENDERS_DIR, { withFileTypes: true });
  const tenderDirs = dirs.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const cases: { caseId: string; sourceBundleSha256: string; sourceFiles: { name: string; sha256: string; text: string }[]; completed: boolean; findings: ReviewerFinding[] }[] = [];
  for (let index = 0; index < tenderDirs.length; index += 1) {
    const tenderId = tenderDirs[index];
    const files = (await readdir(path.join(TENDERS_DIR, tenderId))).filter((file) => /\.(md|json|txt)$/i.test(file)).sort();
    if (!files.length) continue;
    const sourceFiles: { name: string; sha256: string; text: string }[] = [];
    for (const name of files) {
      const text = await readFile(path.join(TENDERS_DIR, tenderId, name), "utf8");
      sourceFiles.push({ name, sha256: digest(text), text });
    }
    cases.push({
      caseId: `CASE-${String(cases.length + 1).padStart(3, "0")}`,
      sourceBundleSha256: digest(sourceFiles.map((file) => `${file.name}:${file.sha256}`).join("\n")),
      sourceFiles,
      completed: false,
      findings: [] as ReviewerFinding[],
    });
  }
  await mkdir(ROOT, { recursive: true });
  const reviewerPack = {
    schemaVersion: 1 as const,
    reviewerId: "",
    instructions: {
      reviewerId: "Enter your name or reviewer code in the top-level reviewerId field.",
      independentReview: "Review every source document before recording findings. Do not consult Quorum findings, previous labels, model output, or adjudicated results until this file is complete.",
      completion: "Set completed=true for every case, including cases with no findings. Preserve each caseId, sourceBundleSha256, and sourceFiles value unchanged. Use exact source filenames and verbatim source quotes. Use R-OTHER for a relevant issue outside the listed rule types.",
      ruleCodes: CODES,
      findingFields: ["rule", "citation", "bidder", "issue", "severity", "quote", "rationale"],
      agreementScope: "The score compares rule code and cited source file only; it does not claim that severity, legal interpretation, or award recommendation is equivalent.",
    },
    cases,
  };
  await writeFile(TEMPLATE, `${JSON.stringify(reviewerPack, null, 2)}\n`);
  await writeFile(path.join(ROOT, "README.md"), `# Independent second review\n\nGive \`reviewer-pack.json\` to a procurement reviewer who has not seen Quorum's findings or the existing evaluation labels. It contains the source documents, stable case IDs, and a blank finding form only. The pack does not include \`gold.json\`, model observations, or engine output.\n\nAsk the reviewer to complete every case, including cases with no findings. Preserve source filenames and quote exact text. When the reviewer returns the completed file, run:\n\n\`\`\`sh\nbun mini-services/quorum-mcp/independent-review.ts score /path/to/completed-reviewer-pack.json\n\`\`\`\n\nThe resulting report measures same-rule/same-source-file agreement, one-to-one matching, and whether reviewer quotes are present in the source files. It does not turn a small synthetic pack into a field pilot or legal accuracy claim.\n`);
  return TEMPLATE;
}

function pairKey(rule: string, citation: string): string {
  return `${rule.trim().toUpperCase()}|${citation.trim()}`;
}

async function engineLabels(tenderId: string): Promise<Finding[]> {
  const files = (await readdir(path.join(TENDERS_DIR, tenderId))).filter((file) => /\.(md|json|txt)$/i.test(file)).sort();
  const sources: Record<string, string> = {};
  for (const file of files) sources[file] = await readFile(path.join(TENDERS_DIR, tenderId, file), "utf8");
  const pack = buildPack(files, sources);
  const { guards, registry } = await readPersistedGuardContext();
  const { kept } = flagPack(pack, files, undefined, { guards, registry });
  return kept.filter((finding) => verifyFinding(finding, sources));
}

async function scoreBySourceHash(inputPath: string): Promise<Record<string, unknown>> {
  /* A reviewer pack intentionally omits tender IDs. Match it to the current
     staged source packs by their content hash before comparing outputs. */
  const submitted = JSON.parse(await readFile(inputPath, "utf8")) as ReviewerPack;
  const prepared = JSON.parse(await readFile(TEMPLATE, "utf8")) as { cases: { caseId: string; sourceBundleSha256: string; sourceFiles: { name: string; sha256: string; text: string }[] }[] };
  const sourceByCase = new Map(prepared.cases.map((row) => [row.caseId, row]));
  if (submitted.schemaVersion !== 1 || !submitted.reviewerId?.trim() || !Array.isArray(submitted.cases)) throw new Error("reviewer submission must include schemaVersion 1, reviewerId, and cases");
  if (submitted.cases.length !== prepared.cases.length || new Set(submitted.cases.map((row) => row.caseId)).size !== submitted.cases.length) throw new Error("reviewer submission must contain each prepared case exactly once");
  const dirs = (await readdir(TENDERS_DIR, { withFileTypes: true })).filter((row) => row.isDirectory()).map((row) => row.name);
  const idByCase = new Map<string, string>();
  for (const sourceCase of prepared.cases) {
    for (const tenderId of dirs) {
      const files = (await readdir(path.join(TENDERS_DIR, tenderId))).filter((file) => /\.(md|json|txt)$/i.test(file)).sort();
      const records: string[] = [];
      for (const name of files) records.push(`${name}:${digest(await readFile(path.join(TENDERS_DIR, tenderId, name), "utf8"))}`);
      if (digest(records.join("\n")) === sourceCase.sourceBundleSha256) {
        idByCase.set(sourceCase.caseId, tenderId);
        break;
      }
    }
  }
  const comparisonRows: { caseId: string; independentRuleFilePairs: number; engineRuleFilePairs: number; matchedPairs: number }[] = [];
  let humanPairs = 0;
  let machinePairs = 0;
  let matchedPairs = 0;
  let quoteCount = 0;
  let validQuotes = 0;
  for (const reviewed of submitted.cases) {
    if (!reviewed.completed) throw new Error(`case ${reviewed.caseId} is not marked completed`);
    const source = sourceByCase.get(reviewed.caseId);
    const tenderId = idByCase.get(reviewed.caseId);
    if (!source || !tenderId) throw new Error(`source pack changed or disappeared for ${reviewed.caseId}; prepare a fresh independent-review pack`);
    if (reviewed.sourceBundleSha256 !== source.sourceBundleSha256) throw new Error(`source checksum mismatch for ${reviewed.caseId}; annotations must be tied to the prepared documents`);
    const human = new Set<string>();
    const sources = Object.fromEntries(source.sourceFiles.map((file) => [file.name, file.text]));
    for (const finding of reviewed.findings ?? []) {
      if (!CODES.includes(finding.rule) || !sources[finding.citation] || !finding.issue?.trim() || !finding.quote?.trim()) throw new Error(`invalid finding annotation in ${reviewed.caseId}`);
      human.add(pairKey(finding.rule, finding.citation));
      quoteCount += 1;
      if (maskedQuoteMatches(sources[finding.citation], finding.quote)) validQuotes += 1;
    }
    const machineRows = await engineLabels(tenderId);
    const machine = new Set(machineRows.map((finding) => pairKey(finding.rule, finding.citation)));
    const matches = [...machine].filter((key) => human.has(key)).length;
    humanPairs += human.size;
    machinePairs += machine.size;
    matchedPairs += matches;
    comparisonRows.push({ caseId: reviewed.caseId, independentRuleFilePairs: human.size, engineRuleFilePairs: machine.size, matchedPairs: matches });
  }
  const precision = machinePairs ? matchedPairs / machinePairs : null;
  const recall = humanPairs ? matchedPairs / humanPairs : null;
  const report = {
    generatedAt: new Date().toISOString(),
    reviewerId: submitted.reviewerId.trim().slice(0, 120),
    methodology: {
      unit: "unique rule code + cited source file within a case",
      precisionRecallScope: "Coarse detection agreement with an independent human review; issues with different detail in the same rule/file are counted as one unit. This is not legal accuracy or award-quality certification.",
      quoteValidity: "Each human quote is checked against the unchanged source pack using redaction-aware matching.",
    },
    summary: {
      casesCompleted: submitted.cases.length,
      independentRuleFilePairs: humanPairs,
      engineRuleFilePairs: machinePairs,
      matchedPairs,
      precision: precision === null ? null : Number(precision.toFixed(4)),
      recall: recall === null ? null : Number(recall.toFixed(4)),
      f1: precision === null || recall === null || precision + recall === 0 ? null : Number((2 * precision * recall / (precision + recall)).toFixed(4)),
      sourceQuotesValid: validQuotes,
      sourceQuotesSubmitted: quoteCount,
      quoteValidityRate: quoteCount ? Number((validQuotes / quoteCount).toFixed(4)) : null,
    },
    cases: comparisonRows,
  };
  const reportPath = path.join(path.dirname(inputPath), `independent-review-report-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath };
}

if (import.meta.main) {
  const [command, input] = process.argv.slice(2);
  if (command === "prepare") {
    console.log(JSON.stringify({ reviewerPack: await preparePack() }, null, 2));
  } else if (command === "score" && input) {
    console.log(JSON.stringify(await scoreBySourceHash(input), null, 2));
  } else {
    console.error("Usage: bun independent-review.ts prepare | score <completed-reviewer-pack.json>");
    process.exitCode = 2;
  }
}
