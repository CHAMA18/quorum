/**
 * The standard bid-document catalogue.
 *
 * Procurement notices ask for the same evidence over and over: incorporation,
 * tax standing, statutory clearances, integrity declarations, pricing,
 * technical capability and warranty support. The officer ticks the
 * items a notice requires (see the cycle view); the supplier sees the same
 * catalogue on their overview as the documents to keep ready overall.
 *
 * One list, two readers — never fork the wording.
 */

export type RequiredDocumentGroup = {
  label: string;
  documents: readonly string[];
};

export const REQUIRED_DOCUMENT_GROUPS = [
  {
    label: "BUSINESS AND LEGAL ELIGIBILITY",
    documents: [
      "Certificate of incorporation / business registration",
      "Tax compliance / clearance certificate",
      "Tax identification number (TIN / PIN)",
      "Social security / pension clearance certificate",
      "Workers' compensation / employer liability certificate",
      "Valid professional or sector licence",
      "Beneficial ownership declaration",
      "Power of attorney / authorised signatory evidence",
    ],
  },
  {
    label: "INTEGRITY AND BID SECURITY",
    documents: [
      "Bidder eligibility and non-debarment declaration",
      "Conflict of interest declaration",
      "Anti-bribery and integrity declaration",
      "Bid securing declaration",
      "Bid security / tender bond",
    ],
  },
  {
    label: "FINANCIAL AND PRICING",
    documents: [
      "Audited financial statements",
      "Annual turnover evidence",
      "Bank reference / proof of access to credit",
      "Signed bid / tender submission form",
      "Priced bill of quantities / price schedule",
      "Financial proposal and cost breakdown",
      "Cash-flow forecast",
    ],
  },
  {
    label: "TECHNICAL CAPABILITY AND DELIVERY",
    documents: [
      "Technical proposal and compliance schedule",
      "Statement of compliance with specifications",
      "Methodology / work plan",
      "Delivery / implementation schedule",
      "Key personnel CVs and qualifications",
      "Similar contracts / client references",
      "Equipment and resource schedule",
      "Product brochures / technical data sheets",
      "Samples, demonstration or inspection evidence",
      "Manufacturer authorisation / dealership proof",
      "Joint venture / consortium agreement",
    ],
  },
  {
    label: "QUALITY, SAFETY AND REGULATORY",
    documents: [
      "Quality management certificate (e.g. ISO 9001)",
      "Environmental and social management plan",
      "Health and safety plan / certificate",
      "Environmental permit / regulatory approval",
      "Import / export permit for regulated goods",
      "Data protection / information security plan",
      "Product conformity / standards certificate",
    ],
  },
  {
    label: "WARRANTY, SUPPORT AND LOCAL PARTICIPATION",
    documents: [
      "Warranty and after-sales support commitment",
      "Service and maintenance support plan",
      "Local content / citizen participation plan",
      "Subcontractor and key supplier disclosures",
      "Manufacturer warranty / product guarantee",
    ],
  },
] as const satisfies readonly RequiredDocumentGroup[];

/** Every standard document, flattened — the full set a supplier should hold. */
export const ALL_REQUIRED_DOCUMENTS: readonly string[] = REQUIRED_DOCUMENT_GROUPS.flatMap(
  (group) => group.documents,
);

/** Lower-cased lookup used to tell standard documents from tender-specific ones. */
export const STANDARD_REQUIRED_DOCUMENTS = new Set(
  ALL_REQUIRED_DOCUMENTS.map((document) => document.toLocaleLowerCase()),
);
