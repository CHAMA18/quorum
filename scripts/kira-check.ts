/**
 * Is Kira answering — and is it the model this deployment thinks it is?
 *
 *   npm run kira:check                       # whatever .env.local resolves to
 *   KIRA_BASE_URL=... KIRA_MODEL=... ... bun scripts/kira-check.ts
 *
 * Exit codes: 0 reachable and answering, 1 unreachable or answering badly,
 * 2 no endpoint configured (drafting still works — on the deterministic
 * composer — so this is not a failure, but it is not a hosted model either).
 *
 * The check speaks the same OpenAI-compatible request the app's route sends,
 * and asks for JSON, because that is what the Tender Builder needs back.
 */
import { extractJsonObject } from "../src/lib/tender-draft";

const base = (process.env.KIRA_BASE_URL ?? "").trim().replace(/\/+$/, "");
const model = (process.env.KIRA_MODEL ?? "").trim();
const key = (process.env.KIRA_API_KEY ?? "").trim();
const residency = (process.env.MODEL_RESIDENCY ?? "IN_REGION").trim();
const timeoutMs = Number(process.env.KIRA_CHECK_TIMEOUT_MS ?? 45_000);

function line(label: string, value: string) {
  console.log(`${label.padEnd(14)}${value}`);
}

line("endpoint", base || "(not configured)");
if (!base) {
  line("residency", residency);
  console.log("\nUNCONFIGURED — KIRA_BASE_URL is empty. The Tender Builder and the");
  console.log("desk agent still answer, using the deterministic composer/template.");
  process.exit(2);
}
if (!model) {
  line("model", "(not configured)");
  console.log("\nUNCONFIGURED — KIRA_MODEL is empty, so no model id would be sent.");
  process.exit(2);
}
line("model", model);
line("auth", key ? `bearer set (${key.length} chars)` : "none (keyless endpoint)");
line("residency", residency);

const started = Date.now();
let res: Response;
try {
  res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: 'Reply with one JSON object and nothing else: {"ok":true,"model":"<the model id you are running>"}',
        },
      ],
      max_tokens: 80,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
} catch (error) {
  line("status", "UNREACHABLE");
  console.log(`\n${(error as Error).message}`);
  process.exit(1);
}
const elapsed = Date.now() - started;
const text = await res.text();

if (!res.ok) {
  line("status", `HTTP ${res.status} after ${elapsed}ms`);
  console.log(`\n${text.slice(0, 600).trim() || "(empty body)"}`);
  process.exit(1);
}

let content = "";
try {
  const body = JSON.parse(text) as {
    choices?: { message?: { content?: unknown } }[];
    response?: unknown;
    model?: unknown;
  };
  const choice = body.choices?.[0]?.message?.content;
  content = typeof choice === "string" ? choice : typeof body.response === "string" ? body.response : "";
  if (typeof body.model === "string") line("answered as", body.model);
} catch {
  line("status", "HTTP 200 but the body is not JSON");
  console.log(`\n${text.slice(0, 600).trim()}`);
  process.exit(1);
}

if (!content.trim()) {
  line("status", `HTTP 200 after ${elapsed}ms, but the reply has no text`);
  console.log("\nAn empty completion is a broken host, not a slow one.");
  process.exit(1);
}

const parsed = extractJsonObject(content);
line("status", `REACHABLE — ${elapsed}ms, ${parsed ? "valid JSON" : "text only"}`);
console.log(`\nreply: ${content.trim().slice(0, 240)}`);
if (!parsed) {
  console.log("\nThe model answered, but not in JSON. The Tender Builder composes the");
  console.log("brief deterministically and still returns a draft; the model's prose is");
  console.log("discarded. A model that can hold a JSON object gives better drafted text.");
}
process.exit(0);
