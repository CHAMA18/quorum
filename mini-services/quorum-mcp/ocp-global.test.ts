import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OCP_AFRICA } from "./ocp-africa";
import { OCP_GLOBAL, OCP_GLOBAL_SOURCE } from "./ocp-global";
import { OCP_REGISTRY } from "./ocp-registry";

describe("the OCP registry beyond Africa", () => {
  test("carries every non-African dataset the registry listed at retrieval", () => {
    expect(OCP_GLOBAL).toHaveLength(114);
    expect(new Set(OCP_GLOBAL.map((d) => d.country)).size).toBe(63);
    expect(OCP_GLOBAL.filter((d) => d.country === "Mexico")).toHaveLength(18);
    expect(OCP_GLOBAL.filter((d) => d.stale)).toHaveLength(33);
  });

  test("keeps global and African publication ids disjoint", () => {
    const africaIds = new Set(OCP_AFRICA.map((d) => d.publicationId));
    for (const d of OCP_GLOBAL) expect(africaIds.has(d.publicationId)).toBe(false);
    expect(OCP_REGISTRY).toHaveLength(136);
  });

  test("every row is traceable to its registry page", () => {
    for (const d of OCP_GLOBAL) {
      expect(d.publicationId).toBeGreaterThan(0);
      expect(d.registryUrl).toMatch(/^https:\/\/data\.open-contracting\.org\/en\/publication\/\d+$/);
      expect(d.publisher.length).toBeGreaterThan(0);
      expect(d.coverageFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.coverageTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.coverageTo >= d.coverageFrom).toBe(true);
      if (d.lastRetrieved) expect(d.lastRetrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.license === null || d.license.length > 0).toBe(true);
    }
    /* One published record (Prozorro) currently has no file/counts on the
       registry; the row stays, with its missing figures left missing. */
    expect(OCP_GLOBAL.filter((d) => d.downloads.length === 0)).toHaveLength(1);
    expect(OCP_GLOBAL.filter((d) => !d.lastRetrieved)).toHaveLength(1);
  });

  test("declares its own provenance and scope", () => {
    expect(OCP_GLOBAL_SOURCE.via).toBe("https://data.open-contracting.org/en/search/");
    expect(OCP_GLOBAL_SOURCE.scope).toContain("136 datasets");
    expect(OCP_GLOBAL_SOURCE.scope).toContain("114 non-African datasets across 63 countries");
  });

  test("the runtime JSON is the same snapshot the types carry", () => {
    const raw = JSON.parse(
      readFileSync(join(import.meta.dir, "data", "ocp-registry.json"), "utf8"),
    ) as {
      registryTotal: number;
      africa: { datasets: { publicationId: number }[] };
      global: { datasets: { publicationId: number }[] };
    };
    expect(raw.registryTotal).toBe(136);
    expect(raw.africa.datasets.map((d) => d.publicationId)).toEqual(OCP_AFRICA.map((d) => d.publicationId));
    expect(raw.global.datasets.map((d) => d.publicationId)).toEqual(OCP_GLOBAL.map((d) => d.publicationId));
  });
});
