/**
 * The model gateway — residency, redaction and provenance (WS10).
 *
 * Proven here: an IN_REGION workspace refuses a call that would leave the
 * region; a hosted call redacts supplier names and prices unless the operator
 * has accepted unredacted transmission in their own words; and every call —
 * accepted, refused or errored — lands one provenance line in the chain.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_FEATURES, state, toolLog, type LogEntry } from "./store";
import {
  callModel,
  endpointClass,
  redactForModel,
  residencyFromEnv,
  residencyRefusal,
  type ResidencyPolicy,
} from "./model-gateway";

const LOCAL = "http://127.0.0.1:8000/v1/";
const HOSTED = "https://api.meta.ai/v1";

const IN_REGION: ResidencyPolicy = { residency: "IN_REGION", redactOn: true };
const HOSTED_POLICY: ResidencyPolicy = { residency: "HOSTED", redactOn: true };

function httpOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  state.features = { ...DEFAULT_FEATURES, residencyPolicy: true };
  state.suppliers.length = 0;
});

afterEach(() => {
  state.suppliers.length = 0;
  state.features = { ...DEFAULT_FEATURES };
});

describe("endpoint classing", () => {
  test("loopback, private ranges and .internal are local", () => {
    expect(endpointClass("http://localhost:11434/v1")).toBe("LOCAL");
    expect(endpointClass("http://10.0.0.4:8000/v1")).toBe("LOCAL");
    expect(endpointClass("http://192.168.9.9/v1")).toBe("LOCAL");
    expect(endpointClass("http://llama.internal:8000/v1/")).toBe("LOCAL");
    expect(endpointClass("http://host.docker.internal:11434/v1")).toBe("LOCAL");
  });

  test("a public endpoint or a garbage URL is hosted, never assumed local", () => {
    expect(endpointClass("https://api.meta.ai/v1")).toBe("HOSTED");
    expect(endpointClass("https://llama.api.llama.com/v1")).toBe("HOSTED");
    expect(endpointClass("not a url")).toBe("HOSTED");
  });
});

describe("residency policy", () => {
  test("defaults to IN_REGION with redaction on", () => {
    expect(residencyFromEnv({})).toEqual({ residency: "IN_REGION", redactOn: true });
  });

  test("HOSTED and HYBRID are operator-declared", () => {
    expect(residencyFromEnv({ MODEL_RESIDENCY: "HOSTED" }).residency).toBe("HOSTED");
    expect(residencyFromEnv({ MODEL_RESIDENCY: "HYBRID" }).residency).toBe("HYBRID");
    expect(residencyFromEnv({ MODEL_RESIDENCY: "banana" }).residency).toBe("IN_REGION");
  });

  test('redaction may only be turned off with an explicit "I ACCEPT"', () => {
    expect(residencyFromEnv({ MODEL_REDACTION: "off" }).redactOn).toBe(true);
    expect(residencyFromEnv({ MODEL_REDACTION: "off", MODEL_REDACTION_EXPLICIT: "i accept" }).redactOn).toBe(false);
    expect(residencyFromEnv({ MODEL_REDACTION_EXPLICIT: "I ACCEPT" }).redactOn).toBe(true);
  });

  test("an IN_REGION workspace refuses a call that would leave the region", () => {
    const refusal = residencyRefusal(IN_REGION, HOSTED);
    expect(refusal).toContain("IN_REGION");
    expect(refusal).toContain("api.meta.ai");
    expect(residencyRefusal(IN_REGION, LOCAL)).toBeNull();
    expect(residencyRefusal(HOSTED_POLICY, HOSTED)).toBeNull();
  });
});

describe("redaction", () => {
  test("supplier names leave as REDACTED-SUPPLIER, word-boundary exact", () => {
    const out = redactForModel(
      "Acme Supplies bid 1,000,000 and Zambia Copper did not bid; Acme Supplies Ltd is a different company.",
      ["Acme Supplies", "Zambia Copper"],
    );
    expect(out.redacted).toBe(4); /* 3 name hits + 1 amount */
    expect(out.text).toContain("REDACTED-SUPPLIER");
    expect(out.text).not.toContain("Acme Supplies");
    expect(out.text).not.toContain("1,000,000");
    expect(out.text).toContain("REDACTED-AMOUNT");
  });

  test("tokens shorter than three characters are never treated as a supplier", () => {
    const out = redactForModel("The buyer office reviewed line items priced in ZMW.", ["AB"]);
    expect(out.text).toBe("The buyer office reviewed line items priced in ZMW.");
    expect(out.redacted).toBe(0);
  });
});

describe("the gateway call path", () => {
  test("an IN_REGION refusal throws, names the policy and logs a REFUSED provenance line", async () => {
    const n = toolLog.length;
    await expect(
      callModel(
        { baseUrl: HOSTED, model: "llama-4", provider: "meta-model-api", apiKey: "k" },
        [{ role: "user", content: "draft a clause" }],
        async () => {
          throw new Error("must not be called");
        },
        { purpose: "draft_redline", runId: "run_1", policy: IN_REGION },
      ),
    ).rejects.toThrow("IN_REGION");
    const line = provenanceSince(n);
    expect(line).toBeTruthy();
    expect(line.outputs.outcome).toBe("REFUSED");
    expect(line.inputs.residency).toBe("IN_REGION");
  });

  test("a hosted call redacts supplier names and prices in the outgoing messages", async () => {
    state.suppliers.push({ id: "s1", name: "Acme Supplies", status: "ACTIVE" } as never);
    const bodies: string[] = [];
    const completion = await callModel(
      { baseUrl: HOSTED, model: "llama-4", provider: "meta-model-api", apiKey: "k" },
      [{ role: "user", content: "Acme Supplies bid ZMW 1,250,000 against the ceiling." }],
      async (_url, init) => {
        bodies.push(String(init?.body ?? ""));
        return httpOk({ model: "llama-4", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
      },
      { purpose: "plan_review", runId: "run_2", policy: HOSTED_POLICY },
    );
    expect(completion.content).toBe("{}");
    const body = bodies[0];
    expect(body).not.toContain("Acme Supplies");
    expect(body).not.toContain("1,250,000");
    expect(body).toContain("REDACTED-SUPPLIER");
    const n = toolLog.length;
    const line = provenanceSince(n - 1);
    expect(line.outputs.redactions).toBeGreaterThan(0);
    expect(line.outputs.promptTokens).toBe(12);
    expect(line.inputs.residency).toBe("HOSTED");
  });

  test("a local call is never redacted", async () => {
    state.suppliers.push({ id: "s1", name: "Acme Supplies", status: "ACTIVE" } as never);
    const bodies: string[] = [];
    await callModel(
      { baseUrl: LOCAL, model: "llama-3.1", provider: "openai-compatible", apiKey: "k" },
      [{ role: "user", content: "Acme Supplies bid ZMW 1,250,000 against the ceiling." }],
      async (_url, init) => {
        bodies.push(String(init?.body ?? ""));
        return httpOk({ model: "llama-3.1", choices: [{ message: { content: "{}" } }] });
      },
      { purpose: "draft_redline", runId: "run_3", policy: IN_REGION },
    );
    expect(bodies[0]).toContain("Acme Supplies");
    expect(bodies[0]).toContain("1,250,000");
  });

  test("a failed call still logs its provenance as ERROR", async () => {
    const n = toolLog.length;
    await expect(
      callModel(
        { baseUrl: LOCAL, model: "llama-3.1", provider: "openai-compatible" },
        [{ role: "user", content: "x" }],
        async () => new Response("no", { status: 503 }),
        { purpose: "draft_redline", runId: "run_4", policy: IN_REGION },
      ),
    ).rejects.toThrow("503");
    const line = provenanceSince(n);
    expect(line.outputs.outcome).toBe("ERROR");
  });
});

function provenanceSince(n: number): LogEntry & { inputs: { [k: string]: unknown }; outputs: { [k: string]: unknown } } {
  for (let i = toolLog.length - 1; i >= n; i -= 1) {
    if (toolLog[i].tool === "model_call") {
      /* The store caps inputs/outputs as JSON strings — unpack them the same
         way the file-backed readers do. */
      const entry = toolLog[i];
      const parse = (v: unknown) => (typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : ((v ?? {}) as Record<string, unknown>));
      return { ...entry, inputs: parse(entry.inputs), outputs: parse(entry.outputs) } as never;
    }
  }
  throw new Error(`no model_call provenance line at or after index ${n}`);
}
