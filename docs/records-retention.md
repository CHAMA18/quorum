# Records, evidence and retention policy

*Status: in force as platform policy. Retention YEARS are working defaults — the operational
owner confirms them against the applicable records schedule before any disposal decision
relies on them.*

---

## 1. What qualifies as a procurement record

A record is any artifact the platform holds that contributes to a procurement decision:

- solicitation documents: notices, specifications, addenda, clarifications;
- bid documents: submitted files, typed/staged text, OCDS records;
- integrity records: COI declarations, debarment findings, registry cross-checks;
- evaluation records: opening register, evaluation matrix, MED adjustments, ALB dossiers;
- decision records: award report, award notice, standstill window, debrief letters;
- contract records: pack, milestones, variations, payment certifications, performance security;
- governance records: gate receipts, tool-log entries, oversight events, exception rows.

## 2. Evidence integrity — how a record earns trust

Every document is registered (`document_register`) with:

- **content hash** (SHA-256, first 32 hex) computed over the bytes at capture;
- **provenance**: channel (`web_upload`, `sidecar_stage`, `sample_pack`, `gate_artifact`,
  `system`), importer identity, origin system, timestamp;
- **version line**: re-registering the same key with different content creates a
  **version** with `previousSha` — silent replacement is structurally impossible;
- **chain of custody**: registered / versioned / downloaded / reviewed / archived events,
  folded per document and mirrored in the hash-chained tool log;
- **retention**: schedule name, years, derived disposal date, status.

Verification: `GET /api/documents/:id/verify` recomputes the hash from the staged file
when the content lives on disk. A mismatch is reported verbatim — "the content changed
without a version event" — never smoothed over. Object-storage documents carry the edge
gate's etag plus the custody line.

## 3. Extraction quality — person in the loop

OCR/text extraction is honest by construction: when no usable text is extracted, the file
is still stored and the response says `staged: false` — OCR is never claimed. Documents
whose extraction is not high-confidence carry an `extractionConfidence` flag and appear in
the **document review queue** (Compliance screen). The queue clears only through a named
reviewer's confirmation (`document_review`), which is a custody event. A low-confidence
document is a work item, not a decision input.

## 4. Retention schedule (working defaults)

| Record kind | Default years | Basis |
| --- | --- | --- |
| Contract / receipt | 10 | Longest-lived obligations; confirm against schedule |
| Notice, bid, OCDS, specification, evidence | 7 | Procurement-file horizon; confirm |
| Governance events, audit log | indefinite | The chain is the record; disposal is not offered |

The years live in the sidecar (`RETENTION_DEFAULTS`) and travel on every registered
document as `retention {schedule, years, disposeAfter, status}`. Archiving is a status
change with a custody event — **nothing in the platform deletes a record**; the audit log
keeps its own copy of history regardless.

## 5. Audit export — the defensible packet

For any tender the platform reconstructs the complete decision history:

- `GET /api/procurement-file/:ref` — the consolidated procurement file (markdown): the
  cycle, runs and findings **with human dispositions**, gates, complaints, dissents,
  exceptions, the compliance verdict and the audit-chain verification result;
- `GET /api/procurement-file/:ref/bundle` — the same artifacts as a manifest with
  per-artifact SHA-256 and an HMAC-SHA256 seal over the manifest;
- `GET /api/runs/:id/report` — the per-run report with model attribution, findings,
  citations, redlines and the human-review roll-up;
- `GET /api/log` + `/api/log/verify` — the append-only spine and its recomputed verdict;
- `GET /api/receipts/:id/verify` — offline Ed25519 verification of any gate receipt.

An auditor can reassemble the tender record from the evidence pack and check every claim
against a cited line in a hashed document. That is the standard the platform holds itself
to; the acceptance test is a tender record reconstructed from the original evidence.
