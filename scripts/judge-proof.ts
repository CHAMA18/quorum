/** Reproducible integration proof on fictional Zambia tender data.
 * Never edits the normal workspace store, sends email, or files to a national
 * portal. Authenticated demo accounts exercise the real HTTP approval path.
 * bun scripts/judge-proof.ts [--template] [--production] [--keep-server]
 */
import { createHash, randomBytes, generateKeyPairSync } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import type { TenderCycle } from "../mini-services/quorum-mcp/store";

if (process.argv.includes("--help")) {
  console.log("bun scripts/judge-proof.ts [--template] [--production] [--keep-server]\nUses isolated temporary stores and ports 3100/3131. Live mode calls the configured Meta model. No national filing or external messages.");
  process.exit(0);
}

const root = path.resolve(import.meta.dir, "..");
const work = mkdtempSync(path.join(tmpdir(), "quorum-judge-proof-"));
const data = path.join(work, "sidecar");
const output = path.join(root, "SUBMISSION/evidence", process.argv.includes("--template") ? "template-run" : "current-run");
const origin = "http://127.0.0.1:3100";
const sidecar = "http://127.0.0.1:3131";
const tenderId = "ZM-DEMO-2026-001";
const password = "FixtureOnly-Quorum2026!";
const totpSecret = "JBSWY3DPEHPK3PXP";
const isTemplate = process.argv.includes("--template");
const keepServer = process.argv.includes("--keep-server");
const production = process.argv.includes("--production");
process.env.QUORUM_DATA_DIR = data;
process.env.QUORUM_STORE_PATH = path.join(work, "web.json");
process.env.QUORUM_WEB_URL = origin;
process.env.MCP_PORT = "3131";
process.env.QUORUM_SIDECAR_URL = sidecar;
// Ephemeral test-only keys: never inherit a deployed signing identity or use
// development defaults to make a production-mode demonstration pass.
for (const key of ["ATTEST_SECRET", "STEP_UP_SECRET", "NOTIFY_SECRET", "AUDIT_SECRET", "BID_VAULT_SECRET", "QUORUM_DOWNLOAD_SECRET", "MUSE_ACTION_SECRET", "GATE_SECRET"]) {
  process.env[key] = randomBytes(32).toString("hex");
}
process.env.GATE_SIGNING_KEY = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
if (isTemplate) {
  for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "META_MODEL_API_KEY", "MUSE_API_KEY", "LLM_FALLBACK_BASE_URL"]) process.env[key] = "";
}
mkdirSync(data, { recursive: true });
mkdirSync(output, { recursive: true });

function digest(text: string) { return createHash("sha256").update(text).digest("hex"); }
async function occupied(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.setTimeout(1500, () => { socket.destroy(); resolve(true); });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}
for (const port of [3100, 3131]) if (await occupied(port)) throw new Error(`Port ${port} is occupied. Stop that server yourself before running this isolated proof; no existing process was killed.`);

const notice = `# DEMONSTRATION TENDER NOTICE - ${tenderId}

Fictional data for an integration test. This is not a government procurement.

**Buyer:** Demonstration Health Procurement Unit, Zambia
**Subject:** Supply of ten vaccine refrigerators - synthetic demonstration
**Budget ceiling:** ZMW 480,000
**Published:** 01 October 2026
**Closing:** 29 October 2026, 10:00 CAT
**Method:** Open bidding, national

## Specifications
- The supplier SHALL deliver ten vaccine refrigerators operating at 2-8 degrees Celsius.
- The supplier SHALL provide a signed delivery schedule committing delivery within 30 days.
- The supplier SHALL provide an equipment maintenance plan identifying a local service team.

## Eligibility checklist
- [REQUIRED] Tax clearance certificate
- [REQUIRED] Company registration certificate
- [REQUIRED] Signed delivery schedule

## Evaluation criteria
| Criterion | Weight (%) | Evidence / subcriteria | Scoring method |
| --- | ---: | --- | --- |
| Technical capability | 60 | Refrigerator specification and a maintenance plan naming the service team | Committee scores documented specification and maintenance evidence on a 0-100 scale |
| Delivery plan | 40 | Signed dated schedule committing delivery within 30 days | Committee scores documented milestones and delivery commitment on a 0-100 scale |
`;
const sourceFiles = {
  "01-tender-notice.md": notice,
  "02-bid-demo-clinic.md": `# DEMONSTRATION BID\n\n**Bidder:** Demo Clinic Supplies\n**Bid value:** ZMW 420,000\n**Bid security:** ZMW 10,000 valid until 28 February 2027\n\nIncluded documents: Tax clearance certificate; Company registration certificate; Signed delivery schedule.\n\nThe ten vaccine refrigerators operate at 2-8 degrees Celsius.\nOur signed delivery schedule commits delivery within 30 days: dispatch on day 10, installation on day 25, and acceptance testing on day 30.\nThe maintenance plan names the local service team: Demo Technician One and Demo Technician Two, with quarterly preventive servicing.\nAll names and identifiers in this document are fictional.\n`,
  "03-bid-demo-medical.md": `# DEMONSTRATION BID\n\n**Bidder:** Demo Medical Works\n**Bid value:** ZMW 450,000\n**Bid security:** ZMW 10,000 valid until 28 February 2027\n\nIncluded documents: Company registration certificate.\n\nThe ten vaccine refrigerators operate at 2-8 degrees Celsius.\nDelivery timing will be agreed after the award. No signed delivery schedule is included.\nMaintenance support is available on request; this submission names no local service team and provides no preventive maintenance schedule.\nAll names and identifiers in this document are fictional.\n`,
};
const tenderDir = path.join(data, "tenders", tenderId);
mkdirSync(tenderDir, { recursive: true });
for (const [filename, text] of Object.entries(sourceFiles)) writeFileSync(path.join(tenderDir, filename), text);

const db = await import("../src/lib/db");
const { hashPassword } = await import("../src/lib/auth");
const { totpCode } = await import("../src/lib/totp");
const common = { workspaceId: "demo", password: await hashPassword(password), emailVerified: true, organization: "Quorum isolated demonstration" };
const officer = db.createUser({ ...common, name: "Demo Procurement Officer", email: "officer@quorum.test", role: "OWNER" });
const chair = db.createUser({ ...common, name: "Demo Accounting Officer", email: "chair@quorum.test", role: "ADMIN" });
const evaluator = db.createUser({ ...common, name: "Demo Evaluation Member", email: "evaluator@quorum.test", role: "COMMITTEE" });
const oversight = db.createUser({ ...common, name: "Demo Oversight Member", email: "oversight@quorum.test", role: "COMMITTEE" });
for (const user of [officer, chair, evaluator, oversight]) db.setUserTotp(user.id, totpSecret, true);
for (const member of db.listCommitteeMembers()) db.deleteCommitteeMember(member.id);
for (const [user, office] of [[chair, "ACCOUNTING_OFFICER"], [evaluator, "EVALUATION_COMMITTEE"], [oversight, "OVERSIGHT"]] as const) {
  db.createCommitteeMember({ userId: user.id, name: user.name, role: "Fictional test member", isChair: user.id === chair.id, office });
}
db.setSetting("committee_seats", "5");
db.setSetting("quorum_required", "3");
const store = await import("../mini-services/quorum-mcp/store");
const { parseEvaluationCriteria } = await import("../mini-services/quorum-mcp/cycle");
const criteria = parseEvaluationCriteria(notice);
if (criteria.length !== 2) throw new Error("Fixture notice did not parse into two issued criteria.");
const createdAt = "2026-10-01T08:00:00.000Z";
const cycle: TenderCycle = {
  tenderId, workspaceId: "demo", systemReference: "QRM-2026-001", closingDate: "2026-10-29T08:00:00.000Z", createdAt,
  coi: [], alb: [], debriefs: [], complaints: [], clarifications: [], addenda: [], specs: [], dissents: [],
  notices: [{ id: "notice_demo_001", tenderId, reference: "QRM-2026-001", md: notice, fieldCheck: [], createdAt, issuedAt: createdAt, issuedBy: "Fictional fixture setup" }],
  opening: { id: "opening_demo_001", tenderId, createdAt: "2026-10-29T08:00:00.000Z", closingDate: "2026-10-29T08:00:00.000Z", certifiedAt: "2026-10-29T08:10:00.000Z", certifiedBy: "Fictional fixture setup", minutesMd: "Synthetic starting state for an integration test; two timely bids opened after closing.", rows: [
    { bidder: "Demo Clinic Supplies", receivedAt: "2026-10-28T08:00:00.000Z", late: false, priceRead: "ZMW 420,000" },
    { bidder: "Demo Medical Works", receivedAt: "2026-10-28T09:00:00.000Z", late: false, priceRead: "ZMW 450,000" },
  ] },
  matrix: { id: "matrix_demo_001", tenderId, criteriaNoticeId: "notice_demo_001", criteria, technicalWeightPct: 100, evaluationCurrency: "ZMW", createdAt: "2026-10-30T08:00:00.000Z", status: "DRAFT", bids: ["Demo Clinic Supplies", "Demo Medical Works"].map((bidder, index) => ({ bidder, late: false, responsiveness: index ? "ADMINISTRATIVELY_NONRESPONSIVE" : "RESPONSIVE", reasons: index ? ["Required tax clearance and signed delivery schedule are absent in this fictional starting record."] : [], technicalScores: [], technicalTotal: 0, verdict: "NOT_RECOMMENDED" })) },
};
store.state.runs.splice(0);
store.state.gates.splice(0);
store.state.cycle.splice(0, store.state.cycle.length, cycle);
store.state.pipeline.splice(0, store.state.pipeline.length, { id: "pipeline_demo_001", ref: tenderId, linkedTenderId: tenderId, workspaceId: "demo", systemReference: "QRM-2026-001", title: "Ten vaccine refrigerators - synthetic Zambia demonstration", currency: "ZMW", budgetEstimate: 480000, status: "LINKED", createdAt });
store.saveState();
await store.flushState();

const children: ChildProcess[] = [];
function start(command: string, args: string[], filename: string) {
  const fd = openSync(path.join(work, filename), "a");
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...(production ? { NODE_ENV: "production" } : {}) }, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd); children.push(child); return child;
}
function stop() {
  for (const child of children) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, "SIGTERM"); }
    catch { if (!child.killed) child.kill("SIGTERM"); }
  }
}
process.on("SIGINT", () => { stop(); process.exit(130); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
async function waitFor(url: string, milliseconds = 90000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (response.ok) return; } catch { /* still starting */ }
    await Bun.sleep(500);
  }
  throw new Error(`Server did not become ready: ${url}. Logs: ${work}`);
}
type Json = Record<string, any>;
async function api(route: string, cookie?: string, body?: Json, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${origin}${route}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000) });
  const data = await response.json().catch(() => ({})) as Json;
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

try {
  start("bun", ["mini-services/quorum-mcp/index.ts"], "sidecar.log");
  await waitFor(`${sidecar}/api/health`);
  if (production) {
    process.env.PORT = "3100";
    process.env.HOSTNAME = "127.0.0.1";
    start("node", [".next/standalone/server.js"], "web.log");
  } else {
    start("node", ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", "3100"], "web.log");
  }
  await waitFor(`${origin}/api/auth/me`);
  const signedOfficer = await api("/api/auth/login", undefined, { email: officer.email, password });
  const signedChair = await api("/api/auth/login", undefined, { email: chair.email, password });
  if (!signedOfficer.cookie || !signedChair.cookie) throw new Error("Fictional test sessions could not sign in.");
  const officerCookie = signedOfficer.cookie, chairCookie = signedChair.cookie;
  const launched = await api("/api/runs?XTransformPort=3031", officerCookie, { tenderId, reference: "QRM-2026-001", detail: { buyer: "Demonstration Health Procurement Unit, Zambia", currency: "ZMW", ceiling: 480000, publishedDate: "2026-10-01", deadlineDate: "2026-10-29", noticeRef: tenderId, category: "Health equipment", specification: "Ten vaccine refrigerators; 2-8 degrees Celsius; signed 30-day delivery schedule; named local maintenance team." } });
  const runId = launched.data.run?.id ?? launched.data.id;
  if (!runId) throw new Error(`Review launch failed (${launched.status}): ${JSON.stringify(launched.data)}`);
  console.log(`Live review started: ${runId}. Data and logs: ${work}`);
  let run: Json | undefined;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const response = await api("/api/runs?XTransformPort=3031&limit=10", officerCookie);
    run = response.data.runs?.find((row: Json) => row.id === runId);
    if (run?.status === "AWAITING_GATE" || run?.status === "FAILED") break;
    await Bun.sleep(1000);
  }
  if (run?.status !== "AWAITING_GATE" || !run.gateId) throw new Error(`Review did not stop at the gate: ${JSON.stringify(run)}`);
  const gateId = run.gateId;
  const before = await api(`/api/gates/${gateId}/verify?XTransformPort=3031`, officerCookie);
  const unsignedResponse = await fetch(`${sidecar}/api/gates/${gateId}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "APPROVE", approver: chair.name }) });
  const unsigned = { status: unsignedResponse.status, data: await unsignedResponse.json() };
  const withoutStepUp = await api(`/api/gates/${gateId}/decision?XTransformPort=3031`, chairCookie, { decision: "APPROVE", approver: chair.name });
  const afterRefusals = await api(`/api/gates/${gateId}/verify?XTransformPort=3031`, chairCookie);
  if (unsigned.status !== 401 || withoutStepUp.status !== 403 || afterRefusals.data.status !== "PENDING" || afterRefusals.data.receipt) throw new Error("Refusal proof failed: the unsigned attempt changed the gate or was accepted.");
  const advisory = isTemplate ? null : await api("/api/cycle/evaluate-bids", officerCookie, { tenderId, confirmedDocumentSharing: true });
  const stepUp = await api("/api/auth/step-up", chairCookie, { gateId, code: totpCode(totpSecret) });
  if (!stepUp.data.token) throw new Error(`Step-up failed (${stepUp.status}): ${JSON.stringify(stepUp.data)}`);
  const approval = await api(`/api/gates/${gateId}/decision?XTransformPort=3031`, chairCookie, { decision: "APPROVE", approver: chair.name, note: "Authorised fictional test account approves the demonstration review bundle. No real tender or national portal is affected." }, { "x-quorum-stepup": stepUp.data.token });
  const verified = await api(`/api/gates/${gateId}/verify?XTransformPort=3031`, chairCookie);
  const health = await fetch(`${sidecar}/api/health`).then((response) => response.json()) as Json;
  const proof = { schemaVersion: 1, capturedAt: new Date().toISOString(), dataset: { id: tenderId, synthetic: true, jurisdiction: "ZM", currency: "ZMW", title: "Ten vaccine refrigerators - synthetic Zambia demonstration", sourceBundleSha256: digest(JSON.stringify(sourceFiles)), sourceFiles }, setup: { nature: "Fictional starting state: issued criteria, two timely bids, unscored draft matrix. Test automation signs with fictional authorised accounts.", dates: { published: "2026-10-01", closed: "2026-10-29", review: new Date().toISOString().slice(0, 10) } }, run, advisory: advisory ? { status: advisory.status, ...advisory.data } : null, boundary: { before: before.data, unsigned, withoutStepUp: { status: withoutStepUp.status, data: withoutStepUp.data }, afterRefusals: afterRefusals.data, approval: { status: approval.status, data: approval.data }, verified: verified.data }, runtime: { fsMcp: health.fsMcp ?? health.filesystemMcp ?? null, model: health.model ?? health.llm ?? null }, limitations: ["Synthetic demonstration; not a field pilot or independent human review.", "Filing is a local simulation; no national e-GP request is made.", "Exact source quotation checks do not establish semantic or legal correctness."] };
  writeFileSync(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  writeFileSync(path.join(work, "capture-session.json"), JSON.stringify({ origin, work, tenderId, runId, gateId, officer: { name: officer.name, email: officer.email, password }, chair: { name: chair.name, email: chair.email, password } }, null, 2));
  console.log(JSON.stringify({ proof: path.join(output, "proof.json"), work, runId, gateId, unsigned: unsigned.status, withoutStepUp: withoutStepUp.status, approval: approval.status, signatureValid: verified.data.signatureValid, advisory: advisory?.status ?? "template mode" }, null, 2));
  if (approval.status !== 200 || verified.data.signatureValid !== true || verified.data.receipt?.status !== "SIMULATED") throw new Error("The signed simulation receipt did not verify. Inspect proof.json; no success was claimed.");
  if (advisory && advisory.status !== 200) throw new Error("The live advisory failed. Inspect proof.json; no successful model result was claimed.");
  if (keepServer) { console.log(`Capture servers remain at ${origin}; send SIGTERM to stop only these child processes.`); await new Promise(() => {}); }
} finally {
  stop();
}
