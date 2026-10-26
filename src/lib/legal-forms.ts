/**
 * Legal forms behind the organization door's dropdown — the prospective
 * families a bidder's legal personality takes across the jurisdictions
 * this portal serves. Grouped so the list reads at a glance; every value
 * is stored (and shown to the desk) exactly as spelled here.
 *
 * "Other (not listed)" is handled by the UI: choosing it reveals a
 * specify field, so no organization is ever forced into a wrong box.
 */

export const LEGAL_FORM_GROUPS: { group: string; options: string[] }[] = [
  {
    group: "Companies",
    options: [
      "Private limited company (Ltd)",
      "Public limited company (PLC)",
      "Limited liability company (LLC)",
      "Corporation",
      "Company limited by guarantee",
      "Unlimited company",
    ],
  },
  {
    group: "Partnerships & ventures",
    options: [
      "General partnership",
      "Limited liability partnership (LLP)",
      "Limited partnership (LP)",
      "Joint venture",
      "Consortium",
    ],
  },
  {
    group: "Sole traders & co-operatives",
    options: ["Sole proprietorship", "Co-operative", "Society or association"],
  },
  {
    group: "Non-profit & public sector",
    options: [
      "Non-governmental organization (NGO)",
      "Not-for-profit organization",
      "Trust",
      "Incorporated trustees",
      "State-owned enterprise",
      "Statutory corporation",
      "Parastatal",
    ],
  },
];

/** Flat option list for dropdowns (grouped order preserved). */
export const LEGAL_FORMS: string[] = LEGAL_FORM_GROUPS.flatMap((g) => g.options);

export const LEGAL_FORM_OTHER = "Other (not listed)";
