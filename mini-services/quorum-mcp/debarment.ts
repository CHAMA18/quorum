/**
 * quorum-mcp — the debarment register (G4 of the procurement-cycle build).
 *
 * A seeded screening list, in the shape the real sources publish: the entity
 * name, the country/institution that listed it, the stated ground and the
 * exclusion window. The engine screens every bidder name against it at flag
 * time — the same deterministic, cited-to-the-bid discipline as the platform
 * supplier register, but sourced from published debarment decisions.
 *
 * THE DATA IS REAL-SHAPED, NOT LIVE: entries mirror the form of national
 * debarment lists (PPDA Kenya, PPDA Zambia, World Bank) with plainly
 * illustrative names, so the check is exercised end-to-end without claiming
 * a live feed. Wiring a live source replaces this module — nothing else.
 */

export const DEBARMENT_SOURCE = "seeded debarment register (illustrative entries, real list shape)";

export interface DebarmentEntry {
  name: string;
  listedBy: string;
  ground: string;
  from: string;
  until?: string;
}

export const DEBARMENT_LIST: DebarmentEntry[] = [
  {
    name: "Meridian Construction Group",
    listedBy: "PPDA Kenya (illustrative entry)",
    ground: "fraudulent bid securities on two road contracts",
    from: "2025-03-01",
    until: "2030-02-28",
  },
  {
    name: "Zenith Medical Distributors",
    listedBy: "World Bank debarment list (illustrative entry)",
    ground: "collusive practices on a health-supply tender",
    from: "2024-11-15",
    until: "2029-11-14",
  },
  {
    name: "Copperline Haulage",
    listedBy: "ZPPA register of debarred suppliers (illustrative entry)",
    ground: "misrepresentation of tax clearance status",
    from: "2026-01-10",
    until: "2028-01-09",
  },
];
