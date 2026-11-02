/**
 * quorum-mcp — procurement methods.
 *
 * The award methods the engine understands, grounded in the law of the
 * jurisdictions the platform serves. First up: Zambia's Public Procurement
 * Act No. 8 of 2020, as amended by Act No. 17 of 2023, and the Public
 * Procurement Regulations of 2022, as summarised by the Zambia Public
 * Procurement Authority's published method guidance.
 *
 * Every method states WHEN it is lawful to use it, WHAT the process demands,
 * and WHO authorises the award — because that last line is exactly what the
 * agent must never cross.
 */

export interface ProcurementMethod {
  id: string;
  name: string;
  group: string;
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

const ZG = "Zambia — Public Procurement Act No. 8 of 2020 (as amended by Act No. 17 of 2023) and Public Procurement Regulations, 2022";

export const ZAMBIA_METHODS: ProcurementMethod[] = [
  {
    id: "open-national-bidding",
    name: "Open national bidding",
    group: "Open competition",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Open competition for goods, works and non-consulting services where national bidding is appropriate. Participation is limited to citizen and local bidders under the amended Act.",
    steps: [
      "Invitations to bid are gazetted and advertised in newspapers; the invitation is open to the public.",
      "The bidding document is obtainable upon payment of a non-refundable fee.",
      "Minimum floatation period: four weeks.",
      "Sealed bids are deposited in a tender box.",
      "The public is invited to attend the tender closing and bid opening ceremony.",
      "Evaluation is based on the criteria given in the bidding document.",
      "Publication of the best evaluated bidder before contract award.",
      "A formal contract document is signed.",
      "After commencement, the procuring entity informs all unsuccessful bidders and gives reasons for the decision.",
    ],
    notes: [
      "This is the method everything else is measured against — deviations need a reason the record can defend.",
      "The best-evaluated-bidder publication is a transparency checkpoint before contract award.",
    ],
    awardAuthorisation: "Procurement Committee or Central Tender Committee, depending on the level of authority of the procuring entity.",
    advertising: "Gazetted and advertised in newspapers; open to the public.",
    floatPeriod: "4 weeks",
  },
  {
    id: "open-international-bidding",
    name: "Open international bidding",
    group: "Open competition",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Open competition for goods, works and non-consulting services where the circumstances in section 39 call for international bidding.",
    steps: [
      "Advertise the invitation internationally and make it open to eligible bidders.",
      "Issue the bidding document with the disclosed requirements and evaluation criteria.",
      "Allow the prescribed international floatation period.",
      "Open and evaluate bids publicly against the issued criteria, then record the award approvals.",
    ],
    notes: ["Use international bidding when the Act's circumstances require it; record why national bidding is not appropriate."],
    awardAuthorisation: "The relevant approvals authority under the procuring entity's delegated limits.",
    advertising: "Advertised internationally and open to eligible bidders.",
    floatPeriod: "6 weeks",
  },
  {
    id: "open-national-selection",
    name: "Open national selection",
    group: "Open competition",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Open competition for consulting services using the national route under sections 40 and 41.",
    steps: [
      "Publish an invitation requesting expressions of interest.",
      "Evaluate expressions of interest against the published criteria and form a shortlist.",
      "Invite shortlisted consultants to submit proposals and evaluate them against the disclosed criteria.",
      "Record the evaluation and obtain the required approvals before award.",
    ],
    notes: ["The selection method applies to consulting services; national scope is recorded in the notice."],
    awardAuthorisation: "The relevant approvals authority under the procuring entity's delegated limits.",
    advertising: "Public invitation for expressions of interest in the national route.",
  },
  {
    id: "open-international-selection",
    name: "Open international selection",
    group: "Open competition",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Open competition for consulting services using the international route under sections 40 and 41.",
    steps: [
      "Publish an invitation requesting expressions of interest.",
      "Evaluate expressions of interest against the published criteria and form a shortlist.",
      "Invite shortlisted consultants to submit proposals and evaluate them against the disclosed criteria.",
      "Record the evaluation and obtain the required approvals before award.",
    ],
    notes: ["The selection method applies to consulting services; international scope is recorded in the notice."],
    awardAuthorisation: "The relevant approvals authority under the procuring entity's delegated limits.",
    advertising: "International public invitation for expressions of interest.",
  },
  {
    id: "limited-bidding",
    name: "Limited bidding",
    group: "Limited competition",
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
    id: "limited-selection",
    name: "Limited selection",
    group: "Limited competition",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Consulting services where circumstances do not justify or permit open selection, only a limited number of firms are available, or urgency makes open selection impractical.",
    steps: [
      "Record the statutory grounds for limiting competition and obtain prior approval from the relevant approvals authority.",
      "Invite eligible shortlisted firms to submit proposals using the issued solicitation document.",
      "Evaluate proposals against the published criteria and preserve the evaluation record.",
      "Obtain the required award approval and notify the selected consultant.",
    ],
    notes: ["Limited selection is the consulting-services counterpart to limited bidding and requires prior approvals authority authorisation."],
    awardAuthorisation: "The relevant approvals authority; prior authorisation for use of the method is required.",
    advertising: "Restricted to the shortlisted firms; document the basis for the shortlist.",
  },
  {
    id: "direct-bidding",
    name: "Direct bidding",
    group: "Direct methods",
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
    id: "direct-selection",
    name: "Direct selection",
    group: "Direct methods",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "Consulting services procured from a single consultant where the Act's direct-selection grounds are satisfied, including applicable low-value grounds.",
    steps: [
      "Record the specific statutory ground and why a competitive selection is not appropriate.",
      "Obtain prior approval from the relevant approvals authority unless direct selection is on low-value grounds.",
      "Assess the selected consultant's qualifications and agree the scope and terms as permitted by the Act and Regulations.",
      "Record the approval and award decision in the procurement file.",
    ],
    notes: ["Direct selection is the consulting-services counterpart to direct bidding. The reason and applicable approval must be documented."],
    awardAuthorisation: "The relevant approvals authority; prior method authorisation is excepted where direct selection is on low-value grounds.",
    advertising: "No open advertisement; record the single-source rationale.",
  },
  {
    id: "simplified-bidding",
    name: "Simplified bidding",
    group: "Simplified methods",
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
    id: "simplified-selection",
    name: "Simplified selection",
    group: "Simplified methods",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "A simplified, low-value selection procedure for consulting services where the prescribed conditions and value threshold are met.",
    steps: [
      "Prepare a written request for proposals with the scope, requirements and evaluation criteria.",
      "Invite the required number of eligible consultants under the applicable Regulations.",
      "Evaluate proposals against the disclosed criteria and document the recommendation.",
      "Obtain the required approval and issue the award decision.",
    ],
    notes: ["Use only within the value threshold and conditions prescribed for simplified selection; verify the current threshold before proceeding."],
    awardAuthorisation: "The relevant approvals authority under the applicable threshold and delegated authority.",
    advertising: "No public advertisement where the simplified procedure permits restricted invitations.",
  },
  {
    id: "electronic-reverse-auction",
    name: "Electronic reverse auction",
    group: "Other statutory methods",
    jurisdiction: "ZM",
    legalBasis: ZG,
    when: "A well-defined procurement with quantifiable monetary award criteria and a competitive market of pre-qualified suppliers; an approved e-GP portal and secure auction software are required.",
    steps: [
      "Confirm the specification and award criteria can be expressed in measurable monetary terms.",
      "Confirm sufficient independent qualified bidders and access to the approved secure e-GP auction functionality.",
      "Publish auction rules, timing and criteria, then conduct the live online auction.",
      "Award according to the published ranking and preserve the e-GP record.",
    ],
    notes: ["The Act requires a suitable procurement portal and Authority-approved secure e-procurement software; the auction must preserve effective competition."],
    awardAuthorisation: "The relevant approvals authority under the procuring entity's delegated limits.",
    advertising: "Advertise and conduct through the prescribed e-GP process.",
  },
  {
    id: "force-account",
    name: "Force account",
    group: "Other statutory methods",
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
    group: "Other statutory methods",
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
    group: "Other statutory methods",
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
    id: "government-to-government",
    name: "Government-to-government procurement",
    group: "Other statutory methods",
    jurisdiction: "ZM",
    legalBasis: "Public Procurement Act No. 8 of 2020, section 51A, inserted by Public Procurement (Amendment) Act No. 17 of 2023.",
    when: "Acquire goods, works or services from a foreign State under an agreement between the Republic and that State, benefiting from its expertise or development experience.",
    steps: [
      "Confirm that the procurement is under an agreement between the Republic and a foreign State.",
      "Record the agreement, scope, price basis and approvals in the procurement file.",
      "Conduct and document the procurement in accordance with section 51A and applicable regulations.",
    ],
    notes: ["This route is distinct from purchases between domestic procuring entities; it concerns procurement under an agreement with a foreign State."],
    awardAuthorisation: "The relevant approvals authority and Government authorities under the applicable agreement and law.",
    advertising: "As provided by the State-to-State agreement and applicable law.",
  },
  {
    id: "private-infrastructure",
    name: "Private-financed infrastructure / concessions (PPP)",
    group: "Other statutory methods",
    jurisdiction: "ZM",
    legalBasis: "Zambia — Public Procurement Act No. 8 of 2020, section 52; Public-Private Partnership Act No. 18 of 2023 (which repeals and replaces Act No. 14 of 2009).",
    when: "Use this route when private-sector participation under a public-private partnership model will finance or deliver the construction, rehabilitation or operation of public infrastructure, public goods or services, or a concession.",
    steps: [
      "Confirm that the proposed project falls within the Public-Private Partnership Act No. 18 of 2023 and its scope.",
      "Complete project screening, conceptualisation and a feasibility study under the guidance of the Public-Private Partnership Office.",
      "Submit the feasibility study report and project proposal to the Public-Private Partnership Office for appraisal and the required Technical Committee and Council decisions.",
      "After the project proposal and feasibility study are approved, prepare the request for expression of interest and obtain Public-Private Partnership Office authorisation before advertising or inviting bids.",
      "Run pre-selection, proposal evaluation, approval and award using the applicable procedures in the Public-Private Partnership Act and its regulations.",
    ],
    notes: [
      "The 2023 Act replaced the 2009 Act. Do not apply the repealed Act's workflow to a new project.",
      "For concessions and other long-term partnerships, assess affordability, value for money and the allocation of lifecycle risks alongside price.",
    ],
    awardAuthorisation: "Follow the Act's required project approvals and Public-Private Partnership Office, Technical Committee and Council review at each applicable stage.",
    advertising: "After approval of the feasibility study report and project proposal, submit the request for expression of interest to the Public-Private Partnership Office for authorisation to advertise, invite, solicit or call for bids (section 18).",
  },
  {
    id: "alternative-method",
    name: "Alternative method (ZPPA approval required)",
    group: "Authority-approved alternative",
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
