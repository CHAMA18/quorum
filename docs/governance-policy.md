# Quorum Governance Policy — the authority model

*Status: in force as platform policy. The illustrative elements (approval bands) await the
operational owner's sign-off, which is recorded in-product on the Governance screen.*

---

## 1. The authority of the system

Quorum is **decision support for a procurement authority, not the authority itself**. Three
statements bound everything the platform does:

1. The system supports procurement decisions; it does not replace procurement authority.
2. Every irreversible decision requires a named human signatory.
3. Every action is auditable and traceable to source evidence.

Concretely: the agent reads files, raises findings (citation-verified), drafts redlines and
prepares decision packets. It cannot file, certify, sign, publish or pay. Those acts are
**gates** — a pending decision that only resolves when a named human, re-authenticated
(step-up: passphrase or TOTP) and authorized by office and quorum, signs it. Every executed
gate produces an **Ed25519-signed receipt** verifiable offline.

## 2. Role model

Workspace roles (web store, enforced per-route in code):

| Role | Authority | Key limits |
| --- | --- | --- |
| OWNER | Everything, including transferring ownership | Unique; cannot be removed by an ADMIN |
| ADMIN | Runs the desk and its governance | Cannot grant/remove OWNER or ADMIN |
| OFFICER | Prepares evaluations, manages suppliers, signs as the gavel | Not a people manager |
| COMMITTEE | Reads the file; signs gates they are rostered and officed for | Office comes from the register |
| AUDITOR | Read-only oversight: people, organizations, audit trail | Holds no write capability anywhere |

Capability checks are **server-side on every mutation route** (`can()`), mirrored in the
gateway (`canMutateSidecar`, fail-closed: an unmapped sidecar mutation is refused for
read-only roles rather than waved through). Hiding a button is not a permission.

## 3. The action catalogue

The live authority matrix — action → role → statutory office → escalation → evidence — is
served by the sidecar at `GET /api/governance` and rendered on the **Governance** screen.
The screen cannot drift from the enforcement code: both read the same definitions.

Statutory offices carried by the committee register: **Procurement unit**, **Evaluation
committee**, **Accounting officer**, **Oversight/audit**. Office-gated acts (bid-opening
certification, evaluation certification, ALB resolution, award signing, notice publication,
contract signature, variation approval, payment certification, exception approval) fail
closed: a signer who is not on the register, has no office, or holds the wrong office is
refused by name.

## 4. Approval bands

Monetary thresholds are **configuration, not law**: the sidecar persists them
(`state.governance.bands`) with plainly-marked illustrative defaults, and the operational
owner confirms or replaces them. Changing a band is a logged governance act
(`governance_bands_update`) carrying the actor; recording the sign-off is an irreversible
log entry (`governance_signoff`). Until the sign-off exists, every governance read says so.

## 5. Segregation of duties

Enforced by code, listed on the Governance screen with its enforcement mechanism:

- **Preparer ≠ approver** — certification requires a PRESENT roster member holding the
  evaluation office (or the attested gavel); the office check reads the register.
- **Independent committee review for material awards** — `sign_award_report` refuses while
  the matrix is DRAFT; `publish_award_notice` refuses until the report is signed; the
  matrix cannot certify until **every PRESENT member has declared conflicts** (COI gate).
- **Requester ≠ approver for exceptions** — every exception approval rides the
  accounting-officer gate; the requester's identity rides the inputs, the approver's office
  is checked against the register.
- **Auditor changes nothing** — read capabilities only, enforced per route.
- **No single point of human failure** — irreversible acts need quorum + office + fresh
  step-up + (awards) wet-ink; the roll is recomputed from member rows, never trusted.

## 6. Decision policy framework

The platform distinguishes three voices, and the record shows which spoke:

- **System recommendation** — the agent's findings, redlines and award recommendation.
  Labeled as recommendation/draft; every finding cites its source document line; a finding
  that fails the citation check is **rejected, never kept**.
- **Committee decision** — the certified matrix, MED adjustments, resolved ALB dossiers,
  dissents and minority recommendations (recorded on the cycle, carried in the procurement
  file).
- **Signed award authority** — the gate receipt: who signed, when, on what inputs hash,
  with which second factor and (for awards) whose hand. Refusals are recorded with the
  same care as approvals (the exception register keeps the REFUSED row with the note).

Non-compliance, challenge and appeal: complaints are logged on the cycle, answered by gate,
and never disappear; dissenting views are a first-class record, not a meeting anecdote.

## 7. Where each guarantee lives

| Guarantee | Enforcement point |
| --- | --- |
| Named human on every irreversible act | `decideGate` — step-up + office + quorum before any state change |
| Evidence over assertion | Citation-verified findings; `R-*` rules; procurement file with SHAs |
| Tamper-evidence | Hash-chained tool log (`/api/log/verify`), Ed25519 receipts, document register versions |
| Governance transparency | `GET /api/governance`, Governance screen, oversight event log |
| Configuration accountability | Logged band changes; MFA policy flips; access reviews as events |
