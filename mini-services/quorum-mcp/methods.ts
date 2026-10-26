/**
 * quorum-mcp — procurement methods.
 *
 * The award methods the engine understands, grounded in the law of the
 * jurisdictions the platform serves. First up: Zambia's Public Procurement
 * Act No. 8 of 2023 (which repealed and replaced No. 12 of 2008) and the
 * Public-Private Partnership Act No. 14 of 2009, as summarised by the
 * Zambia Public Procurement Authority's published method guidance.
 *
 * Every method states WHEN it is lawful to use it, WHAT the process demands,
 * and WHO authorises the award — because that last line is exactly what the
 * agent must never cross.
 */

export interface ProcurementMethod {
  id: string;
  name: string;
  jurisdiction: "ZM";
  /* The statutory anchor the method rides on. */
  legalBasis: string;
  /* One-question answer: why this method and not another. */
  when: string;
  /* Value band, where the law draws one. */
  valueBand?: string;
  /* The process steps, in order. */
  steps: string[];
  /* What makes it different from the default. */
  notes: string[];
  /* Who authorises award — the human line the agent never crosses. */
  awardAuthorisation: string;
  /* Whether the method must be advertised / gazetted. */
  advertising: string;
  /* Minimum time bidders get, where the law prescribes one. */
  floatPeriod?: string;
}

const ZG = "Zambia — Public Procurement Act No. 8 of 2023";

export const ZAMBIA_METHODS: ProcurementMethod[] = [
  {
    id: "open-bidding",
    name: "Open bidding / selection",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "The default method — preferred for all procurement unless another method is justified. High-value procurements (above K1 million).",
    valueBand: "Above K1 million",
    steps: [
      "Invitations to bid are gazetted and advertised in newspapers; the invitation is open to the public.",
      "The bidding document is obtainable upon payment of a non-refundable fee.",
      "Minimum floatation period: four weeks for national tenders, six weeks for international tenders.",
      "Sealed bids are deposited in a tender box.",
      "The public is invited to attend the tender closing and bid opening ceremony.",
      "Evaluation is based on the criteria given in the bidding document.",
      "Publication of the best evaluated bidder before contract award.",
      "A formal contract document is signed.",
      "After commencement, the procuring entity informs all unsuccessful bidders and gives reasons for the decision.",
    ],
    notes: [
      "This is the method everything else is measured against — deviations need a reason the record can defend.",
      "The best-evaluated-bidder publication is a transparency checkpoint, not paperwork: it is the last moment the public can object before money moves.",
    ],
    awardAuthorisation: "Procurement Committee or Central Tender Committee, depending on the level of authority of the procuring entity.",
    advertising: "Gazetted and advertised in newspapers; open to the public.",
    floatPeriod: "4 weeks national · 6 weeks international",
  },
  {
    id: "limited-bidding",
    name: "Limited bidding / selection",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Where circumstances do not justify open bidding, the goods/works/services are available from only a limited number of suppliers or firms, or there is an urgent need that makes open bidding impractical.",
    steps: [
      "The invitation is NOT gazetted or advertised — restricted to nominated firms only.",
      "A solicitation/bidding document is prepared and obtainable upon payment of a non-refundable fee.",
      "Minimum floatation period: four weeks for national tenders, six weeks for international tenders.",
      "Sealed bids are deposited in a tender box.",
      "The public are free to attend the tender closing and bid opening ceremony.",
      "Evaluation is based on the criteria given in the tender document.",
      "A formal contract document is signed.",
    ],
    notes: [
      "Justification for restricting the invitation must live in the procurement record — 'urgency' without a stated cause is the classic red flag the agent is built to catch.",
      "Openness of the bid opening ceremony is retained even here: restriction narrows who may bid, not who may watch.",
    ],
    awardAuthorisation: "Procurement Committee or Central Tender Committee, depending on the level of authority of the procuring entity.",
    advertising: "Not gazetted or advertised; nominated firms only.",
    floatPeriod: "4 weeks national · 6 weeks international",
  },
  {
    id: "direct-bidding",
    name: "Direct bidding",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Where goods/works/services are available only from a single source with no reasonable alternative; emergency; additional procurement from the same source for compatibility, standardisation or continuity; extension of an existing contract with no advantage from further competition; or value below the threshold prescribed in the Public Procurement Regulations.",
    steps: [
      "The invitation is NOT gazetted or advertised — restricted to the nominated firm only.",
      "The solicitation/bidding document is prepared and obtainable upon payment of a non-refundable fee.",
      "Minimum floatation period: four weeks for national tenders, six weeks for international tenders.",
      "Sealed bid is deposited in a tender box.",
      "The public are free to attend the tender closing and bid opening ceremony.",
      "Evaluation is based on the criteria given in the solicitation/bidding document.",
      "A formal contract document is signed.",
    ],
    notes: [
      "Single-source awards are where procurement abuse concentrates. The agent raises DOC-MISSING and SUPPLIER-ID findings against exactly this veil.",
      "Every single-source choice must trace to one of the five statutory grounds — the record must name which.",
    ],
    awardAuthorisation: "Procurement Committee or Central Tender Committee, depending on the level of authority of the procuring entity.",
    advertising: "Not gazetted or advertised; one nominated firm only.",
    floatPeriod: "4 weeks national · 6 weeks international",
  },
  {
    id: "simplified-bidding",
    name: "Simplified bidding / selection",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Low-value, off-the-shelf purchases — up to K1 million.",
    valueBand: "Up to K1 million",
    steps: [
      "At least three (3) competitive quotations are obtained by use of a written Request for Quotations document.",
      "The Request for Quotations gives clear instructions on conduct of the process, including preparation and submission of quotations and information on evaluation and award.",
      "Suppliers submit quotations supported by a certificate of registration, ZRA Tax Clearance Certificate and relevant certifications (e.g. National Council for Construction registration).",
      "There is no need to advertise or gazette.",
      "Evaluation is based on the request for quotations that was issued.",
      "The purchase is confirmed by the Local Purchase Order.",
    ],
    notes: [
      "Three quotations is the number the law names — fewer than three is itself a finding.",
      "The ZRA Tax Clearance Certificate is the health check of every Zambian supplier: a bid without a valid one is non-responsive.",
    ],
    awardAuthorisation: "Confirmed by Local Purchase Order under the procuring entity's delegated authority.",
    advertising: "No advertisement or gazette required.",
  },
  {
    id: "force-account",
    name: "Force account",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "The procuring entity builds using its own personnel and equipment — where quantities cannot be defined in advance; works are small, scattered or remote and firms are unlikely to bid at reasonable prices; work must proceed without disrupting ongoing operations; risks of work interruption are better borne by the entity; or an emergency needs prompt attention.",
    steps: [
      "The procuring entity's own personnel and equipment carry out the works.",
      "Costs are booked against the entity's own accounts rather than awarded to a bidder.",
    ],
    notes: [
      "No bidder exists — but the audit trail still must: labour, materials and equipment hours belong on the record like any other award.",
    ],
    awardAuthorisation: "The procuring entity's own accounting officer, under the entity's delegated authority.",
    advertising: "Not applicable — no market solicitation.",
  },
  {
    id: "community-participation",
    name: "Community participation",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Where, in the interest of project sustainability or specific project objectives, selected project components should involve local communities and NGOs, local know-how and materials, or labour-intensive and appropriate technologies.",
    steps: [
      "Local communities and non-governmental organisations are called to participate in selected project components.",
      "Local know-how and materials are utilised to increase sustainability.",
      "Labour-intensive and other appropriate technologies are employed.",
    ],
    notes: [
      "The 'market' here is a community, not a registry of firms — evaluation must adapt without losing the evidence trail.",
    ],
    awardAuthorisation: "The procuring entity, with the community structures engaged for the project.",
    advertising: "Community-level mobilisation rather than public advertisement.",
  },
  {
    id: "inter-entity-purchase",
    name: "Purchases from other procuring entities",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "The procuring entity may purchase directly from another Government agency where there would be no benefit in purchasing from a supplier and the agency can meet all requirements specified in the statement of requirement.",
    steps: [
      "Confirm there would be no benefit in purchasing from a supplier.",
      "Confirm the Government agency can meet all requirements in the statement of requirement.",
      "Purchase directly without applying any other procurement method.",
    ],
    notes: [
      "Both legs must hold: no supplier benefit AND full capability. One without the other sends you back to open bidding.",
    ],
    awardAuthorisation: "The procuring entity, under inter-agency arrangements.",
    advertising: "Not applicable.",
  },
  {
    id: "private-infrastructure",
    name: "Procurement of infrastructure for private financing / concessions",
    jurisdiction: "ZM",
    legalBasis: "Zambia — Public-Private Partnership Act No. 14 of 2009",
    when: "Use of the private sector to carry out projects such as construction, rehabilitation or operation of public infrastructure and other public goods on the basis of private investment.",
    steps: [
      "The project is structured under the Public-Private Partnership Act No. 14 of 2009.",
      "The legal framework for privately financed infrastructure governs implementation.",
    ],
    notes: [
      "Concessions shift risk to the private party — the evaluation question becomes who carries lifecycle cost, not just who quotes least.",
    ],
    awardAuthorisation: "Governed by the PPP Act's institutional framework.",
    advertising: "Per the PPP Act's own process.",
  },
  {
    id: "alternative-method",
    name: "Alternative procurement methods",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "A procuring entity wishing to use a method other than the ones listed must apply to the Zambia Public Procurement Authority.",
    steps: [
      "The procuring entity applies to the Zambia Public Procurement Authority for authority to use an alternative method.",
      "Use of the method proceeds only with the Authority's approval.",
    ],
    notes: [
      "The default list is closed: anything outside it needs a regulator's signature before, not after.",
      "For the agent, an unapproved method flag is a STOP — the review still runs, but the gate must name the missing approval.",
    ],
    awardAuthorisation: "The Zambia Public Procurement Authority (prior approval required).",
    advertising: "As approved by the Authority.",
  },
];

export const METHODS_BY_JURISDICTION: Record<string, ProcurementMethod[]> = {
  ZM: ZAMBIA_METHODS,
};
