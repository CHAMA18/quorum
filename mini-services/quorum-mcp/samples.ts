/**
 * quorum-mcp — sample tenders.
 *
 * A fixed, auditable set of comprehensive evaluation packs shipped with the
 * service. Users can pick one in the New Run modal: the reference, title and
 * document list stage themselves, and the review reads the real files —
 * nothing synthetic is injected at run time.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { TENDERS_DIR } from "./engine";

export interface SampleTender {
  ref: string;
  title: string;
  buyer: string;
  sector: string;
  currency: string;
  budget: string;
  bids: number;
  format: string;
  /** What the reviewer (or the agent) should be able to catch. */
  challenges: string;
}

export const SAMPLE_TENDERS: SampleTender[] = [
  {
    ref: "KE-NCB-104293",
    title: "Supply & delivery of MRI scanners (1.5T) with installation — 6 counties",
    buyer: "Ministry of Health · Kenya",
    sector: "HEALTH",
    currency: "KES",
    budget: "KES 412.6M ceiling",
    bids: 2,
    format: "PDF PACK",
    challenges: "Price outlier (2.2×) on the core unit; a cooling-system deviation; one bidder short two REQUIRED documents.",
  },
  {
    ref: "KE-MOH-2026-117",
    title: "Essential medicines tracer list (48 items) to Level 4–6 facilities — 12 counties",
    buyer: "Ministry of Health · Kenya",
    sector: "HEALTH",
    currency: "KES",
    budget: "KES 624.8M ceiling",
    bids: 2,
    format: "PDF PACK",
    challenges: "Bid value 2.3× the peer median; cold-chain price 16.8×; an expired licence declared; a cold-chain deviation; REQUIRED documents missing.",
  },
  {
    ref: "KE-KCS-2026-042",
    title: "Container inspection scanners (drive-through X-ray) — 3 ports",
    buyer: "Kenya Customs Service · National Treasury",
    sector: "SECURITY",
    currency: "KES",
    budget: "KES 1,860M ceiling",
    bids: 2,
    format: "PDF PACK",
    challenges: "Bid value 2.2× the peer median; a radiation-certification deviation; type approval pending at bid close; a REQUIRED reference letter missing.",
  },
  {
    ref: "KE-MSA-2026-090",
    title: "Water-quality laboratory kits and reagents — coast region depots",
    buyer: "Not stated on the notice — the pack's own documented defect",
    sector: "HEALTH",
    currency: "KES",
    budget: "KES 240M ceiling",
    bids: 2,
    format: "PDF PACK",
    challenges: "The notice never names the buyer; one bidder's KRA PIN breaks the national scheme (8 characters).",
  },
  {
    ref: "RW-UMUCYO-2027-006",
    title: "Community health worker digital kits — solar tablets, diagnostics and connectivity (7,500 kits)",
    buyer: "Rwanda Biomedical Centre · Umucyo",
    sector: "DIGITAL HEALTH",
    currency: "RWF",
    budget: "RWF 9,800M ceiling",
    bids: 2,
    format: "PDF PACK",
    challenges: "Tablet price 3.8× the peer median; connectivity 3.1×; a firmware-management deviation (third-party MDM proposed); assembly question.",
  },
  {
    ref: "KE-PHC-2026-311",
    title: "Supply, installation and five-year service of solar vaccine refrigerators for 12 health facilities",
    buyer: "Ministry of Health · Primary Health Care Directorate",
    sector: "HEALTH",
    currency: "KES",
    budget: "KES 15M ceiling",
    bids: 3,
    format: "PDF PACK",
    challenges: "Bid value past the KES 15M ceiling; unit price 2.9× the peer median; two REQUIRED documents missing; an alternative battery chemistry declared; an expired installer licence (documented roadmap gap).",
  },
  {
    ref: "KE-WRA-2026-058",
    title: "Supply and commissioning of solar submersible borehole pumps, lots 1–3",
    buyer: "Water Resources Authority",
    sector: "WATER",
    currency: "KES",
    budget: "KES 8M ceiling",
    bids: 3,
    format: "PDF PACK",
    challenges: "Bid value KES 12.6M against the KES 8M ceiling; unit price 2.9× the peer median; a REQUIRED document not referenced; an alternative impeller material declared.",
  },
  {
    ref: "KE-MOE-2026-205",
    title: "Supply and installation of student desks and physics laboratory kits — 40 secondary schools",
    buyer: "Ministry of Education · State Department for Basic Education",
    sector: "EDUCATION",
    currency: "KES",
    budget: "KES 90M ceiling",
    bids: 3,
    format: "PDF PACK",
    challenges: "A manufacturer authorization listed as pending on one bid; unit prices checked across three bids against the notice's REQUIRED list.",
  },
  {
    ref: "RW-RURA-2027-021",
    title: "Supply of 400 smart water meters, Kigali district network",
    buyer: "Not stated in the OCDS release — the pack's own documented defect",
    sector: "WATER",
    currency: "RWF",
    budget: "RWF 2,400M tender value",
    bids: 3,
    format: "OCDS",
    challenges: "The OCDS release names no buyer; the awarded bid sits far above the peer median and above the tender value; a RURA type-approval letter missing on the winner.",
  },
  {
    ref: "KE-KEMSA-2024-ONT08",
    title: "Supply of health technologies (cotton gauze, cotton wool & tubes) — framework awards",
    buyer: "Kenya Medical Supplies Authority",
    sector: "HEALTH",
    currency: "KES",
    budget: "11 published awards · KES 540,960 – 194,436,000",
    bids: 11,
    format: "OCDS · REAL PUBLIC RECORD",
    challenges:
      "A real PPRA award register: award values span 44.8× the median and the release publishes no line items, quantities or evaluation record. The desk flags the spread and the missing record as committee questions, never as a finding of impropriety.",
  },
];

/** Live statement of what the sidecar can actually run — only covered refs listed. */
export async function listSampleTenders(): Promise<(SampleTender & { files: string[] })[]> {
  const out: (SampleTender & { files: string[] })[] = [];
  for (const s of SAMPLE_TENDERS) {
    try {
      const files = (await readdir(join(TENDERS_DIR, s.ref))).sort();
      out.push({ ...s, files });
    } catch {
      /* not installed in this deployment — omit rather than promise */
    }
  }
  return out;
}

/** One tender document, served read-only for preview. Falls back to null. */
export async function readSampleDocument(
  ref: string,
  file: string,
): Promise<{ name: string; text: string } | null> {
  if (!SAMPLE_TENDERS.some((s) => s.ref === ref)) return null;
  /* path-jail: no separators, both segments must be plain names */
  if (/[\\/]/.test(file) || file.includes("..")) return null;
  const prefix = FILE_PREFIXES.find((p) => file.startsWith(p));
  if (!prefix || !file.endsWith(".md")) return null;
  try {
    const text = await Bun.file(join(TENDERS_DIR, ref, file)).text();
    return { name: file, text };
  } catch {
    return null;
  }
}

const FILE_PREFIXES = ["01-", "02-", "03-", "04-", "05-"];
