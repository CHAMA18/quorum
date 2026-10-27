# 09 — Fit to the tender cycle: who, where, and how fast

*Companion to `03-solution.md` and `05-agent-architecture.md`. This page exists to be
checked: every claim about the cycle is named, and the timing section separates what
we measured from what we deliberately did not.*

---

## 1. Where Quorum sits in the cycle

Public procurement in Kenya (PPAD Act, 2015) and Rwanda runs: advertisement →
submission receipt → **opening → evaluation (technical, then financial) → award
notification → contract**. The evaluation desk is the segment Quorum targets:
the officer-stage where packs are read line by line, requirements are cross-checked
against each bid, and the award recommendation is written and justified.

That was the founding scope; the tender-cycle build (waves 1–3 — see
*Provenance* in the README) widens
the desk around it without moving the line: the cycle now runs **pipeline →
clarifications/addenda → opening (late-bid enforcement, statutory register) →
COI + scored evaluation matrix + MED → award report → notice of award +
standstill + debriefs → contract pack + register (milestones, variations,
payments, completion) → complaints**, with a consolidated procurement file for
auditors. Quorum still does **not** advertise (notice drafting + a simulated
publish stub), does **not** receive bids (it records the *opening* of bids the
buyer received), and does **not** sign contracts (it prepares the pack and
administers the register). Every irreversible step in the added phases is
behind a named-human gate that declares the office that must sign — the
evaluation desk's guarantee now holds across the whole cycle.

## 2. Named target offices

| Office | Cycle segment | Why this office |
| --- | --- | --- |
| **Ministry of Health — Procurement Department (Kenya)** | Technical + financial evaluation | The sample packs are public-health tenders (pharmaceuticals, scanners, cold chain) built around Kenya's notice format |
| **KEMSA — Kenya Medical Supplies Authority** | Framework & repeat supply tenders | High-volume, compliance-heavy packs where the reading desk is the bottleneck |
| **County health procurement units (47 counties, Kenya)** | Devolved tender evaluation | Under-resourced desks; the strongest backlog case |
| **PPRA — Public Procurement Regulatory Authority (Kenya)** | Oversight & audit | Consumers of the audit trail: append-only tool log, sha-256 receipts, named signatures |
| **RPPA — Rwanda Public Procurement Regulatory Authority** | Evaluation standards & e-GP policy | The Rwandan sample pack (UMUCYO-format currency fields) demonstrates the multi-portal path |

Portals in scope for the (simulated) filing step: Kenya's PPIP e-GP and Rwanda's
UMUCYO — the transmission stub is labelled `egp-portal (simulated)` everywhere it
appears, including in receipts.

## 3. Timing benchmark — what we measured, and what we did not

**Agent time (measured, reproducible):**

- Rule path, per tender pack (all seven staged packs — KE and RW samples — median
  of repeated runs): **0.53–1.14 ms**
  — published per tender with min–max spread in `mini-services/quorum-mcp/data/eval/report.json`
  (regenerated 2026-10-27, findings identical across repeats for every pack).
- Full review graph, template mode (documents read over MCP → plan → extract → flag →
  verify → repair → 2 template drafts → gate raised): **0.15 s wall clock**, measured on
  a live run (`run_055c076c`, 2026-10-27). With a live LLM endpoint configured, drafting
  adds one model call per drafted redline (~4–16 s each on a CPU-only 4 GB box,
  median ~7 s measured across 13 in-window calls); every draft's latency is recorded
  on the run and in the sourced report.

**Human baseline: deliberately not claimed.** We have not run a controlled comparison
against a human desk, and we will not quote a number we did not measure. Published
rules-of-thumb vary too widely to be honest citations. The pilot (below) defines the
measurement protocol instead:

> *Baseline protocol (pilot, pre-registered):* the same published tender pack, given
> to two experienced evaluation officers with a stopwatch and a screen recording,
> instructed to produce a first-pass review at their normal desk pace. Both numbers —
> the officer minutes and the agent milliseconds — are then published side by side in
> this file, with the officers' consent, or the pilot reports that the comparison
> could not be run.

## 3.5 The public evidence base — what is verifiable today

No officer has been contacted yet — that is stated as fact in §3 and §5. What the
buildathon courts *can* check today is a public, sourced context for every claim
about the desk Quorum targets (links live as of 2026-10-27):

| # | Researchable fact | Source |
| --- | --- | --- |
| 1 | The law caps the desk's time: tender evaluation **must complete within 30 days** (PPAD Act 2015, s.80(6)) — and the 2020 Regulations compress national/county specific-tender stages toward **7 days**, so an officer-side bottleneck is a compliance risk, not an inconvenience | [PPAD regulations, National Treasury PDF](https://www.treasury.go.ke/sites/default/files/PPDA/Public-Procurement-and-Asset-Disposal-Regulations-2020.pdf) · [Act text](https://eacc.go.ke/default/wp-content/uploads/2018/06/PPDA.pdf) |
| 2 | The desk is high-volume: Open Contracting's Kenya dataset counts **259,709 tenders** published via Kenya's OCDS feeds | [Open Contracting data registry, Kenya](https://data.open-contracting.org/en/publication/147) |
| 3 | Oversight cannot read everything: PPRA reports reviewing **5,064 of 50,142** published notices (~10%) in one financial year, flagging **2,127** — most packs are never independently re-read, which is the gap a citations-first desk tool addresses | [PPRA coverage reporting](https://capitalfm.africa/ppra-over-half-of-state-contractors-remain-hidden/) |
| 4 | The named target office is real and framework-driven: KEMSA runs multi-year open international tenders for health products (e.g. `KEMSA/OIT04/2024-2026`), procuring via framework contracts for countrywide distribution | [KEMSA 2024–2026 tender doc](https://kemsa.go.ke/download/file/f7d087f56fd0ae0fb8d351eaa60ecb41.pdf) · [World Bank on KEMSA frameworks](https://openknowledge.worldbank.org/bitstreams/68cbe31b-e303-5613-b749-20bb046cd9f5/download) |
| 5 | Rwanda's desk is already electronic: **UMUCYO is the single mandated e-procurement portal**, used by ~**200 procuring entities and 5,000+ bidders**, with electronic evaluation inside the same portal — the multi-portal path Quorum demonstrates is on the national trajectory | [RPPA UMUCYO user survey](https://www.rppa.gov.rw/fileadmin/user_upload/RPPA/LIBRARY/REPORTS/Research_Report/Umucyo_User_Satisfaction_Survey_Final_Report.pdf) · [portal](https://www.umucyo.gov.rw) |

What none of these sources gives the project is somebody who has *done* the job:
a desk officer's timing, habits, or pain — that remains the pilot's measured
protocol (§3 above), deliberately unbuilt until an office engages.

## 4. Pilot-intake channel (live in this build)

The landing page's "Run a pilot tender — unedited, on live notices" checklist posts to
**`POST /api/contact`** (pilot mode): name, work email, organisation, and the pilot
scope. Requests are stored in the workspace's JSON store (`db/quorum-store.json`,
written atomically) and surface alongside the other enquiries — no email provider is
required on either side. The promised response time is one working day.

A pilot pack of live notices is reviewed exactly like the samples: the documents are
dropped into the dossier, mirrored to Firebase Storage when available, and the agent
reads them over the sandboxed filesystem MCP server — nothing about the pilot path is
a second code path.

## 5. Honest boundaries of the fit claim

- The sample packs are realistic but synthetic; no live notice has been reviewed in
  anger yet.
- The e-GP transmission is a stub (labelled as such); sealing and receipts are real.
- The human-baseline number does not exist yet — by design, until the pilot measures
  it under the protocol above.
