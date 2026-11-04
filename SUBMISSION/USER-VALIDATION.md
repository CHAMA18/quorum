# Procurement desk validation protocol

Status: prepared on 4 November 2026; no completed officer study or adoption commitment is claimed.

## Users and first deployment

The first intended user is a procurement officer preparing an evaluation committee's file for a Zambian public-health tender. Committee members review the supporting evidence and retain scoring and award authority. The accounting officer is the accountable approver; internal audit is a downstream reader. Hospitals and patients benefit only if better review contributes to dependable purchasing. That downstream effect has not been measured.

Start with one consenting procurement unit, one retrospective, non-sensitive tender, and a read-only deployment. Keep the institution's existing e-GP submission and approval processes. The procurement unit supplies issued criteria, complete bid documents and authorised reviewers. Quorum supplies source-linked draft findings, questions, model attribution and an exportable review record. A named officer corrects the draft. A second reviewer checks unresolved or high-severity issues. The institution decides whether hosted model processing is permitted; redaction is an additional control, not a guarantee of legal compliance.

The likely adoption decision involves the head of procurement, ICT/security, records management and the accounting officer. A useful first commercial unit is a workspace for one procurement team, subject to its purchasing rules. Pricing, willingness to pay and a paying customer remain unvalidated. The project will not describe a target office as a customer or partner without its agreement.

## Two-officer, counterbalanced review

1. Recruit two procurement practitioners who did not author the evaluation labels. Record their role, years of experience and explicit consent to record anonymised observations. Do not publish names, contact details or employer endorsements without separate permission.
2. Select two comparable retrospective or fictional cases, A and B. Freeze the exact source files and SHA-256 bundle hashes. Exclude real personal data unless the institution authorises its use. Give both officers the same written task: identify material evidence gaps, cite the source, and prepare committee questions without making an award.
3. Officer 1 reviews A manually and B with Quorum. Officer 2 reviews B manually and A with Quorum. Record start/end times, interruptions and active review minutes. Each officer sees a given case only once. Both conditions include time to read sources, correct findings and write the final review.
4. Before either sees Quorum output, an independent procurement reviewer annotates both cases from sources alone. Use the existing blinded packet command: `bun run eval:review:prepare`. Keep their completed file sealed until the timed sessions end. A third person resolves disputed labels against the source; retain disagreements.
5. Capture each final review, every accepted/rejected/corrected suggestion, material missed issues, unsupported statements and unanswered questions. Treat absence of evidence as a gap, not proof of misconduct. Ask whether the officer would use the tool again, what prevents deployment, and which step saved or added work.
6. Report all four observations, including failures and slower assisted sessions. Do not generalise from two officers to national savings. Run the independent agreement scorer only on a genuinely completed reviewer packet: `bun run eval:review:score -- /path/to/completed-reviewer-pack.json` (or invoke the underlying script directly).

## Measures and decision rule

Primary measures: active minutes to an acceptable first-pass committee review; material-issue recall; unsupported statements per final review. Secondary measures: source-link usefulness, corrections required, workflow fit, model cost, and willingness to use again. Report paired case-level differences; a two-person pilot supports descriptive results only.

Proceed to a larger shadow pilot only if the procurement unit agrees that the assisted reviews are usable, no material unsupported statement remains in the reviewed output, and recall does not fall below the manual condition. Speed alone is insufficient. Agree a larger-sample threshold and procurement process with the institution before any operational adoption.

## Observation record

Copy `evidence/officer-observations.template.json` for each completed session. Fill observations after the session; preserve source hashes and the final review artifact. Blank fields are missing evidence. Automated integration accounts and generated narration are never officer participants.

Potential value can be modelled as `tenders per month × observed officer-hours saved per tender × local staff cost per hour`. Until the pilot supplies those inputs, publish no claimed hours, percentage reduction, money saved, or funds recovered.
