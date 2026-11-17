/**
 * Field-accuracy bench for the Tender Builder composer (deterministic path).
 * Frozen cases: plain brief → expected fields. Scores per-field exact match
 * (budget+currency together, closing ISO, buyer substring, category exact,
 * contractMonths exact). A field the bench expects to be unset must stay unset.
 * Usage: bun scripts/tender-bench.ts
 */
import { composeTenderDraft, emptyDraft } from "../src/lib/tender-draft";

const NOW = new Date("2026-11-16T08:00:00.000Z");

interface Case {
  brief: string;
  budget?: number | null;
  currency?: string;
  closing?: string | null;
  buyerContains?: string | null;
  category?: string;
  months?: number | null;
}

const cases: Case[] = [
  { brief: "Supply and delivery of 12 ambulances to the Ministry of Health, budget ZMW 4.5 million, closing 15 December 2026", budget: 4500000, currency: "ZMW", closing: "2026-12-15", buyerContains: "Ministry of Health", category: "Vehicles & fleet" },
  { brief: "A 12-month cleaning contract for the council offices, budget ZMW 800,000, closing in 30 days", budget: 800000, currency: "ZMW", closing: "2026-12-16", months: 12, category: "Cleaning services" },
  { brief: "Consultancy to design a water reticulation master plan for the district council, ZMW 12 million, 6 months", budget: 12000000, currency: "ZMW", months: 6, category: "Consultancy" },
  { brief: "A 24-month ambulance maintenance contract for the Ministry of Health, budget ZMW 2 million, closing 20 January 2027", budget: 2000000, currency: "ZMW", closing: "2027-01-20", months: 24, category: "Vehicles & fleet" },
  { brief: "Supply of cold chain equipment for the county health department, budget KES 412.6 million, closing 17 October 2026", budget: 412600000, currency: "KES", closing: "2026-10-17", category: "Medical supplies" },
  { brief: "Supply of laptops for the county office, budget KSh 5.2m, closing 3 March 2027", budget: 5200000, currency: "KES", closing: "2027-03-03", category: "ICT & software" },
  { brief: "Printing services contract, budget USD 200k, closing 2026-12-31", budget: 200000, currency: "USD", closing: "2026-12-31" },
  { brief: "Road works for the city council, budget US$50,000, closing 17/10/2026", budget: 50000, currency: "USD", closing: "2026-10-17", category: "Works & construction" },
  { brief: "Supply of water pumps, budget RWF 2.15 billion, closing 2026-11-30", budget: 2150000000, currency: "RWF", closing: "2026-11-30" },
  { brief: "Supply of fertiliser, budget UGX 850 million, closing in 3 weeks", budget: 850000000, currency: "UGX", closing: "2026-12-07" },
  { brief: "Supply of school furniture, budget TSh 90 million, closing 2027-01-15", budget: 90000000, currency: "TZS", closing: "2027-01-15", category: "Furniture & office equipment" },
  { brief: "Supply of 12 ambulances", budget: null, currency: undefined, closing: null },
  { brief: "Budget ZMW 300 thousand for training sessions", budget: 300000, currency: "ZMW", category: "Training" },
];

let total = 0;
let hit = 0;
const misses: string[] = [];

for (const c of cases) {
  const d = composeTenderDraft(c.brief, emptyDraft(), NOW);
  const checks: [string, boolean][] = [];
  if (c.budget !== undefined) checks.push(["budget", d.budget === c.budget]);
  if (c.currency !== undefined) checks.push(["currency", d.currency === c.currency]);
  if (c.closing !== undefined) checks.push(["closing", d.closingDate === c.closing]);
  if (c.buyerContains !== undefined) checks.push(["buyer", c.buyerContains === null ? d.buyer === "" : d.buyer.toLowerCase().includes(c.buyerContains.toLowerCase())]);
  if (c.category !== undefined) checks.push(["category", d.category === c.category]);
  if (c.months !== undefined) checks.push(["months", d.contractMonths === c.months]);
  for (const [field, ok] of checks) {
    total += 1;
    if (ok) hit += 1;
    else misses.push(`${field} MISS on "${c.brief.slice(0, 60)}" — got ${JSON.stringify({ budget: d.budget, currency: d.currency, closing: d.closingDate, buyer: d.buyer, category: d.category, months: d.contractMonths })} expected ${JSON.stringify(c)}`);
  }
}

console.log(`field accuracy: ${hit}/${total} = ${total ? Math.round((hit / total) * 1000) / 10 : 0}%`);
for (const m of misses) console.log("  " + m);
