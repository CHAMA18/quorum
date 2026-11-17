import { describe, expect, test } from "bun:test";
import {
  composeTenderDraft,
  composerReply,
  draftGaps,
  emptyDraft,
  extractJsonObject,
  normalizeDraft,
  preferVerbatim,
  parseBudget,
  parseClosing,
  titleFrom,
} from "./tender-draft";

const NOW = new Date("2026-11-16T08:00:00.000Z");

describe("the deterministic tender composer", () => {
  test("reads a budget the officer actually wrote, and only then", () => {
    expect(parseBudget("budget of ZMW 4.5 million")).toEqual({ budget: 4_500_000, currency: "ZMW" });
    expect(parseBudget("$120,000")).toEqual({ budget: 120_000, currency: "USD" });
    expect(parseBudget("2 million kwacha")).toEqual({ budget: 2_000_000, currency: "ZMW" });
    /* A count is not a budget. */
    expect(parseBudget("supply of 12 ambulances")).toBeNull();
  });

  test("reads a closing date without inventing one", () => {
    expect(parseClosing("closing 15 December 2026", NOW)).toBe("2026-12-15");
    expect(parseClosing("bids close 30 November", NOW)).toBe("2026-11-30");
    expect(parseClosing("closing in 21 days", NOW)).toBe("2026-12-07");
    expect(parseClosing("30/11/2026", NOW)).toBe("2026-11-30");
    expect(parseClosing("soon", NOW)).toBeNull();
  });

  test("turns a spoken brief into a usable draft", () => {
    const draft = composeTenderDraft(
      "Draft a tender for supply of 12 ambulances to the Ministry of Health, budget ZMW 4.5 million, closing 15 December 2026, 24-month warranty",
      emptyDraft(),
      NOW,
    );
    expect(draft.title.toLowerCase()).toContain("ambulances");
    expect(draft.buyer).toBe("Ministry of Health");
    expect(draft.category).toBe("Vehicles & fleet");
    expect(draft.budget).toBe(4_500_000);
    expect(draft.currency).toBe("ZMW");
    expect(draft.closingDate).toBe("2026-12-15");
    expect(draft.evaluation.reduce((sum, row) => sum + row.weight, 0)).toBe(100);
    expect(draft.documents.length).toBeGreaterThan(3);
    expect(draftGaps(draft)).toEqual([]);
  });

  test("a refinement edits the draft instead of replacing it", () => {
    const first = composeTenderDraft(
      "Create a tender for office laptops for the Ministry of Education with a budget of ZMW 900,000",
      emptyDraft(),
      NOW,
    );
    const second = composeTenderDraft("make the closing date 30 January 2027", first, NOW);
    expect(second.title).toBe(first.title);
    expect(second.buyer).toBe("Ministry of Education");
    expect(second.budget).toBe(900_000);
    expect(second.category).toBe("ICT & software");
    expect(second.closingDate).toBe("2027-01-30");
  });

  test("reports what is still missing, and says so without a model", () => {
    const gaps = draftGaps(emptyDraft()).map((gap) => gap.label);
    expect(gaps).toContain("Budget");
    expect(gaps).toContain("Closing date");
    const reply = composerReply(composeTenderDraft("Create a tender for cleaning services", emptyDraft(), NOW));
    expect(reply).toContain("Draft:");
    expect(reply).toContain("Still needed");
  });

  test("keeps a title when the sentence is an edit, not a new tender", () => {
    expect(titleFrom("Create a tender for supply of vaccines")).toBe("Supply of vaccines");
    expect(titleFrom("Change the closing date to 4 March 2027")).toBe("Change the closing date to 4 March 2027");
  });

  test("merges a model's object over the deterministic draft without emptying it", () => {
    const base = composeTenderDraft("Create a tender for security guards for the City Council", emptyDraft(), NOW);
    const merged = normalizeDraft(
      { title: "Provision of unarmed guarding services", budget: "1500000", closingDate: "2027-02-01", evaluation: [{ criterion: "Price", weight: 40 }] },
      base,
    );
    expect(merged.title).toBe("Provision of unarmed guarding services");
    expect(merged.buyer).toBe("City Council");
    expect(merged.budget).toBe(1_500_000);
    expect(merged.closingDate).toBe("2027-02-01");
    expect(merged.documents).toEqual(base.documents);
    expect(merged.evaluation).toEqual([{ criterion: "Price", weight: 40 }]);
  });

  test("finds the tender object inside a small model's chatter", () => {
    const fenced = 'Here you go:\n```json\n{"reply":"Drafted.","tender":{"title":"Supply of vaccines"}}\n```';
    expect(extractJsonObject(fenced)).toEqual({ reply: "Drafted.", tender: { title: "Supply of vaccines" } });
    const nested = 'Sure. {"reply":"ok {not json}","tender":{"title":"X"}}';
    expect(extractJsonObject(nested)).toEqual({ reply: "ok {not json}", tender: { title: "X" } });
    expect(extractJsonObject("I cannot help with that.")).toBeNull();
  });

  test("the officer's own facts outrank the model's rewrite", () => {
    const verbatim = composeTenderDraft(
      "Create a tender for 12 ambulances for the Ministry of Health, budget ZMW 4.5 million, closing 15 December 2026",
      emptyDraft(),
      NOW,
    );
    const modelled = normalizeDraft(
      {
        title: "Supply and delivery of twelve emergency ambulances to the Ministry of Health in Lusaka Province",
        budget: 5_000_000,
        closingDate: "2026-12-14",
        summary: "A twelve-ambulance fleet for district referral services.",
      },
      verbatim,
    );
    const merged = preferVerbatim(verbatim, modelled);
    expect(merged.title).toBe(verbatim.title);
    expect(merged.budget).toBe(4_500_000);
    expect(merged.closingDate).toBe("2026-12-15");
    /* Drafting still comes from the model. */
    expect(merged.summary).toBe("A twelve-ambulance fleet for district referral services.");
  });

  test("the status line reports changes and gaps from the record, not from a guess", () => {
    const first = composeTenderDraft("Create a tender for cleaning services", emptyDraft(), NOW);
    const second = composeTenderDraft("budget ZMW 800,000, closing 30 January 2027", first, NOW);
    const reply = composerReply(second, first);
    expect(reply).toContain("Budget: ZMW 800,000");
    expect(reply).toContain("Closing: 30 Jan 2027");
    expect(reply).toContain("Still needed: buyer");
    expect(reply).not.toContain("closing date");
  });

  test("ignores junk instead of half-writing a draft", () => {
    const base = composeTenderDraft("Create a tender for training workshops", emptyDraft(), NOW);
    const merged = normalizeDraft({ title: 42, budget: -4, closingDate: "not a date", eligibility: "nope" }, base);
    expect(merged.title).toBe(base.title);
    expect(merged.budget).toBeNull();
    expect(merged.closingDate).toBeNull();
    expect(merged.eligibility).toEqual(base.eligibility);
  });
});

describe("tender composer accuracy (Nairobi bench)", () => {
  test("reads East African currencies + long-form shillings, never a count", () => {
    expect(parseBudget("budget KSh 5.2m")).toEqual({ budget: 5_200_000, currency: "KES" });
    expect(parseBudget("KShs 90 million")).toEqual({ budget: 90_000_000, currency: "KES" });
    expect(parseBudget("Kenyan shillings 5 million")).toEqual({ budget: 5_000_000, currency: "KES" });
    expect(parseBudget("Rwanda francs 2 million")).toEqual({ budget: 2_000_000, currency: "RWF" });
    expect(parseBudget("budget RWF 2.15 billion")).toEqual({ budget: 2_150_000_000, currency: "RWF" });
    expect(parseBudget("budget UGX 850 million")).toEqual({ budget: 850_000_000, currency: "UGX" });
    expect(parseBudget("budget TSh 90 million")).toEqual({ budget: 90_000_000, currency: "TZS" });
    expect(parseBudget("budget KES 412 600 000")).toEqual({ budget: 412_600_000, currency: "KES" });
    expect(parseBudget("supply of 12 ambulances")).toBeNull();
  });

  test("reads plural months, US-order dates only when day-first is impossible, and county buyers", () => {
    const d = composeTenderDraft("Consultancy to design a water reticulation master plan, ZMW 12 million, 6 months", emptyDraft(), NOW);
    expect(d.contractMonths).toBe(6);
    expect(d.category).toBe("Consultancy");
    expect(parseClosing("closing 10/17/2026", NOW)).toBe("2026-10-17");
    expect(parseClosing("closing 17/10/2026", NOW)).toBe("2026-10-17");
    expect(composeTenderDraft("Supply of cold chain equipment for the county health department, budget KES 10 million", emptyDraft(), NOW).category).toBe("Medical supplies");
  });
});
