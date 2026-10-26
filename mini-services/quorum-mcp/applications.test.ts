/**
 * The supplier-side marketplace, tested without the network.
 *
 * These are the admission rules an application must survive before it lands
 * on the procurement record: only attested org identities file, late bids
 * are refused, one bid per organization per tender, suspended suppliers are
 * refused, and the opportunities board reads the cycle's closing date
 * before the notice's. The route wiring (filesystem, register sync, audit
 * log) lives in index.ts — the DECISIONS live here and are pinned here.
 */

import { describe, expect, test } from "bun:test";
import {
  marketplaceEntries,
  supplierFromOrgProfile,
  validateApplicationAdmission,
  validateApplicationRequest,
} from "./marketplace";
import type { SupplierApplication, TenderCycle } from "./store";

const NOW = new Date("2026-10-21T09:00:00.000Z");
const FUTURE = "2026-12-01T10:00:00.000Z";
const PAST = "2026-09-01T10:00:00.000Z";

const app = (over: Partial<SupplierApplication> = {}): SupplierApplication => ({
  id: "app_probe0001",
  tenderId: "KE-WRA-2026-058",
  orgId: "org-1",
  orgName: "Rift Pumps Ltd",
  actor: "org:Rift Pumps Ltd",
  registrationNo: "REG-100",
  amount: 1_000_000,
  receivedAt: NOW.toISOString(),
  status: "RECEIVED",
  ...over,
});

describe("validateApplicationRequest — shape and identity", () => {
  test("an attested org identity with a priced body passes", () => {
    const out = validateApplicationRequest({
      actor: "org:Rift Pumps Ltd",
      tenderRef: "KE-WRA-2026-058",
      amount: 1_000_000,
      currency: "KES",
      coverNote: "We can deliver in 60 days.",
    });
    expect(out.ok).toBe(true);
  });

  test("an officer's attested session is refused — suppliers bid, the desk reviews", () => {
    const out = validateApplicationRequest({ actor: "Verify Officer", tenderRef: "KE-WRA-2026-058", amount: 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(403);
  });

  test("an anonymous mutation is refused", () => {
    const out = validateApplicationRequest({ actor: "", tenderRef: "KE-WRA-2026-058", amount: 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(403);
  });

  test("an org actor with an empty name is refused", () => {
    const out = validateApplicationRequest({ actor: "org:", tenderRef: "KE-WRA-2026-058", amount: 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(403);
  });

  test("a bid without a price is not a bid", () => {
    for (const amount of [undefined, 0, -5, "abc", Number.NaN]) {
      const out = validateApplicationRequest({ actor: "org:Rift Pumps Ltd", tenderRef: "KE-WRA-2026-058", amount });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe(422);
    }
  });

  test("the tender reference must be named and plain", () => {
    for (const tenderRef of ["", "   ", "../escape", null]) {
      const out = validateApplicationRequest({ actor: "org:Rift Pumps Ltd", tenderRef, amount: 1 });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe(422);
    }
  });

  test("dot-only and traversal refs are refused — they resolve to the tenders folder itself or its parent", () => {
    for (const tenderRef of [".", "..", "...", "..x", "x..", ".hidden", "a/../b", "a\\b"]) {
      const out = validateApplicationRequest({ actor: "org:Rift Pumps Ltd", tenderRef, amount: 1 });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe(422);
    }
  });

  test("a plain tender reference with dots, dashes and underscores still passes", () => {
    for (const tenderRef of ["KE-WRA-2026-058", "ZM.2026_01", "T1"]) {
      expect(validateApplicationRequest({ actor: "org:Rift Pumps Ltd", tenderRef, amount: 1 }).ok).toBe(true);
    }
  });

  test("currency must look like a code and the note is capped", () => {
    const badCurrency = validateApplicationRequest({ actor: "org:Rift Pumps Ltd", tenderRef: "T1", amount: 1, currency: "KES!!" });
    expect(badCurrency.ok).toBe(false);
    const longNote = validateApplicationRequest({ actor: "org:Rift Pumps Ltd", tenderRef: "T1", amount: 1, coverNote: "x".repeat(1201) });
    expect(longNote.ok).toBe(false);
    if (!longNote.ok) expect(longNote.code).toBe(422);
    const edgeNote = validateApplicationRequest({ actor: "org:Rift Pumps Ltd", tenderRef: "T1", amount: 1, coverNote: "x".repeat(1200) });
    expect(edgeNote.ok).toBe(true);
  });
});

describe("validateApplicationAdmission — the record's disciplines", () => {
  const base = {
    actor: "org:Rift Pumps Ltd",
    tenderRef: "KE-WRA-2026-058",
    amount: 1_000_000,
    existing: [] as SupplierApplication[],
    registrationNo: "REG-100",
    now: NOW,
  };

  test("an open tender admits the application", () => {
    expect(validateApplicationAdmission({ ...base, closingDate: FUTURE }).ok).toBe(true);
  });

  test("no closing date stated anywhere still admits — honest, not invented", () => {
    expect(validateApplicationAdmission({ ...base, closingDate: undefined }).ok).toBe(true);
  });

  test("a late application is refused with the closing instant named", () => {
    const out = validateApplicationAdmission({ ...base, closingDate: PAST });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe(422);
      expect(out.error).toContain("2026-09-01");
    }
  });

  test("a second application from the same org for the same tender is refused", () => {
    const out = validateApplicationAdmission({
      ...base,
      closingDate: FUTURE,
      existing: [app()],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(409);
  });

  test("the same organization re-registered under a new email is still caught — registrationNo is the identity", () => {
    const out = validateApplicationAdmission({
      ...base,
      closingDate: FUTURE,
      existing: [app({ actor: "org:Rift Pumps (new account)", orgId: "org-2" })],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(409);
  });

  test("another organization applying to the same tender is fine", () => {
    const out = validateApplicationAdmission({
      ...base,
      actor: "org:Aqua Dynamics Ltd",
      registrationNo: "REG-200",
      closingDate: FUTURE,
      existing: [app()],
    });
    expect(out.ok).toBe(true);
  });

  test("an application to a different tender is fine", () => {
    const out = validateApplicationAdmission({
      ...base,
      tenderRef: "KE-MOE-2026-205",
      closingDate: FUTURE,
      existing: [app()],
    });
    expect(out.ok).toBe(true);
  });

  test("a suspended supplier is refused before anything else is checked", () => {
    const out = validateApplicationAdmission({ ...base, closingDate: PAST, supplierStatus: "SUSPENDED" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe(403);
      expect(out.error).toContain("SUSPENDED");
    }
  });

  test("a blacklisted supplier is refused with the register's word", () => {
    const out = validateApplicationAdmission({ ...base, closingDate: undefined, supplierStatus: "BLACKLISTED" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(403);
  });
});

describe("marketplaceEntries — the opportunities board", () => {
  const samples = [
    { ref: "T-OPEN", title: "Borehole pumps", buyer: "Water Resources Authority", sector: "WATER", currency: "KES", budget: "KES 8M ceiling", format: "PDF PACK" },
    { ref: "T-CLOSED", title: "Desks", buyer: "Ministry of Education", sector: "EDUCATION", currency: "KES", budget: "KES 90M ceiling", format: "PDF PACK" },
    { ref: "T-NOCLOSE", title: "Smart meters", buyer: "Not stated", sector: "WATER", currency: "RWF", budget: "RWF 2,400M", format: "OCDS" },
  ];
  const cycles = [{ tenderId: "T-OPEN", closingDate: "2026-12-01", closingSetBy: "officer" } as unknown as TenderCycle];
  const fromNotices: Record<string, string | undefined> = { "T-CLOSED": PAST, "T-NOCLOSE": undefined };
  const counts: Record<string, number> = { "T-OPEN": 2 };

  test("the cycle record's closing date wins over the notice's", () => {
    const out = marketplaceEntries(samples, cycles, { ...fromNotices, "T-OPEN": PAST }, counts, NOW);
    expect(out[0].closingDate).toBe("2026-12-01");
    expect(out[0].status).toBe("OPEN");
    expect(out[0].daysLeft).toBe(41); // Oct 21 → Dec 1 is 41 whole days
  });

  test("a tender whose notice closes in the past shows CLOSED", () => {
    const out = marketplaceEntries(samples, cycles, fromNotices, counts, NOW);
    expect(out[1].status).toBe("CLOSED");
    expect(out[1].daysLeft).toBeUndefined();
  });

  test("a tender with no closing date anywhere is OPEN and honestly marked", () => {
    const out = marketplaceEntries(samples, cycles, fromNotices, counts, NOW);
    expect(out[2].status).toBe("OPEN");
    expect(out[2].closingKnown).toBe(false);
    expect(out[2].closingDate).toBeUndefined();
  });

  test("application counts ride along", () => {
    const out = marketplaceEntries(samples, cycles, fromNotices, counts, NOW);
    expect(out[0].applications).toBe(2);
    expect(out[1].applications).toBe(0);
  });
});

describe("supplierFromOrgProfile — the register sync", () => {
  test("the profile snapshot maps onto the supplier register's shape", () => {
    const sup = supplierFromOrgProfile(
      {
        id: "org-1",
        name: "Rift Pumps Ltd",
        registrationNo: "REG-100",
        taxPin: "PIN-1",
        categories: ["Pumps", " Solar "],
        email: "bid@rift.example",
      },
      "sup_abc",
      "org:Rift Pumps Ltd",
      NOW.toISOString(),
    );
    expect(sup.id).toBe("sup_abc");
    expect(sup.name).toBe("Rift Pumps Ltd");
    expect(sup.registrationNo).toBe("REG-100");
    expect(sup.taxPin).toBe("PIN-1");
    expect(sup.categories).toEqual(["Pumps", "Solar"]);
    expect(sup.status).toBe("ACTIVE");
    expect(sup.addedBy).toBe("org:Rift Pumps Ltd");
    expect(sup.metadata.source).toBe("supplier-portal registration");
  });

  test("a bare profile still yields a well-formed register row, never a crash", () => {
    const sup = supplierFromOrgProfile({}, "sup_x", "org:Unknown", NOW.toISOString());
    expect(sup.name).toBe("Unnamed organization");
    expect(sup.registrationNo).toBe("UNREGISTERED");
    expect(sup.categories).toEqual([]);
  });
});
