import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sidebar's labels live in `NAV_GROUPS` inside dashboard.tsx, which is a
 * client component and cannot be imported without a DOM. Read the declaration
 * as text instead — the regex only looks between `const NAV_GROUPS` and its
 * closing `];`, so prose elsewhere in the file is not picked up.
 */
const dashboard = readFileSync(join(import.meta.dir, "..", "components", "quorum", "dashboard.tsx"), "utf8");

function sidebarLabels(): string[] {
  const start = dashboard.indexOf("const NAV_GROUPS");
  expect(start).toBeGreaterThan(-1);
  const end = dashboard.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);
  return [...dashboard.slice(start, end).matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("Quorum sidebar", () => {
  const labels = sidebarLabels();

  test("every nav group renders at least one label", () => {
    expect(labels.length).toBeGreaterThanOrEqual(10);
  });

  test("every label is title case", () => {
    for (const label of labels) {
      const words = label.split(/\s+/);
      for (const word of words) {
        if (!/^[A-Za-z]/.test(word)) continue; // "&" and other separators
        expect({ label, word, startsCapital: /^[A-Z]/.test(word) }).toEqual({ label, word, startsCapital: true });
      }
    }
  });

  test("the labels renamed for title case are the ones on screen", () => {
    for (const label of [
      "Tender Cycle",
      "Live Activity",
      "Data Sources",
      "Award History",
      "Audit Trail",
      "Rules & Safeguards",
    ]) {
      expect(labels).toContain(label);
    }
  });
});
