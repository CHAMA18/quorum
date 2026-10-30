import { describe, expect, test } from "bun:test";
import { supplierPulseRows, type SupplierPulseEntry } from "@/lib/supplier-pulse";

/**
 * The supplier pulse is shown signed-out, so these tests pin the disclosure
 * rule: a row may say what happened and when, never who did it or why.
 */

describe("supplier pulse rows", () => {
  test("maps a received filing, a refused filing and an enrolment", () => {
    const rows = supplierPulseRows([
      { tool: "supplier_application", status: "OK", ts: "2026-10-29T10:00:00.000Z" },
      { tool: "supplier_application", status: "ERROR", ts: "2026-10-29T11:00:00.000Z" },
      { tool: "supplier_add", status: "OK", ts: "2026-10-29T12:00:00.000Z" },
    ]);
    expect(rows.map((row) => [row.kind, row.phrase])).toEqual([
      ["received", "application received"],
      ["refused", "application refused"],
      ["enrolled", "supplier enrolled"],
    ]);
  });

  test("an enrolment stays an enrolment even when the write reports an error", () => {
    const [row] = supplierPulseRows([{ tool: "supplier_add", status: "ERROR" }]);
    expect(row.kind).toBe("enrolled");
    expect(row.phrase).toBe("supplier enrolled");
  });

  test("caps the pulse at four rows by default and respects an explicit limit", () => {
    const entries: SupplierPulseEntry[] = Array.from({ length: 6 }, (_, i) => ({
      tool: "supplier_application",
      status: "OK",
      ts: `2026-10-29T10:00:0${i}.000Z`,
    }));
    expect(supplierPulseRows(entries)).toHaveLength(4);
    expect(supplierPulseRows(entries, 2)).toHaveLength(2);
    expect(supplierPulseRows(entries, 0)).toEqual([]);
  });

  test("never copies a detail or title, even if the entry carries them", () => {
    const entry = {
      tool: "supplier_application",
      status: "ERROR",
      ts: "2026-10-29T10:00:00.000Z",
      actor: "org:Northwind Clinical",
      detail: "Northwind was refused: price 185000",
      title: "Northwind Clinical → T-ALPHA",
      inputs: '{"bidder":"Northwind"}',
      outputs: '{"refused":"price too high"}',
    };
    const [row] = supplierPulseRows([entry]);
    expect(row.detail).toBe("");
    expect(row.title).toBe("");
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain("Northwind");
    expect(serialised).not.toContain("185000");
    expect(serialised).not.toContain("price too high");
  });

  test("formats a valid timestamp and blanks an invalid or missing one", () => {
    const rows = supplierPulseRows([
      { tool: "supplier_application", ts: "2026-10-29T10:00:00.000Z" },
      { tool: "supplier_application", ts: "not-a-date" },
      { tool: "supplier_application" },
    ]);
    expect(rows[0].ts.length).toBeGreaterThan(0);
    expect(rows[1].ts).toBe("");
    expect(rows[2].ts).toBe("");
  });

  test("is stable, non-mutating, and keeps the supplied order", () => {
    const entries = [
      { tool: "supplier_add", ts: "2026-10-29T12:00:00.000Z" },
      { tool: "supplier_application", status: "OK", ts: "2026-10-29T11:00:00.000Z" },
    ] as const;
    const snapshot = JSON.stringify(entries);
    const first = supplierPulseRows(entries);
    const second = supplierPulseRows(entries);
    expect(first.map((row) => row.phrase)).toEqual(["supplier enrolled", "application received"]);
    expect(first.map((row) => row.key)).toEqual(second.map((row) => row.key));
    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(supplierPulseRows([])).toEqual([]);
  });
});
