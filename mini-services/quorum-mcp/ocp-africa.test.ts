import { describe, expect, test } from "bun:test";
import { OCP_AFRICA, OCP_AFRICA_SOURCE } from "./ocp-africa";
import { rollupAfrica } from "./ocp-africa-roll";

describe("the OCP registry snapshot — data integrity", () => {
  test("carries every African dataset the registry listed at retrieval", () => {
    expect(OCP_AFRICA).toHaveLength(22);
    expect(new Set(OCP_AFRICA.map((d) => d.country)).size).toBe(9);
    expect(OCP_AFRICA.filter((d) => d.country === "Nigeria")).toHaveLength(13);
  });

  test("every row is traceable to its registry page and complete", () => {
    for (const d of OCP_AFRICA) {
      expect(d.publicationId).toBeGreaterThan(0);
      expect(d.registryUrl).toMatch(/^https:\/\/data\.open-contracting\.org\/en\/publication\/\d+$/);
      expect(d.iso).toMatch(/^[A-Z]{2}$/);
      expect(d.publisher.length).toBeGreaterThan(0);
      expect(d.coverageFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.coverageTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.coverageTo >= d.coverageFrom).toBe(true);
      expect(d.lastRetrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.lastRetrieved >= d.coverageFrom).toBe(true);
      expect(d.downloads.length).toBeGreaterThan(0);
      expect(d.counts.tenders).toBeGreaterThan(0);
      expect(d.license === null || d.license.length > 0).toBe(true);
    }
  });

  test("agrees with the ZPPA mining of the same record (independent cross-check)", () => {
    const zambia = OCP_AFRICA.find((d) => d.publisher.includes("ZPPA"));
    expect(zambia).toBeDefined();
    expect(zambia!.coverageFrom).toBe("2016-08-10");
    expect(zambia!.coverageTo).toBe("2026-05-29");
  });

  test("keeps the registry's stale flag — never silently", () => {
    const stale = OCP_AFRICA.filter((d) => d.stale);
    expect(stale).toHaveLength(10);
    // A dataset the publisher stopped updating ends well before its last pull.
    for (const d of stale) expect(d.coverageTo < d.lastRetrieved).toBe(true);
  });

  test("declares its provenance", () => {
    expect(OCP_AFRICA_SOURCE.via).toBe("https://data.open-contracting.org/en/search/");
    expect(OCP_AFRICA_SOURCE.scope).toContain("135 datasets");
    expect(OCP_AFRICA_SOURCE.scope).toContain("22 African datasets across 9 countries");
  });
});

describe("the African roll-up", () => {
  const countries = rollupAfrica(OCP_AFRICA);

  test("folds 22 datasets into the 9 publishing countries, in registry order", () => {
    expect(countries.map((c) => c.country)).toEqual([
      "Ghana",
      "Kenya",
      "Liberia",
      "Nigeria",
      "Rwanda",
      "South Africa",
      "Tanzania",
      "Uganda",
      "Zambia",
    ]);
    expect(countries.reduce((n, c) => n + c.datasets, 0)).toBe(22);
  });

  test("spans each country's coverage without overstating it", () => {
    const nigeria = countries.find((c) => c.country === "Nigeria")!;
    expect(nigeria.datasets).toBe(13);
    expect(nigeria.stale).toBe(9);
    expect(nigeria.coverageFrom).toBe("2014-03-10"); // Anambra State
    expect(nigeria.coverageTo).toBe("2026-09-09"); // Bureau of Public Procurement
    expect(nigeria.lastRetrieved).toBe("2026-10-05"); // Osun State
    expect(nigeria.publishers).toContain("Bureau of Public Procurement (BPP)");
    expect(nigeria.searchUrl).toBe("https://data.open-contracting.org/en/search/?country=Nigeria");
  });

  test("pre-filters the registry search for multi-word countries", () => {
    expect(countries.find((c) => c.country === "South Africa")!.searchUrl).toBe(
      "https://data.open-contracting.org/en/search/?country=South+Africa",
    );
  });

  test("a country with no stale datasets reads as fully updating", () => {
    const ghana = countries.find((c) => c.country === "Ghana")!;
    expect(ghana.datasets).toBe(1);
    expect(ghana.stale).toBe(0);
  });
});
