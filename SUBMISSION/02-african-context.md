# African Context

> **What specific African context influenced your solution?**

---

We designed Quorum around the realities of public procurement in Zambia, using the Ministry of Health's provincial tender pack (ZMW-valued bids, the ZPPA e-GP portal) as the reference system — and the design choices follow from that context specifically:

**The law keeps the award with the committee.** The Public Procurement Act reserves the award decision for a named evaluation committee — fully-autonomous contracting tools judged safe elsewhere are simply not lawful here. So Quorum's agent stops at a human gate: it prepares the file, but the irreversible filing only executes after a *named* approver on the committee roster signs. That is not a UX choice; it is the only architecture that fits.

**Data sovereignty.** Public-health procurement data — bidders, prices, medical-supply specifications — cannot leave the jurisdiction. US-hosted frontier model APIs were never a safe default. The design pushes the whole redline-drafting layer to open-weights models served in-region behind ZAMMSA's own walls. The current build is not yet wired to such an endpoint.

**Scale against thin capacity.** Health procurement here is province-scale and volume-heavy — clinic refurbishment frameworks in Lusaka, essential-medicines frameworks for provincial medical stores, mobile diagnostic units — reviewed by small overwhelmed desks across all ten provinces. Automation that only helps one office at a time was pointless, the prototype reads a local copy of each tender pack (there is no live e-GP integration yet), and findings are raised against deterministic, auditable rules.

**Ownership transparency.** Beneficial-ownership checks (disclosure under the Companies Act, registered with PACRA) matter deeply where collusion risks concentrate, which is why the dashboard supports matching bidders against registries before findings are raised.
