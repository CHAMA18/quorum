# African Context

> **What specific African context influenced your solution?**

---

## Africa-wide stakes

Public procurement is a major route through which African governments deliver goods, works and services. The World Bank reported in 2023 that African nations spend an average of **17% of GDP** on public procurement. In 2015, UNECA separately cited an estimate of **US$148 billion lost annually to corruption across Africa**. That historical figure describes corruption broadly, not procurement losses alone, and is not a measured estimate of Quorum’s potential impact. The scale makes transparent, reviewable decisions important across the continent, while the rules and institutions that govern each award remain country-specific.

## Zambia as the starting point

Quorum’s starting design context is Zambia’s public-health procurement system. ZPPA reported that, at the end of 2023, **203 procuring entities and 71,102 suppliers** were registered on its e-GP system. Its 2023 annual report also records 25 follow-up compliance assessments: 13 entities were non-compliant, 10 fairly compliant and two substantially compliant; none were fully compliant. These were selected follow-up visits, not a representative measure of every Zambian procuring entity.

Zambia’s 2017 FIC report estimated **ZMW 4.5 billion (about US$450 million at the time)** in losses associated with cases it disseminated. Most of that total concerned suspected tax evasion; the corruption category was **approximately US$50 million (ZMW 500 million)** using the report's implied exchange rate. Separately, FIC analysed 624 reports of suspected procurement corruption. The US$450 million total is not procurement-only and was not reported as a recurring annual loss. Case Study IV in its 2022 report records an advance exceeding **ZMW 85 million (approximately US$4.25 million)** in a suspected procurement-corruption case involving a February 2021 contract. This conversion uses the World Bank's 2021 annual-average rate of **ZMW 20.0184866 per US$1**, rather than a transaction-date rate. Case Study V describes **US$32 million paid on a US$215 million contract** where the FIC reported no works performed. These case values and the 2017 estimate must not be added into a new national loss total. The [project description](01-problem-statement.md) provides the full cases, source references and currency method.

The system is being built around Zambia’s Public Procurement Act No. 8 of 2020, the ZPPA e-GP context, ZMW-valued records and the roles of procurement units, evaluation committees and authorised officers. The product prepares and documents review work; the authorised committee remains responsible for the award. The current demo does not claim a live connection to ZPPA e-GP.

## Design choices that follow

- **Evidence before recommendation.** Tender clauses, bidder documents and findings stay linked, so reviewers can inspect the source for each issue.
- **Human authority at the award.** The agent has no path to file or award on its own. A named, authorised human decision remains necessary.
- **Local operating context.** Rules, currencies, approval roles and sample records need to match the jurisdiction where the tool is used. The public KEMSA dataset shown in one evaluation is a Kenya test record, not a Zambian procurement.
- **Careful handling of sensitive data.** Tender files can contain bidder identities, prices and health-supply details. The deployment design keeps raw files under the institution’s control and redacts fields before any approved hosted model call; in-region models remain an option, not a current Zambia deployment claim.

**Sources:** [World Bank — The expanding role of public procurement in Africa’s economic development](https://blogs.worldbank.org/en/governance/expanding-role-public-procurement-africas-economic-development) · [UNECA — Corruption in Public Procurement: The Case of Infrastructure in Africa](https://archive.uneca.org/stories/corruption-public-procurement-case-infrastructure-africa) · [ZPPA 2023 Annual Report](https://www.zppa.org.zm/documents/20182/280039/ZPPA_2023_ANNUAL_REPORT.pdf/b9d3c434-e670-4cf0-bcf3-69a8c2bcf421) · [FIC Money Laundering Trends Report 2017](https://www.fic.gov.zm/component/attachments/download/45) · [FIC Trends Report 2022](https://www.fic.gov.zm/component/attachments/download/131) · [ZPPA OCDS Publication Policy](https://www.zppa.org.zm/ocds-publication-policy)
