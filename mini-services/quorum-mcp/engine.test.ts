import { describe, expect, test } from "bun:test";
import {
  approverAllowed,
  bidStatesIdentifier,
  buildPack,
  buyerMissingFindings,
  callLlama,
  citesKnownDocument,
  fetchQuorum,
  fetchRoster,
  flagPack,
  llmConfigFromEnv,
  llmPlanFromPack,
  modelAttributionForRun,
  modelStatus,
  type FetchLike,
  parseBid,
  parseMarkdownBidValue,
  parseMarkdownCeiling,
  parseOcdsBids,
  parseOcdsRecords,
  planFromPack,
  repairFinding,
  runAwardRules,
  runRules,
  statedBidValueLine,
  supplierIdFindings,
  verifyFinding,
  verifyFindingReason,
  quorumCheck,
  type BidDoc,
  type CommitteeQuorum,
  type Finding,
  type RosterMember,
} from "./engine";

const FILES = ["01-tender-notice.md", "02-bid-acme.md", "03-bid-zeta.md", "ocds-release.json"];

describe("citation gate", () => {
  test("accepts a citation that names a real document in the tender", () => {
    expect(citesKnownDocument("02-bid-acme.md, price schedule", FILES)).toBe(true);
  });

  test("rejects an empty citation", () => {
    expect(citesKnownDocument("", FILES)).toBe(false);
    expect(citesKnownDocument("   ", FILES)).toBe(false);
  });

  test("rejects a citation to a document that is not in the tender", () => {
    expect(citesKnownDocument("bid-acme.md, price schedule", FILES)).toBe(false);
    expect(citesKnownDocument("01-tender-notice.md, eligibility checklist", ["02-bid-acme.md"])).toBe(false);
  });
});

const OCDS = JSON.stringify({
  ocid: "ocds-test-0001",
  bids: {
    details: [
      { tenderers: [{ name: "Acme Medical Ltd" }], value: { amount: 1_000_000, currency: "KES" } },
      { tenderers: [{ name: "Zeta Supplies" }], value: { amount: 1_100_000, currency: "KES" } },
      { tenderers: [{ name: "Outlier Pharma" }], value: { amount: 3_500_000, currency: "KES" } },
      { tenderers: [], value: { amount: 900_000, currency: "KES" } },
    ],
  },
});

describe("OCDS ingestion", () => {
  test("reads one bid per tenderer, with value and record path", () => {
    const bids = parseOcdsBids(OCDS, "ocds-release.json");
    expect(bids.map((b) => b.bidder)).toEqual(["Acme Medical Ltd", "Zeta Supplies", "Outlier Pharma"]);
    expect(bids[0].value).toBe(1_000_000);
    expect(bids[0].currency).toBe("KES");
    expect(bids[0].ref).toBe("ocid ocds-test-0001, bids.details[0].value");
    expect(bids[0].source).toBe("ocds-release.json");
  });

  test("reads a release wrapped in a releases array", () => {
    const wrapped = JSON.stringify({ releases: [JSON.parse(OCDS)] });
    expect(parseOcdsBids(wrapped, "ocds-release.json")).toHaveLength(3);
  });

  test("returns nothing for text that is not JSON", () => {
    expect(parseOcdsBids("not json", "x.json")).toEqual([]);
  });
});

/* The publishers' documented mess: a price table headed in one currency whose
   cells state another. The engine reads what the cell says and names the
   disagreement instead of assuming a currency. */
describe("price tables that state a currency", () => {
  const RW_HEAD = "| Line item | Qty | Unit price (RWF) |\n| --- | --- | --- |\n";
  const weza = `**Bidder:** Weza Technologies\n${RW_HEAD}| Solar tablet, 8-hour field rating | 7500 | KES 24,600 |\n`;
  const ubumwe = `**Bidder:** Ubumwe Mobile\n${RW_HEAD}| Solar tablet, 8-hour field rating | 7500 | KES 92,400 |\n`;
  const plainKes = "| Line item | Qty | Unit price |\n| --- | --- | --- |\n| Solar tablet | 7500 | KES 24,600 |\n";

  test("reads the currency the cell states and the one the header declares", () => {
    const items = parseBid(weza, "Weza Technologies", "02-bid-weza-technologies.md");
    expect(items).toHaveLength(1);
    expect(items[0].currency).toBe("KES");
    expect(items[0].declaredCurrency).toBe("RWF");
  });

  test("a table with no declared currency still reads its cells", () => {
    const items = parseBid(plainKes, "Acme", "02-bid-acme.md");
    expect(items).toHaveLength(1);
    expect(items[0].currency).toBe("KES");
    expect(items[0].declaredCurrency).toBeUndefined();
  });

  test("the outlier finding states the cell's currency and names the mismatch", () => {
    const findings = runRules(
      [
        { bidder: "Weza Technologies", text: weza, source: "02-bid-weza-technologies.md" },
        { bidder: "Ubumwe Mobile", text: ubumwe, source: "03-bid-ubumwe-mobile.md" },
      ],
      "**Budget ceiling:** RWF 900,000,000\n",
      "01-tender-notice.md",
      { priceVariancePct: 100, checklist: "STANDARD", registryCrossCheck: false },
    );
    const outlier = findings.find((f) => f.rule === "R-PRICE-OUTLIER");
    expect(outlier).toBeDefined();
    expect(outlier?.evidence).toContain("Unit price KES 92,400");
    expect(outlier?.evidence).toContain("price table headed RWF; cells state KES");
    expect(outlier?.evidence).not.toContain("Unit price RWF");
  });

  test("a bid value in another currency still reaches the gate", () => {
    expect(statedBidValueLine("**Bid value:** ZMW 3,900,000")).toBe("ZMW 3,900,000");
    expect(statedBidValueLine("**Bid value:** RWF 2,150,000,000")).toBe("RWF 2,150,000,000");
    expect(statedBidValueLine("**Bidder:** Acme\nno value stated")).toBeUndefined();
  });
});

describe("self-check against the cited document", () => {
  const base = { id: "", severity: "HIGH" as const };

  test("keeps a price finding whose line item appears in the cited bid", () => {
    const f = { ...base, rule: "R-PRICE-OUTLIER", item: "Paracetamol 500mg × 100 — OUTLIER", evidence: "", citation: "04-bid-outlier.md, price schedule" };
    expect(verifyFinding(f, { "04-bid-outlier.md": "| Paracetamol 500mg | 100 | KES 300 |" })).toBe(true);
    expect(verifyFinding(f, { "04-bid-outlier.md": "| Amoxicillin | 10 | KES 300 |" })).toBe(false);
  });

  test("drops a value finding whose ocid is not in the cited release", () => {
    const f = { ...base, rule: "R-VALUE-OUTLIER", item: "Outlier Pharma", evidence: "", citation: "ocds-release.json, ocid ocds-test-0001, bids.details[2].value" };
    expect(verifyFinding(f, { "ocds-release.json": OCDS })).toBe(true);
    expect(verifyFinding(f, { "ocds-release.json": OCDS.replace("ocds-test-0001", "other") })).toBe(false);
  });

  test("drops a finding whose cited document is absent from the sources", () => {
    const f = { ...base, rule: "R-SPEC-DEVIATION", item: "Acme", evidence: "alternative offered", citation: "missing.md, specifications matrix" };
    expect(verifyFinding(f, { "02-bid-acme.md": "alternative offered" })).toBe(false);
  });

  test("keeps a missing-document finding only if the required document is named in the notice", () => {
    const f = { ...base, rule: "R-DOC-MISSING", item: "Acme — tax clearance", evidence: 'Tender notice lists "tax clearance certificate" as REQUIRED; the bid does not reference it.', citation: "01-tender-notice.md, eligibility checklist" };
    expect(verifyFinding(f, { "01-tender-notice.md": "- [REQUIRED] Tax clearance certificate" })).toBe(true);
    expect(verifyFinding(f, { "01-tender-notice.md": "no requirements" })).toBe(false);
  });

  test("drops an unknown rule", () => {
    const f = { ...base, rule: "R-MADE-UP", item: "x", evidence: "x", citation: "01-tender-notice.md, x" };
    expect(verifyFinding(f, { "01-tender-notice.md": "x" })).toBe(false);
  });
});

describe("drafting model: OpenAI-compatible LLM endpoint", () => {
  const cfg = { baseUrl: "http://llama.internal:8000/v1/", model: "llama-3.1-70b-instruct", apiKey: "k", provider: "openai-compatible" as const, configuredBy: "llm-env" as const };

  test("reads the endpoint from LLM_* env and needs both URL and model", () => {
    expect(llmConfigFromEnv({ LLM_BASE_URL: "http://llama.internal:8000/v1", LLM_MODEL: "llama-3.1-70b-instruct" })).toEqual({
      baseUrl: "http://llama.internal:8000/v1",
      model: "llama-3.1-70b-instruct",
      apiKey: undefined,
      provider: "openai-compatible",
      configuredBy: "llm-env",
    });
    expect(llmConfigFromEnv({ LLM_BASE_URL: "http://llama.internal:8000/v1" })).toBeNull();
    expect(llmConfigFromEnv({})).toBeNull();
  });

  test("recognises the live Llama 3.2 path and the Meta Model API fallback", () => {
    const llama = llmConfigFromEnv({
      LLM_BASE_URL: "http://localhost:11434/v1",
      LLM_MODEL: "llama3.2:3b",
    });
    expect(llama?.provider).toBe("ollama");
    expect(llama?.model).toBe("llama3.2:3b");
    expect(modelStatus({ LLM_BASE_URL: "http://localhost:11434/v1", LLM_MODEL: "llama3.2:3b" })).toMatchObject({
      configured: true,
      mode: "llm",
      model: "llama3.2:3b",
      provider: "ollama",
      endpoint: "http://localhost:11434",
    });
    const meta = llmConfigFromEnv({ META_MODEL_API_KEY: "k", META_MODEL: "muse-spark-1.3" });
    expect(meta).toMatchObject({
      baseUrl: "https://api.meta.ai/v1",
      model: "muse-spark-1.3",
      provider: "meta-model-api",
      configuredBy: "meta-model-api",
    });
    /* A partial LLM_* pair is not silently redirected to a different provider. */
    expect(llmConfigFromEnv({ LLM_BASE_URL: "http://localhost:11434/v1", MUSE_API_KEY: "k" })).toBeNull();
    expect(modelStatus({})).toMatchObject({ configured: false, mode: "template", provider: "template" });
  });

  test("attributes a run from stored plan and draft facts", () => {
    const attributed = modelAttributionForRun({
      plan: { source: "llm", model: "llama3.2:3b" },
      drafts: [
        { model: "llama3.2:3b", source: "llm" },
        { model: "llama3.2:3b (llm) — old row", source: undefined },
      ],
      usage: { promptTokens: 300, completionTokens: 50 },
    } as never);
    expect(attributed.mode).toBe("llm");
    expect(attributed.models).toEqual(["llama3.2:3b"]);
    expect(attributed.draftLlm).toBe(2);
    expect(attributed.draftTemplate).toBe(0);
    expect(attributed.promptTokens).toBe(300);

    const template = modelAttributionForRun({
      plan: { source: "heuristic" },
      drafts: [{ model: "template (no model configured)", source: "template" }],
      usage: { promptTokens: 0, completionTokens: 0 },
    } as never);
    expect(template.mode).toBe("template");
    expect(template.models).toEqual([]);

    /* A configured endpoint that did not answer is still template output. */
    const unreachable = modelAttributionForRun({
      plan: { source: "heuristic" },
      drafts: [{ model: "template (llama3.2:3b unavailable)", source: "template" }],
      usage: { promptTokens: 0, completionTokens: 0 },
    } as never);
    expect(unreachable.mode).toBe("template");
    expect(unreachable.models).toEqual([]);
    expect(unreachable.draftTemplate).toBe(1);
  });

  test("posts an OpenAI-compatible chat request to the configured endpoint only", async () => {
    let url = "";
    let body: { model?: string } = {};
    let auth: string | undefined;
    const fake = (async (u: string, init: RequestInit) => {
      url = String(u);
      body = JSON.parse(String(init.body));
      auth = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ model: "llama-3.1-70b-instruct", choices: [{ message: { content: '{"proposed":"x","rationale":"y"}' } }] }));
    }) as FetchLike;
    const out = await callLlama(cfg, [{ role: "user", content: "hi" }], fake);
    expect(url).toBe("http://llama.internal:8000/v1/chat/completions");
    expect(body.model).toBe("llama-3.1-70b-instruct");
    expect(auth).toBe("Bearer k");
    expect(out.model).toBe("llama-3.1-70b-instruct");
    expect(out.content).toBe('{"proposed":"x","rationale":"y"}');
  });

  test("throws when the endpoint is unavailable, so the caller can fall back", async () => {
    const down: FetchLike = async () => new Response("busy", { status: 503 });
    await expect(callLlama(cfg, [{ role: "user", content: "hi" }], down)).rejects.toThrow("503");
  });
});

describe("approver check against the committee roster", () => {
  const roster: RosterMember[] = [
    { name: "Wanjiru Kamau", status: "PRESENT" },
    { name: "Otieno Mwangi", status: "EXCUSED" },
  ];

  test("allows a PRESENT member, ignoring case and extra spacing", () => {
    expect(approverAllowed("  wanjiru   KAMAU ", undefined, roster).ok).toBe(true);
  });

  test("refuses an EXCUSED member and a name not on the roster", () => {
    expect(approverAllowed("Otieno Mwangi", undefined, roster).ok).toBe(false);
    expect(approverAllowed("Jane Doe", undefined, roster).ok).toBe(false);
  });

  test("allows the signed-in officer even when not on the roster", () => {
    expect(approverAllowed("Jane Doe", "Jane Doe", roster).ok).toBe(true);
  });

  test("an empty roster lets only the signed-in officer approve", () => {
    expect(approverAllowed("Wanjiru Kamau", undefined, []).ok).toBe(false);
    expect(approverAllowed("Jane Doe", "Jane Doe", []).ok).toBe(true);
  });

  test("reads members from /api/committee", async () => {
    let url = "";
    const ok = (async (u: string) => {
      url = String(u);
      return new Response(JSON.stringify({ members: roster }));
    }) as FetchLike;
    expect(await fetchRoster(ok, "http://web")).toEqual(roster);
    expect(url).toBe("http://web/api/committee");
  });

  test("fails closed (null) when the roster cannot be read", async () => {
    const refused: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await fetchRoster(refused, "http://web")).toBeNull();
    const broken: FetchLike = async () => new Response("err", { status: 500 });
    expect(await fetchRoster(broken, "http://web")).toBeNull();
  });
});

describe("committee quorum at the gate", () => {
  const quorum = (present: number, required = 5, seats = 9): CommitteeQuorum => ({
    seats,
    required,
    present,
    members: [
      ...Array.from({ length: present }, (_, i) => ({
        name: `Present Member ${i + 1}`,
        status: "PRESENT" as const,
      })),
      ...Array.from({ length: Math.max(0, seats - present) }, (_, i) => ({
        name: `Excused Member ${i + 1}`,
        status: "EXCUSED" as const,
      })),
    ],
  });

  test("refuses a short roll and names how many more are needed", () => {
    const roll = quorumCheck(quorum(4), undefined);
    expect(roll.ok).toBe(false);
    expect(roll.present).toBe(4);
    expect(roll.needed).toBe(1);
    expect(roll.reason).toContain("4 of 5 required");
    expect(roll.reason).toContain("1 more member");
  });

  test("allows a full roll", () => {
    expect(quorumCheck(quorum(5), undefined).ok).toBe(true);
  });

  test("ignores a stale present count — the member rows decide", () => {
    const stale = { ...quorum(2), present: 9 };
    const roll = quorumCheck(stale, undefined);
    expect(roll.ok).toBe(false);
    expect(roll.present).toBe(2);
  });

  test("counts the signed-in gavel when the register does not list them", () => {
    const roll = quorumCheck(quorum(4), "Jane Doe");
    expect(roll.ok).toBe(true);
    expect(roll.present).toBe(5);
  });

  test("does not count the gavel twice when they are already PRESENT", () => {
    const roll = quorumCheck(quorum(4), "  present   member 1 ");
    expect(roll.ok).toBe(false);
    expect(roll.present).toBe(4);
  });

  test("reads seats, required and the roll from /api/committee", async () => {
    let url = "";
    const ok = (async (u: string) => {
      url = String(u);
      return new Response(
        JSON.stringify({
          seats: 9,
          required: 5,
          present: 2,
          members: [
            { name: "Wanjiru Kamau", status: "PRESENT" },
            { name: "Otieno Mwangi", status: "EXCUSED" },
          ],
        })
      );
    }) as FetchLike;
    const read = await fetchQuorum(ok, "http://web");
    expect(read?.seats).toBe(9);
    expect(read?.required).toBe(5);
    expect(read?.present).toBe(2);
    expect(read?.members).toHaveLength(2);
    expect(url).toBe("http://web/api/committee");
  });

  test("fails closed on a malformed or unreadable roll", async () => {
    const missingCounts = (async () =>
      new Response(JSON.stringify({ members: [] }))) as FetchLike;
    expect(await fetchQuorum(missingCounts, "http://web")).toBeNull();

    const badMember = (async () =>
      new Response(JSON.stringify({ seats: 9, required: 5, present: 2, members: [{ name: "X", status: "MAYBE" }] }))) as FetchLike;
    expect(await fetchQuorum(badMember, "http://web")).toBeNull();

    const down: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await fetchQuorum(down, "http://web")).toBeNull();
  });
});

describe("OCDS tender notice and awards", () => {
  const RECORD = JSON.stringify({
    ocid: "ocds-test-0002",
    tender: {
      title: "Supply of essential medicines",
      value: { amount: 2_000_000, currency: "KES" },
      documents: [{ title: "Tax clearance certificate", documentType: "eligibilityCriteria" }],
    },
    awards: [
      { suppliers: [{ name: "Acme Medical Ltd" }], value: { amount: 1_900_000, currency: "KES" } },
      { suppliers: [{ name: "Outlier Pharma" }], value: { amount: 2_600_000, currency: "KES" } },
    ],
  });

  test("reads the notice, required documents and awards from the record", () => {
    const [rec] = parseOcdsRecords(RECORD, "ocds-award.json");
    expect(rec.notice).toContain("Supply of essential medicines");
    expect(rec.notice).toContain("- [REQUIRED] Tax clearance certificate");
    expect(rec.awards.map((a) => a.supplier)).toEqual(["Acme Medical Ltd", "Outlier Pharma"]);
    expect(rec.tenderValue?.amount).toBe(2_000_000);
  });

  test("flags an award above the published tender value, citing the path", () => {
    const findings = runAwardRules(parseOcdsRecords(RECORD, "ocds-award.json"));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("R-AWARD-OVER-BUDGET");
    expect(findings[0].citation).toBe("ocds-award.json, ocid ocds-test-0002, awards[1].value");
  });

  test("the award finding passes the self-check against its record", () => {
    const [f] = runAwardRules(parseOcdsRecords(RECORD, "ocds-award.json"));
    expect(verifyFinding(f, { "ocds-award.json": RECORD })).toBe(true);
  });
});

describe("rules cite real sources only", () => {
  test("a value outlier is flagged, cites the OCDS file and path, and passes the gate", () => {
    const bids: BidDoc[] = parseOcdsBids(OCDS, "ocds-release.json");
    const findings = runRules(bids, "", "");
    const outlier = findings.find((f) => f.rule === "R-VALUE-OUTLIER");
    expect(outlier).toBeDefined();
    expect(outlier?.item).toBe("Outlier Pharma");
    expect(outlier?.citation).toBe("ocds-release.json, ocid ocds-test-0001, bids.details[2].value");
    expect(citesKnownDocument(outlier?.citation ?? "", ["ocds-release.json"])).toBe(true);
  });

  test("a price outlier cites the bid file it came from", () => {
    const bids: BidDoc[] = [
      { bidder: "Acme", source: "02-bid-acme.md", text: "| Paracetamol 500mg | 100 | KES 50 | " },
      { bidder: "Zeta", source: "03-bid-zeta.md", text: "| Paracetamol 500mg | 100 | KES 60 | " },
      { bidder: "Outlier", source: "04-bid-outlier.md", text: "| Paracetamol 500mg | 100 | KES 300 | " },
    ];
    const findings = runRules(bids, "", "01-tender-notice.md");
    const price = findings.find((f) => f.rule === "R-PRICE-OUTLIER");
    expect(price?.citation).toBe("04-bid-outlier.md, price schedule");
  });

  test("no rule emits a finding without a citation", () => {
    const findings = runRules(parseOcdsBids(OCDS, "ocds-release.json"), "", "");
    for (const f of findings) {
      expect(f.citation.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("markdown bid values and budget ceilings", () => {
  const BID = "# BID — Coastline\n\n**Bidder:** Coastline Screening Solutions\n**Bid value:** KES 3,940,000,000\n";

  test("parses the bid's own stated value line, cited to that line", () => {
    const v = parseMarkdownBidValue(BID);
    expect(v?.amount).toBe(3_940_000_000);
    expect(v?.currency).toBe("KES");
    expect(v?.ref).toBe("bid value line");
    expect(parseMarkdownBidValue("no value line here")).toBeUndefined();
  });

  test("parses the notice's published ceiling", () => {
    const c = parseMarkdownCeiling("**Budget ceiling:** KES 1,860,000,000 (VAT inclusive)");
    expect(c?.amount).toBe(1_860_000_000);
    expect(c?.currency).toBe("KES");
    expect(parseMarkdownCeiling("no ceiling")).toBeUndefined();
  });
});

describe("plan_review — the depth decision for one pack", () => {
  const notice = "# NOTICE\n**Budget ceiling:** KES 1,860,000,000\n- [REQUIRED] Tax compliance certificate\n";
  const pack = {
    bids: [
      { bidder: "PORTSCAN SYSTEMS", text: "**Bid value:** KES 1,772,000,000", source: "02-bid-portscan-systems.md" },
      { bidder: "COASTLINE SCREENING", text: "**Bid value:** KES 3,940,000,000", source: "03-bid-coastline-screening.md" },
    ],
    records: [],
    notices: [{ file: "01-tender-notice.md", text: notice }],
  };

  test("the heuristic plan enables deep value parsing for a markdown pack and ranks the families", () => {
    const plan = planFromPack(["01-tender-notice.md", "02-bid-portscan-systems.md", "03-bid-coastline-screening.md"], pack);
    expect(plan.source).toBe("heuristic");
    expect(plan.parseMarkdownValues).toBe(true);
    expect(plan.focusRules[0]).toBe("OVER-BUDGET");
    expect(plan.focusRules).toContain("DOC-MISSING");
    expect(plan.maxDrafts).toBe(2);
  });

  test("a pack with no markdown values keeps deep parsing off", () => {
    const plan = planFromPack(["x.md"], { bids: [{ bidder: "A", text: "nothing structured", source: "x.md" }], records: [], notices: [] });
    expect(plan.parseMarkdownValues).toBe(false);
    expect(plan.focusRules).not.toContain("OVER-BUDGET");
  });

  test("an LLM plan is validated and clamped; garbage falls back to the heuristic", async () => {
    const cfg = { baseUrl: "http://llama.internal:8000/v1", model: "llama-3.1-70b-instruct", provider: "openai-compatible" as const, configuredBy: "llm-env" as const };
    let calls = 0;
    const good: FetchLike = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          model: "llama-3.1-70b-instruct",
          choices: [{ message: { content: '{"parseMarkdownValues":true,"focusRules":["OVER-BUDGET","MADE-UP"],"maxDrafts":99,"note":"budget first"}' } }],
        }),
      );
    };
    const plan = await llmPlanFromPack(["01-tender-notice.md"], pack, "run-plan-test", cfg, good);
    expect(plan.source).toBe("llm");
    expect(plan.focusRules).toEqual(["OVER-BUDGET"]);
    expect(plan.maxDrafts).toBe(4);
    expect(plan.parseMarkdownValues).toBe(true);
    expect(plan.note).toBe("budget first");

    const bad: FetchLike = async () => new Response("nope", { status: 500 });
    const fallback = await llmPlanFromPack(["01-tender-notice.md"], pack, "run-plan-test", cfg, bad);
    expect(fallback.source).toBe("heuristic");
    expect(fallback.note).toContain("llm plan failed");
    expect(calls).toBe(1);
  });

  test("safety floor: an LLM plan cannot switch off deep-value parsing when the pack has bid values", async () => {
    const cfg = { baseUrl: "http://llama.internal:8000/v1", model: "llama-3.1-70b-instruct", provider: "openai-compatible" as const, configuredBy: "llm-env" as const };
    const disables: FetchLike = async () =>
      new Response(
        JSON.stringify({
          model: "llama-3.1-70b-instruct",
          choices: [{ message: { content: '{"parseMarkdownValues":false,"focusRules":["PRICE-OUTLIER"],"maxDrafts":2,"note":"skip values"}' } }],
        }),
      );
    const floorFiles = ["01-tender-notice.md", "02-bid-a.md", "03-bid-b.md"];
    const floorSources: Record<string, string> = {
      "01-tender-notice.md": "# NOTICE\n**Budget ceiling:** KES 1,860,000,000 (VAT inclusive)\n",
      "02-bid-a.md": "**Bidder:** Alpha Medical\n**Bid value:** KES 1,772,000,000\n",
      "03-bid-b.md": "**Bidder:** Beta Screening\n**Bid value:** KES 3,940,000,000\n",
    };
    const floorPack = buildPack(floorFiles, floorSources);
    const plan = await llmPlanFromPack(floorFiles, floorPack, "run-plan-floor", cfg, disables);
    expect(plan.source).toBe("llm");
    expect(plan.parseMarkdownValues).toBe(true); // floor held — model said false
    expect(plan.note).toContain("parse floor");
    /* ...and the flagship check still bites end-to-end under the floored plan. */
    const { kept } = flagPack(floorPack, floorFiles, plan);
    expect(kept.some((f) => f.rule === "R-OVER-BUDGET")).toBe(true);
  });
});

describe("flagPack under the plan: over-budget and markdown value outliers", () => {
  const files = ["01-tender-notice.md", "02-bid-portscan-systems.md", "03-bid-coastline-screening.md"];
  const sources: Record<string, string> = {
    "01-tender-notice.md": "# NOTICE\n**Budget ceiling:** KES 1,860,000,000 (VAT inclusive)\n",
    "02-bid-portscan-systems.md": "**Bidder:** Portscan Systems\n**Bid value:** KES 1,772,000,000\n",
    "03-bid-coastline-screening.md": "**Bidder:** Coastline Screening Solutions\n**Bid value:** KES 3,940,000,000\n",
  };
  const pack = buildPack(files, sources);
  const { kept } = flagPack(pack, files);

  test("a bid over the published ceiling is flagged, cited to its own value line, and survives the self-check", () => {
    const f = kept.find((x) => x.rule === "R-OVER-BUDGET");
    expect(f?.item).toBe("COASTLINE SCREENING");
    expect(f?.citation).toBe("03-bid-coastline-screening.md, bid value line");
    expect(f && verifyFinding(f, sources)).toBe(true);
  });

  test("a markdown bid value outlier is flagged against its peer median and survives the self-check", () => {
    const f = kept.find((x) => x.rule === "R-VALUE-OUTLIER");
    expect(f?.item).toBe("COASTLINE SCREENING");
    expect(f?.evidence).toContain("3,940,000,000");
    expect(f && verifyFinding(f, sources)).toBe(true);
  });

  test("an under-ceiling, mid-pack bid is not flagged", () => {
    expect(kept.filter((x) => x.rule === "R-OVER-BUDGET")).toHaveLength(1);
    expect(kept.some((x) => x.item === "PORTSCAN SYSTEMS" && (x.rule === "R-OVER-BUDGET" || x.rule === "R-VALUE-OUTLIER"))).toBe(false);
  });
});

describe("bounded reason-and-retry", () => {
  const sources = {
    "03-bid-coastline.md": "**Bidder:** Coastline Screening Solutions\n**Bid value:** KES 3,940,000,000\nAlternative offered for the radiation segment.\n",
  };

  test("a tampered evidence line is re-anchored to a real line and passes the self-check", () => {
    const f: Finding = { id: "F-01", rule: "R-SPEC-DEVIATION", severity: "HIGH", item: "COASTLINE SCREENING", evidence: "garbled evidence that is in no document", citation: "03-bid-coastline.md, specifications matrix" };
    const out = repairFinding({ finding: f, reason: "deviation text not found in cited bid" }, sources);
    expect(out.repaired).toBeDefined();
    expect(out.repaired?.repaired).toBe(true);
    expect(out.repaired && verifyFinding(out.repaired, sources)).toBe(true);
  });

  test("a value finding with garbled evidence is re-anchored via its stated amount", () => {
    const f: Finding = { id: "F-02", rule: "R-VALUE-OUTLIER", severity: "HIGH", item: "COASTLINE SCREENING", evidence: "numbers misplaced", citation: "03-bid-coastline.md, bid value line" };
    const out = repairFinding({ finding: f, reason: "bid value or bidder not found in cited bid" }, sources);
    expect(out.repaired?.evidence).toContain("3,940,000,000");
  });

  test("a finding citing a document that does not exist is dropped with a reason, never repaired", () => {
    const f: Finding = { id: "F-03", rule: "R-SPEC-DEVIATION", severity: "HIGH", item: "COASTLINE SCREENING", evidence: "x", citation: "99-bid-ghost.md, specifications matrix" };
    const out = repairFinding({ finding: f, reason: "cited document missing" }, sources);
    expect(out.repaired).toBeUndefined();
    expect(out.dropReason).toContain("does not exist");
  });

  test("verifyFinding reports the reason a finding was refused", () => {
    const f: Finding = { id: "", rule: "R-SPEC-DEVIATION", severity: "HIGH", item: "X", evidence: "absent line", citation: "03-bid-coastline.md, specifications matrix" };
    expect(verifyFindingReason(f, sources)).toContain("not found");
    expect(verifyFindingReason(f, { "99.md": "x" })).toContain("not in this tender");
  });
});

describe("publisher-mess rules — supplier identifiers and missing buyers", () => {
  const bids = (bodies: string[]): BidDoc[] =>
    bodies.map((text, i) => ({ bidder: `BIDDER ${i + 1}`, text, source: `0${i + 2}-bid-x.md` }));

  test("flags a KRA PIN that breaks its own scheme, cited to the exact bid", () => {
    const f = supplierIdFindings(bids(["**KRA PIN:** P0518472\n**Bid value:** KES 1,000,000"]));
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("R-SUPPLIER-ID");
    expect(f[0].severity).toBe("HIGH");
    expect(f[0].citation).toContain("02-bid-x.md");
    expect(f[0].evidence).toContain("P0518472");
  });

  test("keeps a well-formed KRA PIN and a well-formed Rwanda TIN silent", () => {
    expect(supplierIdFindings(bids(["**KRA PIN:** C004829173K"]))).toHaveLength(0);
    expect(supplierIdFindings(bids(["- TIN: 100000009"]))).toHaveLength(0);
  });

  test("flags a broken TIN under the Rwanda scheme", () => {
    const f = supplierIdFindings(bids(["**TIN:** 2051AB"]));
    expect(f).toHaveLength(1);
    expect(f[0].evidence).toContain("2051AB");
  });

  test("flags an identifier line that states nothing (blank, dash, N/A)", () => {
    const f = supplierIdFindings(bids(["**KRA PIN:** —", "- TIN: N/A"]));
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.rule === "R-SUPPLIER-ID")).toBe(true);
  });

  test("leaves identifiers alone when the line names no known scheme", () => {
    expect(supplierIdFindings(bids(["**VAT Number:** GB123456789"]))).toHaveLength(0);
  });

  test("flags a structured notice that never names the buyer", () => {
    const notice = "# TENDER NOTICE\n\n**Reference:** KE-X-2026-001\n**Subject:** Kits\n";
    const f = buyerMissingFindings(notice, "01-tender-notice.md");
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("R-BUYER-MISSING");
    expect(f[0].severity).toBe("MEDIUM");
    expect(f[0].evidence).toContain("KE-X-2026-001");
  });

  test("a placeholder buyer line counts as no buyer", () => {
    const notice = "**Reference:** KE-X-2026-002\n**Buyer:** —\n";
    expect(buyerMissingFindings(notice, "01.md")).toHaveLength(1);
    const named = "**Reference:** KE-X-2026-003\n**Buyer:** Coast Water Works\n";
    expect(buyerMissingFindings(named, "01.md")).toHaveLength(0);
  });

  test("unstructured text without a reference line is not judged", () => {
    expect(buyerMissingFindings("just some prose", "01.md")).toHaveLength(0);
  });

  test("both findings survive the self-check against their cited documents", () => {
    const sources = {
      "01-tender-notice.md": "**Reference:** KE-X-2026-004\n",
      "02-bid-x.md": "**KRA PIN:** P0518472\n",
    };
    const [idF] = supplierIdFindings(bids(["**KRA PIN:** P0518472"]));
    const [bF] = buyerMissingFindings(sources["01-tender-notice.md"], "01-tender-notice.md");
    expect(verifyFinding(idF, sources)).toBe(true);
    expect(verifyFinding(bF, sources)).toBe(true);
  });

  test("the plan focuses the new families only when the pack carries the mess", () => {
    const messy = planFromPack(
      ["01-tender-notice.md", "02-bid-x.md"],
      {
        bids: bids(["**KRA PIN:** P0518472"]),
        records: [],
        notices: [{ file: "01-tender-notice.md", text: "**Reference:** KE-X-2026-005\n" }],
      },
    );
    expect(messy.focusRules).toContain("SUPPLIER-ID");
    expect(messy.focusRules).toContain("BUYER-MISSING");
    const clean = planFromPack(
      ["01-tender-notice.md", "02-bid-x.md"],
      {
        bids: bids(["no identifiers here"]),
        records: [],
        notices: [{ file: "01-tender-notice.md", text: "**Reference:** KE-X-2026-006\n**Buyer:** Ministry\n" }],
      },
    );
    expect(clean.focusRules).not.toContain("SUPPLIER-ID");
    expect(clean.focusRules).not.toContain("BUYER-MISSING");
  });

  test("flagPack keeps both mess findings end-to-end on the shipped KE-MSA pack shape", () => {
    const files = ["01-tender-notice.md", "02-bid-bahari.md", "03-bid-mombasa.md"];
    const sources = {
      "01-tender-notice.md": "# TENDER NOTICE\n\n**Reference:** KE-MSA-2026-090\n**Budget ceiling:** KES 240,000,000\n",
      "02-bid-bahari.md": "**Bidder:** BAHARI\n**KRA PIN:** C004829173K\n**Bid value:** KES 109,800,000\n",
      "03-bid-mombasa.md": "**Bidder:** MOMBASA\n**KRA PIN:** P0518472\n**Bid value:** KES 113,200,000\n",
    };
    const pack = buildPack(files, sources);
    const { kept, rejected } = flagPack(pack, files);
    const rules = kept.map((f) => f.rule);
    expect(rules).toContain("R-SUPPLIER-ID");
    expect(rules).toContain("R-BUYER-MISSING");
    expect(rejected).toHaveLength(0);
    expect(kept.every((f) => verifyFinding(f, sources))).toBe(true);
  });
});
