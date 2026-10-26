/**
 * quorum-mcp — the African roll-up.
 *
 * The OCP Data Registry lists datasets, not countries; the Sources screen
 * speaks in countries. This module folds the 22 published African datasets
 * into one row per country, counting only what the registry itself states:
 * datasets, publishers, coverage span, latest retrieval, formats.
 *
 * Counts are deliberately NOT summed across datasets — two datasets from
 * the same country can overlap (an aggregator like Budeshi reads other
 * states' records), so the registry's per-dataset figures stay per dataset.
 */

import type { OcpAfricaDataset } from "./ocp-africa";

export interface OcpCountryRow {
  country: string;
  iso: string;
  datasets: number;
  /** Datasets the registry marks "no longer updated by the publisher". */
  stale: number;
  publishers: string[];
  /** Earliest coverage start across the country's datasets (ISO date). */
  coverageFrom: string;
  /** Latest coverage end across the country's datasets (ISO date). */
  coverageTo: string;
  /** Latest retrieval across the country's datasets (ISO date). */
  lastRetrieved: string;
  /** Formats covered by the country's published downloads. */
  formats: string[];
  /** The registry's search, pre-filtered to this country. */
  searchUrl: string;
}

export function rollupAfrica(datasets: OcpAfricaDataset[]): OcpCountryRow[] {
  const byCountry = new Map<string, OcpCountryRow>();
  for (const d of datasets) {
    let row = byCountry.get(d.country);
    if (!row) {
      row = {
        country: d.country,
        iso: d.iso,
        datasets: 0,
        stale: 0,
        publishers: [],
        coverageFrom: d.coverageFrom,
        coverageTo: d.coverageTo,
        lastRetrieved: d.lastRetrieved,
        formats: [],
        searchUrl: `https://data.open-contracting.org/en/search/?country=${encodeURIComponent(d.country).replace(/%20/g, "+")}`,
      };
      byCountry.set(d.country, row);
    }
    row.datasets += 1;
    if (d.stale) row.stale += 1;
    row.publishers.push(d.publisher);
    if (d.coverageFrom && (!row.coverageFrom || d.coverageFrom < row.coverageFrom)) row.coverageFrom = d.coverageFrom;
    if (d.coverageTo > row.coverageTo) row.coverageTo = d.coverageTo;
    if (d.lastRetrieved > row.lastRetrieved) row.lastRetrieved = d.lastRetrieved;
    for (const dl of d.downloads) {
      if (!row.formats.includes(dl.format)) row.formats.push(dl.format);
    }
  }
  return [...byCountry.values()];
}
