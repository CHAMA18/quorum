# Quorum — Procurement Production-Readiness Plan

**Status:** 2026-10-30 · Plan v1.0
**Owner:** Product lead (accountable), with procurement counsel as legal reviewer
**Horizon:** 12 working weeks, 2 Nov 2026 → 5 Feb 2027 (plus a two-week holiday buffer, 21 Dec → 1 Jan)
**Source audit:** the 21-gap procurement officer review of 2026-10-30
**Thesis:** Quorum already proves *who decided*. This plan makes it prove *the decision was lawful, competitive and financially controlled* — without weakening the gate, receipt or audit spine that already works.

---

## 1. Decision this plan asks for

Approve a **12-week, four-gate programme** that closes all P0 gaps before any real tender, all P1 gaps before a pilot, and the P2 hardening before a production claim. No live tender runs until **Gate C**; no contract is signed on a simulated publication at any point.

The plan deliberately does **not** add product breadth. Every workstream below closes a named gap from the audit. Anything not traceable to a gap is deferred (§15).

---

## 2. Success definition

| Gate | Name | What it proves | When |
|---|---|---|---|
| **A** | Truth | The product no longer presents simulated state as real; every new control is behind a flag and testable | End W1 — 6 Nov 2026 |
| **B** | P0 closed | A real tender cannot leak bids, award over an open HIGH finding, bypass office authority, miscompute a statutory clock, or pay above contract | End W6 — 11 Dec 2026 |
| **C** | Pilot-ready | One jurisdiction, verified suppliers, independent scoring, linked sittings and minutes, one audit spine | End W10 — 22 Jan 2027 |
| **D** | Production-ready | Residency policy, penetration test, DR drill, counsel sign-off, live connector or enforced record-only mode | End W12 — 5 Feb 2027 |

**Definition of done for every item:** code + migration + server-side permission + UI state + unit test + integration test + audit event + documentation + acceptance evidence. A control without a failing test that it catches is not done.

---

## 3. Assumptions and constraints

- **Team:** 3 full-stack engineers, 0.5 designer, 0.25 DevOps, procurement counsel on call (≈2 days/week), one pilot procurement officer for UAT.
- **If solo:** run Phase 0 + WS1 + WS2 + WS3 + WS4 only (≈8–10 weeks), keep `RECORD_ONLY` mode, and publish the remaining workstreams as roadmap. Do not compress by skipping acceptance tests.
- **Legal:** the standstill period, complaint period, variance threshold, method thresholds and retention rules are **jurisdiction configuration**, not universal constants. Counsel signs the pack for each jurisdiction before Gate C.
- **Architecture:** keep the sidecar as the decision and audit authority; keep the web app as the desk; keep the JSON store for local/demo behind a repository boundary until the Postgres work is scheduled post-Gate D.
- **Data:** no live supplier data in non-production. Pilot data is minimised, encrypted at rest, and covered by a data-processing agreement.
- **Change control:** after Gate A, scope is frozen. New requests go to a parking lot and are reviewed at the next gate.

---

## 4. Non-negotiable principles

1. **No simulated state in a legal path.** A simulated portal record may rehearse, never authorise a contract or payment.
2. **Fail closed.** A missing key, missing clock, missing disposition, missing sheet, missing signature or unreadable register blocks the act; it never defaults to "allow".
3. **One record, one chain.** Every mutation that can affect a procurement outcome lands in one verifiable audit spine, whether it originated in the web app or the sidecar.
4. **Jurisdiction is configuration.** Holidays, timezone, thresholds and statutory periods live in a signed, versioned pack.
5. **The model never decides.** Models draft and suggest; deterministic rules and named humans decide.
6. **No silent relabelling of legacy data.** Legacy bids, contracts and minutes are marked `LEGACY_*` with their exact limitations.
7. **Every control has a test that makes it fail.** A control is accepted only when a test proves the refusal or the block.

---

## 5. Target architecture — what changes

```
Supplier portal ──► Bid Vault (sealed envelope, receipt, withdraw/amend)
                         │
                         ▼
Desk ──► Opening reconciliation ──► Evaluation workspace ──► Award
              │                        │                      │
              │                        ├── per-evaluator     ├── disposition ledger
              │                        ├── COI register      ├── complaint suspension
              │                        └── FX + evaluated price
              ▼                                               ▼
      Statutory clock service ◄── Jurisdiction pack     Contract & finance ledger
              │                                          (budget, bonds, payments,
              ▼                                           variations, retention)
      Gate authority (actor ID + office + quorum + dual approval + step-up)
              │
              ▼
      Unified audit spine (sidecar chain + forwarded web events) ──► Oversight export
```

New cross-cutting services:

| Service | Responsibility | New file(s) |
|---|---|---|
| Bid vault | Seal, receipt, withdraw, amend, reveal | `mini-services/quorum-mcp/bid-vault.ts` |
| Jurisdiction clock | Holidays, timezone, working-day arithmetic | `mini-services/quorum-mcp/jurisdiction.ts` |
| Gate authority | Actor-bound office checks, dual approval, threshold | `mini-services/quorum-mcp/gate-authority.ts` |
| Disposition ledger | Finding clearance and waiver | `mini-services/quorum-mcp/dispositions.ts` |
| Finance ledger | Budget commitment, payment caps, retention, FX | `mini-services/quorum-mcp/finance.ts` |
| Supplier assurance | Registry/tax/BO/sanctions verification | `mini-services/quorum-mcp/supplier-assurance.ts` |
| Evaluation integrity | Per-evaluator sheets, consensus, FX scoring | `mini-services/quorum-mcp/evaluation.ts` |
| Sitting service | Notice, attendance, quorum, minutes link | `src/lib/sittings.ts`, `src/app/api/sittings/**` |
| Unified audit | Forward web events to the chain, verify both | `src/lib/audit-spine.ts` |
| Model gateway | Residency policy, redaction, call provenance | `src/lib/model-gateway.ts` |

---

## 6. Workstreams

### Summary

| WS | Workstream | Gaps closed | Effort | Phase |
|---|---|---|---|---|
| WS0 | Truth, flags and guardrails | G-03 (label/mode), P2-01, P2-05 | 8 ed | 0 |
| WS1 | Bid confidentiality and lifecycle | G-01, G-08, G-18 | 20 ed | 1 |
| WS2 | Statutory time and addenda | G-05, G-09 | 10 ed | 1 |
| WS3 | Gate authority and four eyes | G-04, G-07 | 8 ed | 1 |
| WS4 | Award legality | G-02, G-10 | 12 ed | 1 |
| WS5 | Contract and finance controls | G-06, G-19, G-20 | 22 ed | 1 |
| WS6 | Supplier assurance and method control | G-14, G-15 | 14 ed | 2 |
| WS7 | Evaluation integrity | G-11, G-12, G-13 | 18 ed | 2 |
| WS8 | Sittings, quorum and minutes | G-16, G-17, P2-03 | 16 ed | 2 |
| WS9 | Unified audit and reporting | P2-02, P2-05 | 10 ed | 2 |
| WS10 | Residency and model governance | G-21 | 8 ed | 3 |
| WS11 | Documentation, training and calibration | P2-01, P2-04 | 6 ed | 3 |

**Total:** 152 engineer-days. With 20% contingency: **182 ed**. At 3 engineers that is ≈61 working days, fitting the 12-week window with the holiday buffer. Design, counsel and UAT are additional part-time effort.

---

### WS0 — Truth, flags and guardrails

**Outcome:** the product cannot overstate what it is, and every subsequent control ships dark behind a flag.

**Build**
1. Add `deploymentMode: "RECORD_ONLY" | "CONNECTED"` and `externalPublicationMode` to workspace settings. In `RECORD_ONLY`, `sign_contract_pack`, `certify_payment` and any external filing are refused server-side; the UI shows a persistent banner and every export carries a watermark.
2. Replace the hard-coded `egp-portal (simulated)` string with an `ExternalPublication` record: `{ mode, portal, receiptId?, publishedAt?, verifiedAt?, evidenceHash? }`. A contract precondition requires `mode === "CONNECTED"` and a verified receipt.
3. Add a feature-flag registry in `store.ts` and `src/lib/db.ts` (`features: Record<string, boolean>`), default **off** for new workflows and **on** for new refusals. Each WS flips its flag only after acceptance.
4. Define a versioned audit event schema: `{ v, type, actorId, workspaceId, targetType, targetId, before, after, reason, at }`. All new writes call one helper.
5. Generate rule descriptions in `src/components/quorum/documentation.tsx` from a single `RULE_CATALOG` plus live guard values; remove hard-coded "two times" prose. Fix P2-01 permanently.
6. Make the calendar counters state what they count: statutory clocks only, with meeting/sitting/gate waits shown separately. Remove the implication that "0 clocks" means nothing is pending.

**Acceptance**
- A record-only workspace cannot sign a contract or certify a payment (403 with reason).
- Exported procurement files say `RECORD-ONLY — NOT A PUBLICATION RECEIPT`.
- Every rule page shows the live threshold it actually applies.
- Calendar counters reconcile to the list below them.

**Effort:** 8 ed. **Depends on:** none.

---

### WS1 — Bid confidentiality and lifecycle

**Outcome:** no one can see a price before the certified opening, and every bid has a verifiable receipt and a lawful way to be withdrawn or amended.

**Build**
1. **Bid envelope.** Add `BidEnvelope`:
   ```ts
   {
     id, tenderId, orgId, version,
     ciphertext, iv, authTag, wrappedKey,
     commitment,            // sha-256 of plaintext payload
     status: "RECEIVED" | "WITHDRAWN" | "AMENDED" | "OPENED" | "DISQUALIFIED",
     receivedAt, receiptId, receiptSignature,
     supersedesId?, amendedById?
   }
   ```
   Encrypt `{ amount, currency, lineItems, documents, coverNote }` with AES-256-GCM. A per-bid data key is wrapped by a master key from KMS/env; the master key never enters the process memory longer than needed.
2. **Receipt.** On receipt, return `{ receiptId, commitment, receivedAt, signature }`; the supplier can verify it independently. The desk sees metadata only.
3. **Sealed reads.** `GET /api/applications` returns `amount: null` and no payload until the envelope is `OPENED`. The sidecar's open read is replaced with a capability-checked read (`manage_suppliers` or the owning org session).
4. **Withdraw and amend.** `POST /api/applications/:id/withdraw` before closing; `POST /api/applications/:id/amend` creates a new sealed version and marks the old `AMENDED`. Both write receipts and audit lines. One active envelope per org/tender.
5. **Opening reconciliation.** `record_bid_opening` derives rows from all `RECEIVED` envelopes for the tender, decrypts at the opening gate, and produces a reconciliation object: `{ received, admitted, withdrawn, late, missingFromPack, extraInPack }`. A manual row requires a signed reason.
6. **Witnesses.** The opening gate requires the certifying procurement officer plus two named witnesses (IDs), recorded in the register and minutes. The register hash covers envelopes, witnesses and timestamps.
7. **Legacy.** Existing applications without envelopes are marked `LEGACY_UNSEALED`, cannot be silently presented as sealed, and are excluded from a new opening until explicitly migrated with a recorded reason.
8. **UI.** Supplier: receipt, withdraw, amend. Desk: "Bid vault" with sealed count, integrity status, opening reconciliation diff, and a reveal screen that shows prices only after the gate is signed.

**Tests**
- No API response contains an amount before reveal.
- Wrong key, tampered ciphertext or mismatched commitment fails closed.
- Withdraw before closing succeeds; after closing is refused.
- Amendment supersedes and both versions remain auditable.
- A missing portal receipt appears in `missingFromPack`; certification blocks until dispositioned.
- Opening register hash changes if any row, witness or timestamp is altered.

**Acceptance**
- A red-team script cannot recover a price from the API or the store before opening.
- Two officers open a register; every received bid is accounted for; the reconciliation is in the procurement file.

**Effort:** 20 ed. **Depends on:** WS0.

---

### WS2 — Statutory time and addenda

**Outcome:** every statutory clock is computed in the jurisdiction's calendar and timezone, and an addendum inside the notice window cannot quietly shorten fair notice.

**Build**
1. Add `JurisdictionPack`:
   ```ts
   {
     id, name, timezone, weekend: number[],
     holidays: { date: string; name: string }[],
     standstillWorkingDays, complaintWorkingDays,
     addendumMinNoticeDays, bidSecurityValidityMarginDays,
     methodThresholds: { methodId, min, max, currency }[],
     version, effectiveFrom, signedBy
   }
   ```
   Seed Kenya, Zambia, Rwanda, Tanzania, Uganda and a generic pack. Counsel signs each.
2. Replace `addWorkingDays` and `workingDaysBetween` with pack-aware functions; keep pure signatures for tests. `addWorkingDays(iso, days, pack)`.
3. Store `closingAt` as an ISO instant plus `closingTimezone` and `closingBasis` (`NOTICE` | `OFFICER` | `ADDENDUM`). Date-only notices resolve to 23:59:59 **local**, not UTC. `isLate` compares instants only.
4. Compute standstill, complaint, ALB and bid-security clocks with the pack; persist `clockBasis: { packId, packVersion }` so a later pack change cannot rewrite history.
5. **Addendum control.** `issue_addendum` refuses when `daysLeft < addendumMinNoticeDays` and no extension is supplied. If an extension is supplied, it moves `closingAt`, records the basis, and publishes to every registered bidder. Bidders must acknowledge before their bid is admitted; the acknowledgment is an audit event.
6. Add a "time" test matrix across EAT, CAT, WAT and UTC, including a holiday inside a standstill and a closing at local midnight.
7. Add a jurisdiction selector in workspace settings; changing it requires admin + reason and does not retroactively change existing clocks.

**Tests**
- 23:59 EAT closing rejects 00:01 EAT; accepts 23:58 EAT.
- A public holiday inside the standstill moves expiry by one working day.
- A date-only notice uses local end-of-day, not 23:59Z.
- An addendum inside the window without an extension is refused.
- An extension moves closing and requires bidder acknowledgment.
- Changing the pack does not change an existing clock's basis.

**Acceptance**
- Counsel signs the pack; the test matrix passes in CI; every deadline in the UI names its timezone and basis.

**Effort:** 10 ed. **Depends on:** WS0.

---

### WS3 — Gate authority and four eyes

**Outcome:** an office gate is bound to a real person with that office, and high-value gates need two different officers.

**Build**
1. Add `User.office` and `CommitteeMember.userId`. Gate decisions identify the actor by `userId`, not a typed name. The display name remains, but authority comes from the ID.
2. Replace the `signedInAs === approver` bypass. A user may sign an office gate only if their assigned office matches. The "gavel" is a user holding `ACCOUNTING_OFFICER`; it is not a universal override. An explicit emergency override, if counsel requires one, is a separate signed act with reason, second approval and audit.
3. Add `dualApprovalThreshold` to the Rules & Safeguards UI, with a currency and amount. Default: **on** for award, contract and payment gates at or above the configured value. Store the threshold in workspace settings, validate on the server.
4. Show the first approver, timestamp and note on `AWAITING_SECOND`; notify the second approver; prevent the first approver from completing; allow an admin to withdraw with a reason.
5. Add a gate-authority preflight that returns a precise refusal: missing office, wrong office, gavel not accounting officer, second approver required, first approver conflict, quorum short.
6. Extend the authority matrix to all statutory gates; no gate silently falls back to "any signer".

**Tests**
- A user without the required office gets 403, even if their typed name matches the approver.
- A gavel without `ACCOUNTING_OFFICER` gets 403.
- Above threshold: first approval sets `AWAITING_SECOND`; same user second attempt 403; different officer completes.
- Below threshold: one approval executes.
- Withdrawing an awaiting gate requires admin + reason.
- Every refusal is an audit line.

**Acceptance**
- A red-team script cannot execute an office gate as an unauthorised user by changing the typed name or the request body.
- The settings UI persists the threshold; a restart preserves it.

**Effort:** 8 ed. **Depends on:** WS0.

---

### WS4 — Award legality

**Outcome:** no award is signed over an undispositioned HIGH finding, and no contract is signed while a complaint is open.

**Build**
1. Add a disposition to every finding:
   ```ts
   disposition?: {
     status: "CLEARED" | "WAIVED" | "RE_CHECK";
     by, byId, at, note, evidenceIds?, gateId?
   }
   ```
   `OPEN` is the absence of a disposition. A waiver above the dual-approval threshold requires the accounting officer and a second approver.
2. `dispose_finding` route and UI drawer: finding, citation, decision, reason, evidence, signature. HIGH findings cannot be cleared with an empty reason.
3. `preApprovalCheck("sign_award_report")` blocks when any HIGH finding on the recommended bid is undispositioned, and returns the exact finding IDs. `publish_award_notice` inherits the check. `sign_contract_pack` re-runs it.
4. **Award revalidation.** Before signing, re-check: bidder still active, not suspended/blacklisted/debarred, bid security still valid, price still within budget, responsiveness unchanged. Any change requires a fresh disposition.
5. **Complaint suspension.** `sign_contract_pack` and `certify_payment` block while any complaint is `OPEN` or `ESCALATED`. Add `complaint.status: OPEN | ANSWERED | ESCALATED | CLOSED`, an independent-review field, an acknowledgment to the complainant, and an escalation clock. A resolved complaint records the outcome and the reviewer.
6. Award report and procurement file include a disposition table (finding, severity, status, by, reason) and a complaint status table.
7. UI: the award screen lists blocking findings with links; the contract screen lists blocking complaints; neither can be dismissed.

**Tests**
- One open HIGH finding blocks award and names the finding.
- Clearing with an empty reason is refused.
- A waiver by an unauthorised role is refused.
- A complaint opened after notice blocks contract; answering it unblocks.
- Revalidation catches a supplier suspended between evaluation and award.
- The award report contains the disposition table.

**Acceptance**
- A scripted attempt to award with an open `R-OVER-BUDGET` fails with 403 and the finding ID.
- A contract is impossible while a complaint is open, even after standstill expiry.

**Effort:** 12 ed. **Depends on:** WS0, WS3.

---

### WS5 — Contract and finance controls

**Outcome:** the contract is an executed instrument with conditions, and no payment or variation can exceed the authorised value.

**Build**
1. **Budget commitment.** Add `BudgetLine` and `Commitment`:
   ```ts
   BudgetLine { id, workspaceId, fiscalYear, code, currency, approved, committed, spent }
   Commitment { id, tenderId, budgetLineId, amount, currency, createdAt, releasedAt? }
   ```
   Award creates a commitment; if `committed + award > approved`, the gate blocks unless the accounting officer signs a budget override with a reason and a second approval. Payments draw down `spent`; completion releases the remainder.
2. **Contract instrument.** Extend `ContractFile`:
   `executedAt`, `supplierAcceptedAt`, `supplierSignatory`, `performanceSecurity { amount, issuer, validUntil, documentId }`, `insurance`, `subcontractors[]`, `retentionPct`, `warrantyDays`, `conditions[]`.
   `sign_contract_pack` creates a `DRAFT` contract; a separate `execute_contract` gate requires supplier acceptance, performance security and insurance. A contract without execution cannot receive payments.
3. **Supplier execution.** Add a supplier-portal acceptance step: review the pack, accept, upload the signed copy. The acceptance is a signed receipt bound to the contract hash.
4. **Variations.** Add `cumulativePct`; `request_variation` computes it. Above the configured threshold, the variation needs the gate. Approval updates `contract.value`, `cumulativePct` and any time extension. A cumulative cap is enforced; an override requires accounting officer + second approval.
5. **Payments.** Extend `Payment`:
   `invoiceId`, `milestoneId`, `gross`, `retention`, `withholding`, `net`, `currency`, `fxRate`, `status`.
   `certify_payment` checks: contract executed, milestone accepted, invoice present, cumulative net ≤ contract value − retention, no open complaint, no suspension. A payment above the cap is refused, not clamped.
6. **Three-way match.** Invoice + milestone acceptance + goods/services receipt must match before certification; exceptions route to the accounting officer with a reason.
7. **Completion.** `record_contract_completion` requires a completion certificate, defects-liability end date, and a supplier performance rating. Completion triggers a debarment/performance review task.
8. **UI.** Contract register with conditions, bonds, insurance, subcontractors; payment register with running totals and retention; variation register with cumulative percentage; budget bar.

**Tests**
- Payment above contract value is refused; cumulative payments above net value are refused.
- Payment without an accepted milestone or invoice is refused.
- Retention and withholding arithmetic is exact at currency precision.
- Cumulative variation above the cap is refused; approval updates contract value.
- A contract without supplier acceptance cannot receive payment.
- A budget overcommit is refused or requires a signed override.
- Completion without a certificate is refused.

**Acceptance**
- A scripted overpayment, over-variation and overcommit all fail closed with a named reason.
- The procurement file shows contract value, variations, payments, retention and remaining balance reconciling to the ledger.

**Effort:** 22 ed. **Depends on:** WS3, WS4.

---

### WS6 — Supplier assurance and method control

**Outcome:** a supplier is verified before it can win, and a non-open method needs a signed justification.

**Build**
1. Add `SupplierVerification`:
   `registryStatus`, `taxStatus`, `beneficialOwners[]`, `sanctions`, `pep`, `documents[]`, `checkedAt`, `expiresAt`, `source`, `notes`.
2. `verify_supplier` route/tool: registry lookup (manual attestation is allowed but labelled), tax ID check, BO collection, sanctions/PEP screening, document upload. A failed or expired verification blocks award and contract.
3. Re-check at application, award and contract. A supplier suspended after application is caught at the award revalidation and at contract execution.
4. Suspension must block org login and new applications; add an appeal workflow with a reason and a reviewer.
5. Add `TenderCycle.methodId` from `methods.ts`, plus `methodJustification`, `methodApprovedBy`, `methodApprovedAt`. Non-open methods require a justification and a gate; direct/limited above the jurisdiction threshold requires the authority approval record.
6. Award report validates that the method is lawful for the value and that the justification is present.
7. UI: supplier assurance panel (status, expiry, documents, screening results); method selector with the legal test and a justification editor; a blocked-award state that names the missing verification.

**Tests**
- An unverified supplier cannot be recommended for award.
- An expired verification blocks contract.
- A suspended supplier is blocked at login, application, award and contract.
- A direct method without justification is refused.
- A method above its threshold without authority approval is refused.
- A method below threshold with justification passes.

**Acceptance**
- A pilot supplier completes verification; the file shows the check, source and expiry.
- A direct-award attempt without justification fails with a specific error.

**Effort:** 14 ed. **Depends on:** WS4, WS5.

---

### WS7 — Evaluation integrity

**Outcome:** scoring is independent, conflicts are structured, and prices are compared in one currency.

**Build**
1. **COI register.** Add `ConflictDeclaration`:
   `memberId`, `tenderId`, `interestType` (`DIRECTORSHIP | SHAREHOLDING | EMPLOYMENT | FAMILY | FORMER_EMPLOYER | OTHER`), `entity`, `relationship`, `value`, `declaredAt`, `evidence`, `recused`.
   Annual declarations plus per-tender declarations. Screen bidder directors/owners against declarations. A conflicted evaluator cannot submit a score sheet or sign the certification.
2. **Per-evaluator scoring.** Add `EvalScoreSheet` per evaluator and `EvalConsensus`:
   ```ts
   EvalScoreSheet { id, matrixId, evaluatorId, scores[], submittedAt, signature }
   EvalConsensus { matrixId, scores[], attendees[], notes, certifiedBy, certifiedAt }
   ```
   The matrix's `technicalScores` are derived from consensus, not typed once. A divergence above the configured points is flagged and must be resolved in the consensus note.
3. `certify_evaluation` requires: every assigned evaluator has a submitted sheet; all conflicts declared; consensus recorded; certifier is not the sole evaluator; no unresolved divergence.
4. **FX and evaluated price.** Add `FxRate { base, quote, rate, source, asOf }`. Each bid gets `evaluatedPrice` in the evaluation currency; `financialFormulaScores` uses it. A rate older than the configured staleness window blocks certification. Show the rate, source and date on the matrix and award report.
5. **Line items.** If a BOQ exists, compare unit prices to peer median and the reference; record the variance; keep the existing outlier rule, now fed by evaluated prices.
6. UI: evaluator workspace with assigned criteria, evidence links, score sheet, submit; chair's consensus view with divergence; FX panel; COI register.

**Tests**
- Missing sheet blocks certification.
- Conflicted evaluator cannot submit or certify.
- Divergence above threshold requires a consensus note.
- Currency conversion is reproducible from the stored rate.
- Stale rate blocks certification.
- Two currencies with the same numeric amount produce different evaluated scores.

**Acceptance**
- A three-person committee completes independent sheets and a consensus; the matrix total is reproducible.
- A conflicted member is excluded from scoring and signing.

**Effort:** 18 ed. **Depends on:** WS4.

---

### WS8 — Sittings, quorum and minutes

**Outcome:** a gate's quorum comes from a noticed, attended sitting, and minutes are attributable, approved and verifiable.

**Build**
1. **Sitting model.** Add `Sitting`:
   `id`, `workspaceId`, `tenderIds[]`, `scheduledAt`, `noticeAt`, `location`, `attendeeIds[]`, `attendance[]`, `quorumRequired`, `quorumMet`, `agenda`, `minutesId`, `gateIds[]`, `status`.
   Link `Meeting.sittingId` to the existing calendar. Attendance is admitted/withdrawn at the door; quorum is computed from admitted attendees, not a manually set `PRESENT` flag.
2. **Invitations.** Committee members get an email; scheduling sends an ICS invite and a reminder. The calendar shows the sitting and its tender links.
3. `fetchQuorum` for a gate uses the active sitting when one exists; a gate cannot claim quorum from a sitting that was not noticed or has no attendance record. An emergency quorum path requires a reason and audit.
4. **Minutes.**
   - Only an attendee or the appointed clerk may file; the meeting must have ended.
   - The note is written to the web store **and** forwarded to the audit spine with a content hash.
   - A `DRAFT → APPROVED` workflow: the chair approves; corrections are amendments linked to the original, never silent edits.
   - Every quote is checked against the normalised transcript; a quote that cannot be found is flagged, not published as verbatim.
   - Consent to record/transcribe is captured at the start; retention and legal-hold fields are set.
   - Access is scoped to attendees, committee, and auditors; not every signed-in user.
5. UI: sitting workspace (notice, attendance, agenda, quorum, minutes, gates), minutes approval queue, quote-confidence badges, access-denied state.

**Tests**
- A gate with a quorum from an unnotified sitting is refused.
- Quorum changes when an attendee withdraws.
- A non-attendee cannot file minutes.
- Filing before the meeting ends is refused.
- A fabricated quote is flagged.
- An unapproved note is marked `DRAFT` in the file.
- An auditor can read; an unrelated officer cannot.

**Acceptance**
- A full sitting produces one record linking attendance, minutes, quorum and the gates decided.
- The minutes hash verifies in the audit explorer.

**Effort:** 16 ed. **Depends on:** WS0, WS3.

---

### WS9 — Unified audit and reporting

**Outcome:** every mutation that affects an outcome is in one verifiable chain, and oversight can read it without admin access.

**Build**
1. Add `src/lib/audit-spine.ts`: a durable outbox that forwards web-side events to the sidecar with HMAC, retries, and idempotency keys. High-risk events (minutes approval, contract execution, payment certification) fail closed if the append fails; low-risk events retry.
2. Cover: users/roles, committee, sittings, minutes, settings, residency, supplier verification, org suspension, feature flags, record-only mode.
3. `GET /api/audit/unified` with filters (`actor`, `type`, `target`, `from`, `to`, `cursor`), tenant scoping, and a verification summary.
4. Extend `verifyToolLogFile()` to verify the forwarded segments and expose `{ ok, brokenAt, checked, lastVerifiedAt }`.
5. Export: JSON + CSV + a print/PDF-A report with the chain proof, event counts and verification timestamp. Auditor role gets read/export only.
6. Retention/legal hold: no delete path for audit events; a retention policy marks eligible records, never silently removes them.
7. Reporting: a "control coverage" report — sealed bids, dispositions, dual approvals, verified suppliers, payment caps, clock basis — generated from the record, not hand-written.

**Tests**
- Tampering with a forwarded event breaks verification at the right index.
- A duplicate forward is idempotent.
- A sidecar outage queues high-risk events and blocks the act; low-risk events retry.
- Cross-tenant audit reads fail closed.
- Export verifies independently.

**Acceptance**
- One audit view shows a gate, its sitting, its minutes and its receipt in order.
- An auditor can verify and export without any mutation capability.

**Effort:** 10 ed. **Depends on:** WS8; partially on WS5.

---

### WS10 — Residency and model governance

**Outcome:** procurement data goes only where the workspace policy allows, and every model call is attributable.

**Build**
1. Add `WorkspaceSettings.residency: "IN_REGION" | "HOSTED" | "HYBRID"`, `allowedProviders[]`, `redactionPolicy`.
2. Add `src/lib/model-gateway.ts`: resolves the provider from policy; refuses a hosted call when policy is `IN_REGION`; redacts supplier names, identifiers and prices for `HOSTED` unless explicitly allowed; records `{ provider, model, purpose, tokens, latency, redactions, at }`.
3. Route Muse chat, minutes, drafting and transcription through the gateway. No direct `fetch` to a model endpoint from a feature module.
4. Add a model-call audit entry and a visible provenance badge on every generated artifact.
5. Add a key-rotation and secrets inventory: `MUSE_API_KEY`, `LLM_API_KEY`, `QUORUM_BID_KEY`, `GATE_SECRET`, `QUORUM_EDGE_SECRET`; document rotation and revocation.
6. Add a data-processing record and a per-workspace deletion/export path.

**Tests**
- `IN_REGION` blocks a hosted endpoint with a clear error.
- `HOSTED` redacts the configured fields; the raw value never leaves.
- Model calls are logged with provider/model/tokens.
- A rotated key invalidates the old one.
- Export/delete is tenant-scoped.

**Acceptance**
- A restricted workspace cannot make a hosted call; the demo uses an in-region endpoint or a labelled synthetic dataset.
- Every generated artifact names its model and policy.

**Effort:** 8 ed. **Depends on:** WS0.

---

### WS11 — Documentation, training and calibration

**Outcome:** the manual matches the system, and the pilot team can run it without the engineering team.

**Build**
1. Generate the rule register, thresholds and jurisdiction table from live configuration. No hand-copied percentages.
2. Rewrite the procurement file template to include: method and justification, sealed-bid receipts, opening reconciliation, dispositions, FX basis, supplier verification, sitting/quorum, contract conditions, payments/retention, and the chain proof.
3. Write the operations runbook: daily checks, gate queue, clock exceptions, key rotation, incident response, backup/restore, audit verification.
4. Write the pilot script: one closed pack, one supplier, one sitting, one award, one contract, one payment; expected outputs and stop conditions.
5. Train the pilot officer and the committee chair; record attendance; collect UAT notes.
6. Calibration: run the eval harness after each WS; record precision/recall on the gold set; no regression below the baseline.

**Acceptance**
- A new officer completes the pilot script without engineering help.
- The manual's thresholds match the running system in a test.
- The eval score is recorded for each release.

**Effort:** 6 ed. **Depends on:** all.

---

## 7. Phased delivery

| Phase | Weeks | Workstreams | Exit gate |
|---|---|---|---|
| **0 — Truth** | W1 · 2–6 Nov | WS0; baseline tests; counsel kickoff; threat model | **Gate A** |
| **1 — P0** | W2–W6 · 9 Nov–11 Dec | WS1, WS2, WS3, WS4, WS5 | **Gate B** |
| **Holiday buffer** | 21 Dec–1 Jan | No planned delivery; on-call only | — |
| **2 — P1** | W7–W10 · 14 Dec–22 Jan | WS6, WS7, WS8, WS9 | **Gate C** |
| **3 — Production** | W11–W12 · 25 Jan–5 Feb | WS10, WS11, pen test, DR drill, UAT closeout | **Gate D** |

**Critical path:** WS0 → WS1 → WS4 → WS5 → WS6 → WS9. WS2 and WS3 run in parallel with WS1. WS7 and WS8 can start once WS4 is accepted.

**If a phase slips:** cut scope from Phase 3, never from Phase 1. A pilot without residency policy is a controlled risk; a pilot without sealed bids is not a pilot.

---

## 8. Gate criteria

### Gate A — Truth (6 Nov)
- [ ] `RECORD_ONLY` mode blocks contract and payment server-side.
- [ ] Every simulated surface is labelled; exports carry the watermark.
- [ ] Hard-coded rule thresholds removed; docs read from live config.
- [ ] Feature flags exist; every new control is dark.
- [ ] Audit event schema and helper merged.
- [ ] Baseline `bun test`, `npx tsc --noEmit`, `npx eslint .` green.
- [ ] Counsel has the jurisdiction questionnaire and a date for the pack review.

### Gate B — P0 closed (11 Dec)
- [ ] Sealed bids: no price readable before certified opening; receipts verify.
- [ ] Opening reconciliation accounts for every received bid.
- [ ] Addendum window enforced; bidder acknowledgment required.
- [ ] Office authority bound to user ID; gavel override removed or tightly scoped.
- [ ] Dual approval configurable and on by default above threshold.
- [ ] HIGH findings block award until dispositioned; complaints block contract.
- [ ] Payment, variation and budget caps enforced.
- [ ] Statutory clocks holiday- and timezone-correct; tests pass in EAT/CAT/WAT.
- [ ] Red-team scripts for each P0 control pass.
- [ ] No live tender has been run.

### Gate C — Pilot-ready (22 Jan)
- [ ] Supplier verification and method justification enforced.
- [ ] Independent scoring sheets + consensus + FX; conflicted members excluded.
- [ ] Sitting attendance drives quorum; invitations and ICS work.
- [ ] Minutes are attendee-filed, approved, hash-chained, access-scoped, quote-checked.
- [ ] Unified audit covers web and sidecar mutations; auditor can verify/export.
- [ ] Counsel signs the jurisdiction pack; pilot agreement and DPIA in place.
- [ ] One full shadow run on a closed pack with the pilot officer.
- [ ] UAT defects: no open P0/P1.

### Gate D — Production-ready (5 Feb)
- [ ] Residency policy enforced; every model call attributable.
- [ ] Penetration test closed: no critical/high findings.
- [ ] Backup/restore and disaster-recovery drill passed.
- [ ] Key rotation and incident response rehearsed.
- [ ] Operations runbook and training complete.
- [ ] Live connector verified, or `RECORD_ONLY` remains and contract signature stays blocked.
- [ ] Control-coverage report at 100% for P0/P1 controls.
- [ ] Product owner and counsel sign the release.

---

## 9. Engineering standards and migration

### Schema and migrations
- Add `stateVersion` to the sidecar state and `schemaVersion` to the web store. Every change ships an idempotent `migrate()` step with a pre-migration snapshot.
- Migrations are forward-only; rollback is restore-from-snapshot. Test each migration on a copy of production-like data.
- Never mutate historical records to fit a new model. Add fields, mark legacy states, and keep the original.
- Legacy labels: `LEGACY_UNSEALED_BID`, `LEGACY_UNEXECUTED_CONTRACT`, `LEGACY_UNSIGNED_MINUTES`, `LEGACY_CLOCK_BASIS`.

### Feature flags
- Flags live in workspace settings and are checked server-side.
- New refusals are on by default; new workflows are off until accepted.
- A flag change is an audited admin action with a reason.

### Permissions
Add capabilities to `src/lib/permissions.ts`:
`seal_bids`, `open_bids`, `dispose_findings`, `manage_contracts`, `certify_payments`, `verify_suppliers`, `manage_sittings`, `approve_minutes`, `manage_residency`.
Update both `canReadSidecar` and `canMutateSidecar`; add route tests for every new path.

### Audit events
Every new write emits one event with `before`/`after` and a reason where the act is discretionary. High-risk events fail closed if the audit append fails.

### API conventions
- Mutations are POST/PATCH with an explicit action; no "update anything" endpoints.
- Every refusal returns `{ error, code, blocking?: { type, id, reason } }`.
- Idempotency keys on bid receipt, opening, payment and audit forwarding.
- Server-side validation mirrors the UI; the UI never decides authority.

### UI states
Every control has: allowed, blocked-with-reason, pending-second-approval, legacy, and record-only. No dead buttons and no silent failures.

---

## 10. Verification plan

### Automated
| Layer | What | Command |
|---|---|---|
| Unit | Pure time, FX, caps, dispositions, quorum, envelope | `bun test mini-services/quorum-mcp/` |
| Web lib | Audit spine, permissions, minutes, supplier | `bun test src/lib/` |
| API integration | Bid lifecycle, gates, award, contract, payments, sittings | `bun test src/app/api/` (new) |
| Type | No type drift | `npx tsc --noEmit` |
| Lint | No suppressions added to pass | `npx eslint .` |
| Edge | Worker unchanged or retested | `npm run test:edge` |
| E2E | Officer, supplier and auditor journeys | Playwright (new) |

New test files: `bid-vault.test.ts`, `statutory-clock.test.ts`, `gate-authority.test.ts`, `award-disposition.test.ts`, `contract-finance.test.ts`, `supplier-assurance.test.ts`, `evaluation-integrity.test.ts`, `sitting-minutes.test.ts`, `audit-unified.test.ts`, `residency.test.ts`.

### Security and abuse
- Authz matrix test: every new route × every role, expecting 200/403.
- IDOR: cross-workspace IDs on bids, gates, tenders, minutes, payments.
- Replay: reused step-up token, duplicate bid, duplicate payment, duplicate audit event.
- Tamper: ciphertext, commitment, audit line, receipt.
- Key loss: missing master key fails closed with a recovery runbook.
- Injection: malicious bid text cannot call a tool or change a finding.

### UAT
Twelve-step script: create a tender with a non-open method and justification; publish; register a supplier; seal a bid; attempt a late bid; withdraw/amend; open with witnesses; reconcile; score independently; declare a conflict; certify; sign award with a disposition; publish; open a complaint; answer; sign contract with bonds; certify a payment; complete; export the file; verify the chain. Each step has an expected result and a stop condition.

### Performance
- 100 bids, 50 concurrent desk users, 20 concurrent supplier sessions; p95 < 500 ms for reads, < 1.5 s for gate decisions.
- Encryption/decryption overhead measured and recorded.
- Audit verification time measured at 100k entries.

---

## 11. RACI

| Activity | Product lead | Engineering | Counsel | Design | Ops | Pilot officer |
|---|---|---|---|---|---|---|
| Scope and gates | A | R | C | C | I | C |
| Jurisdiction pack | A | C | R | I | I | C |
| Bid vault / opening | A | R | C | C | I | C |
| Gate authority | A | R | C | I | I | C |
| Award legality | A | R | R | C | I | C |
| Contract/finance | A | R | C | C | C | C |
| Supplier assurance | A | R | C | I | I | C |
| Evaluation integrity | A | R | C | C | I | R |
| Sittings/minutes | A | R | C | C | I | R |
| Unified audit | A | R | C | I | C | I |
| Residency | A | R | R | I | C | I |
| UAT and sign-off | A | C | C | I | I | R |

`R` responsible, `A` accountable, `C` consulted, `I` informed.

---

## 12. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Jurisdiction rules differ from the assumptions | High | High | Pack per country; counsel signs; versioned; no universal constants |
| R2 | Bid key loss makes bids unreadable | Medium | Critical | KMS/HSM, dual-control escrow, restore drill before Gate B |
| R3 | Legacy data cannot be sealed | High | Medium | `LEGACY_UNSEALED` label; no live tender on legacy data |
| R4 | e-GP connector slips | High | High | `RECORD_ONLY` remains; contract signature stays blocked; no overclaim |
| R5 | Scope creep | High | Medium | Freeze after Gate A; parking lot; gate review |
| R6 | Team capacity | Medium | High | Cut Phase 3 first; never cut Phase 1 acceptance |
| R7 | Model/provider outage | Medium | Low | Deterministic fallbacks already exist; keep them labelled |
| R8 | Residency policy conflicts with the demo | Medium | Medium | Synthetic demo data; in-region endpoint for restricted workspaces |
| R9 | Migration corrupts state | Low | Critical | Snapshot, idempotent migration, restore test, dual-run in staging |
| R10 | Audit forward outage blocks work | Medium | Medium | Outbox + retry; high-risk fail closed; low-risk queued with alert |
| R11 | Pilot partner withdraws | Medium | Medium | Two prospects; record-only rehearsal still proves the controls |
| R12 | Pen test finds a critical issue late | Medium | High | Test at Gate C, not Gate D; reserve Week 12 for fixes |

---

## 13. Metrics and reporting

**Control coverage (must reach 100% by Gate D):**
- Bids sealed before opening / all bids opened.
- HIGH findings dispositioned before award / all HIGH findings on recommended bids.
- Payments within contract and retention / all payments.
- Variations within cumulative cap / all variations.
- Office gates signed by the correct office / all office gates.
- Dual approvals above threshold / all eligible gates.
- Suppliers verified at award / all awarded suppliers.
- Statutory clocks computed with a signed pack / all clocks.
- High-risk events in the audit spine / all high-risk events.

**Operational:**
- Gate queue age (p50/p95), clock exceptions, failed notifications, audit verification status, p95 latency, error rate, backup age.
- Pilot: review time, findings accepted/rejected, citation accuracy, officer NPS, escalations.

**Reporting cadence:** weekly control dashboard, gate review at the end of each phase, a final readiness report with evidence links.

---

## 14. Traceability matrix

| Gap | Workstream | Phase | Acceptance evidence |
|---|---|---|---|
| G-01 Sealed bids | WS1 | 1 | No pre-opening amount in API/store; red-team script |
| G-02 Findings block award | WS4 | 1 | Open HIGH returns 403 with finding ID |
| G-03 Simulated publication | WS0, WS5 | 0–1 | Record-only blocks contract; publication receipt required |
| G-04 Office bypass | WS3 | 1 | Name/body tamper cannot execute; office ID enforced |
| G-05 Holiday/timezone clocks | WS2 | 1 | EAT/CAT/WAT test matrix; pack signed |
| G-06 Payment/variation/budget caps | WS5 | 1 | Overpayment/over-variation/overcommit refused |
| G-07 Dual approval | WS3 | 1 | Threshold UI; first/second approver tests |
| G-08 Opening reconciliation | WS1 | 1 | Every envelope accounted for; diff in file |
| G-09 Addendum control | WS2 | 1 | Inside-window addendum refused; acknowledgment required |
| G-10 Complaint suspension | WS4 | 1 | Open complaint blocks contract/payment |
| G-11 COI register | WS7 | 2 | Structured declarations; conflicted evaluator excluded |
| G-12 Independent scoring | WS7 | 2 | Missing sheet blocks; consensus reproducible |
| G-13 Currency-blind scoring | WS7 | 2 | FX rate stored; reproducible evaluated price |
| G-14 Supplier verification | WS6 | 2 | Unverified supplier cannot win; suspension blocks |
| G-15 Method control | WS6 | 2 | Non-open method needs justification/approval |
| G-16 Sittings/quorum/invites | WS8 | 2 | Quorum from attendance; ICS sent |
| G-17 Minutes evidentiality | WS8, WS9 | 2 | Attendee-only, approved, chained, quote-checked |
| G-18 Bid lifecycle | WS1 | 1 | Receipt, withdraw, amend; all audited |
| G-19 Contract execution | WS5 | 1 | Supplier acceptance + bonds required |
| G-20 Payment three-way match | WS5 | 1 | Invoice + milestone + receipt required |
| G-21 Residency | WS10 | 3 | Hosted call blocked; redaction logged |
| P2-01 Documentation drift | WS0, WS11 | 0, 3 | Manual thresholds equal live config in a test |
| P2-02 Split audit spine | WS9 | 2 | Unified verify covers web + sidecar |
| P2-03 Minutes consent/retention | WS8 | 2 | Consent captured; retention/legal hold set |
| P2-04 Contract-close learning | WS5, WS11 | 1, 3 | Completion triggers performance review |
| P2-05 Calendar counters | WS0, WS9 | 0, 2 | Counters reconcile to listed items |

---

## 15. Out of scope / deferred

- Full ERP, general ledger, tax engine, asset register, inventory.
- Billing, plans, subscriptions.
- SSO/SAML/SCIM, SCIM provisioning, fine-grained IAM policy editor.
- Qualified e-signature provider integration (unless counsel requires it for Gate D).
- Multi-region deployment, Kubernetes, blockchain, vector database.
- Native mobile app.
- Postgres/object-storage/queue migration — schedule after Gate D; keep the JSON store behind a repository interface until then.
- Live e-GP connectors beyond the one jurisdiction named for the pilot.
- Autonomous award, autonomous rejection, or any model-initiated gate decision.

---

## 16. First ten working days (2–13 Nov 2026)

| Day | Work | Output |
|---|---|---|
| 1 | Freeze scope; assign workstream owners; confirm team and counsel dates | Signed plan, RACI, calendar |
| 2 | Baseline: run `bun test`, `npx tsc --noEmit`, `npx eslint .`; record results | Baseline report |
| 3 | WS0: record-only mode, banner, export watermark; feature-flag registry | Flag behind tests |
| 4 | WS0: audit event schema/helper; rule catalogue from live guards; doc drift fix | Gate A evidence |
| 5 | Threat model: bid vault, key custody, opening, audit forwarding | Threat model doc |
| 6 | WS1 spike: envelope format, KMS/env key, receipt signature; design review | ADR + prototype |
| 7 | WS2: jurisdiction pack schema and seed data; counsel questionnaire | Pack v0.1 |
| 8 | WS2: local end-of-day and timezone tests; addendum refusal design | Failing tests first |
| 9 | WS3: user/office IDs, gate authority preflight, threshold UI mock | Schema + mock |
| 10 | Gate A review; close defects; publish revised plan and dates | Gate A decision |

**Gate A review questions:** Is every simulated surface labelled? Can a record-only workspace sign a contract? Does the manual match the code? Is every new control dark and testable? Is counsel engaged with a signed pack date?

---

## 17. The one-sentence version

**Close the six probity holes first — sealed bids, findings that block, real offices, honest publication, correct clocks and capped money — then make the record reconcile, and only then call it production-ready.**
