# Pilot plan — controlled validation before public-sector deployment

*Status: active plan. The launch readiness gate (Readiness screen) is the machine-checked
version of this document; the pilot does not start until that gate says READY.*

---

## 1. Pilot design

- **Environment**: one procurement unit, one live workspace, real document flows, no
  production obligations until the gate clears. The desk runs alongside the current manual
  process — never instead of it during the pilot.
- **Scope**: intake to award recommendation on open competitive bidding methods first;
  exceptions, emergency procurement and contract administration enter in the second month.
- **Controlled comparison**: every tender in the pilot window is tracked both ways. The
  manual baseline records dates by hand; the platform records everything natively — the
  comparison is arithmetic, not opinion.
- **Escalation paths**: pilot issues go to the desk owner (daily), the operational owner
  (weekly review), and the governance sign-off holder (any control failure). A broken
  audit chain or an invalid receipt pauses the pilot the same day.

## 2. Pilot metrics (all computed live on the Readiness screen)

| Metric | Source | Target |
| --- | --- | --- |
| Review time reduction | run durations vs the manual baseline log | ≥ 50% on first-pass review |
| Accuracy of flagged findings | eval lab (pre-written labels + mutation tests), then human dispositions | precision ≥ 85%, mutation detection 100% |
| Time to award recommendation | cycle timestamps: closing → signed report | measured, trend down |
| Compliance issue detection rate | findings per tender vs the baseline's known issues | ≥ baseline |
| Human overrides | REJECTED gates, finding rejections with reasons | measured; every override carries a stated reason |
| Support burden | notifications, deliveries, incident log | declining after week 2 |
| Audit trail completeness | chain verify + disposition coverage | 100% chain; dispositions trending to 100% |

The platform prints these numbers from live state (`GET /api/readiness` → `pilotMetrics`)
and the eval lab's own record — it never restates or rounds in its own favor.

## 3. Quality assurance

- **Real, representative tender packs**: the pilot corpus is the unit's actual documents,
  registered with hashes and provenance from day one.
- **Independent review of flagged findings**: a reviewer who did not run the evaluation
  disposes of findings (accept/reject with reasons — the sidecar enforces a stated reason
  for every rejection).
- **Edge cases and fraud scenarios**: the mutation suite (bid-value inflation, hidden
  required documents, corrupted supplier IDs, removed budget ceilings, line-item price
  inflation) is the standing fraud harness; it must detect 100% before each monthly review.
- **Award quality**: every award recommendation packet (report + matrix + COI register +
  dissents + compliance verdict) is reviewed against the act by the legal adviser before
  the pilot's final report.

## 4. Launch readiness gate

The product launches only when all nine criteria hold on the Readiness screen:

1. governance and control foundation signed off (named signatory, recorded in-product);
2. role segregation enforced (distinct roles live; fail-closed gateway verified);
3. MFA enforced for privileged accounts (policy ON, zero privileged accounts without it);
4. audit trail tested and proven (hash chain verified across every entry);
5. live data imports validated (registry handshakes holding OCID proof);
6. evidence handling verified (document register active, no unreviewed extractions);
7. reporting and oversight complete (exceptions register, compliance summaries, analytics);
8. independent quality record exists (eval lab recall/precision/mutation numbers on file);
9. **named human signs the launch** — the last criterion, recorded with a note, in the
   governance event log.

Criteria 1–8 are machine-checked against live state each time the gate is read. Criterion
9 is the human one — deliberately last, deliberately named.
