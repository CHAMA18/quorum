# Project Description

## From Africa to Zambia: evidence before award

Across Africa, a procurement decision can determine whether a clinic receives medicines, a school gets equipment, or a community waits for an undelivered service. The World Bank reported in 2023 that African nations spend an average of **17% of GDP on public procurement**. Getting the review right is therefore a public-service challenge at national scale. Quorum brings Meta AI into the work that happens before an award: reading the tender, checking the bids, identifying questions and assembling the evidence for a decision that people can explain and defend. [1]

The financial stakes are substantial, but different measures must remain distinct. In 2015, the UN Economic Commission for Africa cited an estimate of **US$148 billion lost annually to corruption across Africa**. This is a historical estimate covering corruption broadly, rather than a current procurement-only loss total. For procurement specifically, a 2022 World Bank article, citing UNODC, reports estimates that **10-25% of a public contract's value may be lost to corruption**. That range is international context; it is not a measured loss rate for every African contract. [2, 3]

Zambia provides the starting point for Quorum. Its public records show both the money at risk and the document failures that an officer needs time and evidence to question:

- **US$450 million in estimated losses across several suspected offences in 2017.** Zambia's Financial Intelligence Centre (FIC) reported this USD equivalent for **ZMW 4.5 billion** associated with cases it disseminated. Most of that total concerned suspected tax evasion; the corruption component was **about US$50 million (ZMW 500 million)** using the report's implied conversion. Separately, the FIC analysed **624 reports of suspected procurement corruption** that year. The US$450 million is a Zambian case-based financial-crime estimate, not an Africa-wide procurement total or a recurring annual estimate. [4]
- **US$32 million paid on a US$215 million contract where the FIC reported no works performed.** Case Study V in the FIC's 2022 report describes an award made in 2017 without required incorporation, tax, financial and technical-capacity documents. Approximately **US$29.7 million** was transferred abroad for construction materials, while tax-authority records showed no imports. The matter was referred to law enforcement in 2022 for suspected offences. These are contract and payment values in a reported case, rather than a court-determined national loss total. [5]
- **An advance exceeding ZMW 85 million (approximately US$4.25 million) in a separate suspected procurement-corruption case.** Case Study IV describes a February 2021 contract worth over **ZMW 343.5 million (approximately US$17.2 million)**, the advance, and a balance of approximately **US$2.35 million (ZMW 47 million)** used for property, cash withdrawals and other transfers. Missing supplier due diligence and a falsified payment bond featured in the case, which was referred for investigation. USD equivalents use the 2021 annual-average rate for scale, not transaction-date valuation. [5, 6]
- **US$2.38 million above the value submitted for procurement clearance, with 386 ambulances undelivered.** The IMF's Zambia governance diagnostic, published in 2023, cites a Ministry of Health direct-bid contract for 1,500 tricycle ambulances. The value discrepancy and delivery failure illustrate the consequences of weaknesses in procurement and contract performance. [7]

These figures describe different years, offences and stages of procurement; they must not be added into a new national loss estimate. Together, they establish a practical need: make missing evidence, inconsistent terms and unresolved questions visible while a committee can still act.

Zambia already has a substantial electronic procurement ecosystem. ZPPA reported **203 procuring entities and 71,102 suppliers registered on e-GP at the end of 2023**. Its 25 selected follow-up compliance assessments found 13 entities non-compliant and none fully compliant. Those selected visits are not a representative national score; they show the value of better documentation and practical support for procurement teams. [8]

## What Quorum does

Quorum is an **AI-assisted procurement review workspace**, initially grounded in Zambia's public-health procurement context and designed around the wider African need for accountable purchasing. It gives procurement officers, suppliers and committee members a connected workflow from document preparation to a reviewable decision record.

For suppliers, the portal brings tender opportunities, document checks and application records into one place. For procurement officers, the review workspace brings the issued requirements and admitted bids together, applies deterministic checks, compares submissions against the published criteria, and flags potential gaps or price anomalies for inspection. Each supported model finding points back to source material, helping an officer move from a claim to the evidence behind it.

For committees, Quorum prepares questions, reading aids and draft redlines. Members can inspect the documents, correct the advice and record their reasons. The product's value is the continuity between a requirement, the bidder's evidence, the reviewer's question and the eventual human decision. A missing document or unusual price is a reason to investigate, not an automatic allegation of fraud.

## How Meta AI makes the workflow possible

**Muse Spark through Meta Model API is the primary reasoning model.** It plans document review, compares admitted bidders against issued criteria, and drafts questions and redlines for officers to examine. The interface displays the returned model identity, source-document count, verified quotation count and request duration so the reviewer can see what produced the advice.

Application checks reject unknown bidders, missing criteria, fabricated quotations and unsupported recommendations before displaying a comparison. Positive or partial assessments require an exact quotation from that bidder's source. Verifying that a quotation exists is a useful evidence check; an officer must still assess whether the interpretation is correct.

**Llama 3.2 supports a configured local fallback through Ollama**, giving institutions an alternative deployment path when local processing is appropriate. **SAM 3.1 provides an optional table-region capability** for document inspection. **Muse Voice Transcribe supports voice input** to the desk assistant. The central demonstration focuses on document reasoning and human approval. These capabilities support the same goal: help people inspect complex procurement material while retaining responsibility for the decision.

## Accountability built into the architecture

Quorum's governing rule is simple: **the agent prepares the file; the authorised committee awards the tender**.

MCP tools connect the agent to controlled document operations, and LangGraph coordinates the review. The graph ends after proposing the human approval gate: **there is no review-graph edge to filing**. A separate server path checks the approver's identity, role, committee authority, quorum and step-up verification before a decision can be recorded. HMAC gateway attestation, replay protection, signed decision receipts and a hash-chained audit log support verification of the resulting record.

Model advice remains separate from official scores and award authority. Hosted processing follows the configured review gateway's redaction policy; the separate bid-comparison action requires explicit consent to share the admitted source documents with Meta. The interface makes that choice visible before the call.

## What the submission proves, and what comes next

The submission includes actual recorded supplier, evaluation and committee workflows, together with a separately captured integration using one fictional Zambian vaccine-refrigerator tender. That integration demonstrates a live Meta response, evidence checks, refusal of unsigned or insufficiently authorised requests, and an authorised approval that produces a verifiable **local simulation receipt**. The dated verification record reports **509 passing tests across 48 files**, a successful production build and the scope of the model evaluation harness. [9]

The next step is a consenting procurement unit reviewing a retrospective, non-sensitive tender in shadow mode. A prepared officer-study protocol will compare manual and assisted review using review time, material issues found or missed, unsupported findings and the quality of the decision record. Independent reviewer annotations and measured field outcomes remain pending. Quorum does not claim a completed Zambian pilot, a live ZPPA e-GP filing connection, or a measured amount of money saved.

The intended public benefit is concrete: more officer time for difficult judgments, clearer evidence for committees, more consistent treatment of suppliers, and procurement records that withstand scrutiny. Starting with Zambia's public-health context, Quorum aims to make accountable review a repeatable part of everyday procurement across Africa.

## Live product and source code

- **Main Quorum domain:** [https://quorum-solutions.com](https://quorum-solutions.com)
- **Supplier portal:** [https://quorum-solutions.com/org](https://quorum-solutions.com/org)
- **Admin console:** [https://quorum-solutions.com/admin](https://quorum-solutions.com/admin)
- **Officer and committee sign-in:** [https://d1n7mv5t5hn4xe.cloudfront.net/#/login](https://d1n7mv5t5hn4xe.cloudfront.net/#/login)
- **Public GitHub repository:** [https://github.com/CHAMA18/the-bid-box-challenge](https://github.com/CHAMA18/the-bid-box-challenge)

Links checked on 4 November 2026. The admin console redirects unauthenticated visitors to sign-in and requires an authorised account.

## Sources and currency method

All monetary amounts are nominal historical values, not inflation-adjusted or converted at today's exchange rate. The 2017 US$450 million equivalent is stated by the FIC; the approximately US$50 million corruption component uses its implied rate of **ZMW 10 per US$1**. For the February 2021 contract case, indicative equivalents use the World Bank's **2021 official annual-average exchange rate of ZMW 20.0184866 per US$1**: divide the kwacha amount by that rate and round for readability. The report does not give transaction dates for every payment. Original USD values in other cases are retained. [4, 6]

- **[1] World Bank, 17 January 2023:** [The expanding role of public procurement in Africa's economic development](https://blogs.worldbank.org/en/governance/expanding-role-public-procurement-africas-economic-development) - average procurement share of GDP.
- **[2] UNECA, 4 March 2015:** [Corruption in Public Procurement: the case of infrastructure in Africa](https://archive.uneca.org/stories/corruption-public-procurement-case-infrastructure-africa) - historical Africa-wide corruption estimate.
- **[3] World Bank, 8 December 2022:** [Corruption in public procurement is a women's rights issue too](https://blogs.worldbank.org/en/governance/corruption-public-procurement-womens-rights-issue-too) - international contract-loss estimate, attributed to UNODC.
- **[4] Zambia FIC, 2017 report, printed pages 8 and 12:** [Money Laundering Trends Report 2017](https://www.fic.gov.zm/component/attachments/download/45) - estimated losses by suspected offence and procurement-corruption reports.
- **[5] Zambia FIC, 2022 report, Case Studies IV and V, printed pages 9-11:** [Trends Report 2022](https://www.fic.gov.zm/component/attachments/download/131) - supplier due diligence, advance payments and non-performance cases.
- **[6] World Bank, indicator PA.NUS.FCRF:** [Zambia official exchange rate, 2021 observation](https://api.worldbank.org/v2/country/ZMB/indicator/PA.NUS.FCRF?date=2021&format=json) - annual-average conversion basis, retrieved 4 November 2026.
- **[7] IMF, Country Report 23/3, January 2023:** [Zambia Diagnostic Report on Governance and Corruption](https://www.imf.org/-/media/files/publications/cr/2023/english/1zmbea2023001.pdf) - tricycle-ambulance contract example.
- **[8] ZPPA, reporting year 2023:** [Annual Report](https://www.zppa.org.zm/documents/20182/280039/ZPPA_2023_ANNUAL_REPORT.pdf/b9d3c434-e670-4cf0-bcf3-69a8c2bcf421) - e-GP registrations and selected follow-up assessments.
- **[9] Quorum, 4 November 2026:** Repository evidence at SUBMISSION/evidence/current-run/verification.json and SUBMISSION/evidence/current-run/README.md - local tests, build and integration scope.
