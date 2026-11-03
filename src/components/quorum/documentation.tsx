"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, CircleAlert, Gavel, Maximize2, Search, X } from "lucide-react";
import { HorizontalScrollRegion } from "@/components/quorum/horizontal-scroll-region";
import { cn } from "@/lib/utils";
import { preferredScrollBehavior, trapTabFocus } from "@/lib/a11y";
import { TourLayer, type TourStep } from "@/components/quorum/tour";

/* ── Quorum's documentation — the complete handbook ────────────────────────
   Its own page at /docs: Docusaurus-grade depth, written for the first-time
   officer and the auditor alike — every screen, every rule, the gate
   protocol, and Zambia's procurement law as the engine implements it.
   Chapters carry dated screenshots of the screens they describe; the shots
   are frozen in public/docs and expand into a lightbox on click. Captions call
   out any visible legacy details that no longer match the current workspace. */

type DocCalloutTone = "rule" | "law" | "tip" | "warn";

type DocFigure = { src: string; alt: string; caption: string; screen: string };

type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; title?: string; items: string[] }
  | { kind: "table"; title?: string; head: string[]; rows: string[][] }
  | { kind: "terms"; title?: string; items: { term: string; def: string }[] }
  | { kind: "callout"; tone: DocCalloutTone; title: string; text: string }
  | ({ kind: "figure" } & DocFigure)
  | { kind: "methods" };

type DocChapter = {
  id: string;
  kicker: string;
  title: string;
  lead: string;
  blocks: DocBlock[];
};

type RuleCatalogueRow = {
  id: string;
  severity: string;
  catches: string;
  action: string;
};

const DOC_CHAPTERS: DocChapter[] = [
  {
    id: "control",
    kicker: "Administration",
    title: "Roles, compliance & launch",
    lead: "Set who may take each action, which approvals are required and what checks must pass before using the workspace for live procurement.",
    blocks: [
      {
        kind: "p",
        text: "Each tender record separates review findings from evaluator scores and the final award decision. It links findings to their sources and records who reviewed and approved each step.",
      },
      {
        kind: "table",
        title: "Where to find these settings",
        head: ["AREA", "PAGE", "WHAT YOU CAN DO"],
        rows: [
          ["Roles & approvals", "Administration → Roles & approvals", "Review permissions, approval limits and administrator sign-in requirements."],
          ["Compliance checks", "Administration → Compliance checks", "Review procurement rules, tender results, exception requests and documents that need a manual check."],
          ["Workspace readiness", "Administration → Workspace readiness", "Confirm that account access, records, document handling and required services are ready."],
        ],
      },
      {
        kind: "callout",
        tone: "rule",
        title: "Exception requests need independent approval",
        text: "The person who submits an exception request cannot approve it. An authorized officer reviews the reasons and supporting records before deciding.",
      },
      {
        kind: "p",
        text: "Tender documents keep a version history. Downloads, reviews and decisions are recorded, so the procurement file shows what changed and who acted. Retention periods follow the workspace's records policy.",
      },
    ],
  },
  {
    id: "start",
    kicker: "Orientation",
    title: "What Quorum does",
    lead: "A procurement review workspace for public institutions. Quorum organizes tender documents, applies stated review criteria and prepares source-linked findings for officers to verify.",
    blocks: [
      {
        kind: "p",
        text: "Quorum supports the review; it does not award the tender. Officers verify the evidence and record their dispositions. The decision to award or return belongs to the authorised committee and is retained in the procurement history.",
      },
      {
        kind: "callout",
        tone: "rule",
        title: "Decision authority",
        text: "QUORUM SUPPORTS THE REVIEW. AUTHORISED COMMITTEE MEMBERS MAKE AND RECORD THE AWARD DECISION.",
      },
      {
        kind: "p",
        text: "The application brings together the public product overview, officer sign-in and a workspace for tender reviews, findings, approvals, supplier records and this handbook.",
      },
      {
        kind: "figure",
        src: "/docs/overview.png",
        alt: "Archived Quorum workspace overview showing its 18 October 2026 stat tiles and former tender ID format",
        screen: "ARCHIVED CAPTURE · OVERVIEW · 18 OCT 2026",
        caption:
          "Historical workspace snapshot. Its tender rows show the former country-prefixed IDs; the current register displays neutral QRM system references.",
      },
      {
        kind: "table",
        title: "A tender review in four steps",
        head: ["STEP", "PAGE", "WHAT HAPPENS"],
        rows: [
          ["Prepare", "Tender workflow", "Create a tender record and add the notice, specifications and bid documents."],
          ["Review", "Tender reviews", "Run the checks and review each finding with its source document."],
          ["Decide", "Approvals", "Authorized committee members approve the award or return the tender for more information."],
          ["Record", "Award history", "See the decision, the approver and when it was recorded."],
        ],
      },
      {
        kind: "steps",
        title: "Your first five minutes",
        items: [
          "Open the workspace from the top of the page once signed in.",
          "Check the Overview for reviews in progress, issues found and decisions awaiting approval.",
          "Open Suppliers from the sidebar and check the register of bidders your entity deals with.",
          "Start a review for a tender or use sample documents to learn the workflow.",
          "Review the evidence, then approve the decision or return it for clarification.",
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Tip",
        text: "An empty page means no reviews or decisions have been recorded there yet.",
      },
    ],
  },
  {
    id: "pipeline",
    kicker: "Review process",
    title: "How a tender review works",
    lead: "Quorum checks tender documents against the published requirements and prepares findings with links to their sources. Officers review the evidence; authorized decision-makers make the award decision.",
    blocks: [
      {
        kind: "steps",
        title: "From tender documents to decision",
        items: [
          "Add the tender notice, specifications and bid documents to the tender record.",
          "Review the required terms and evaluation criteria before checking bids.",
          "Compare the submitted bids with the published requirements and procurement rules.",
          "Open each finding's cited document and page, then record whether it is confirmed or needs follow-up.",
          "Authorized reviewers approve the award recommendation or return it for clarification.",
          "The decision and supporting records remain in the tender's history.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/runs.png",
        alt: "Archived tender review list captured 18 October 2026, with the former tender reference format",
        screen: "ARCHIVED CAPTURE · LEGACY REFERENCE FORMAT",
        caption:
          "Historical review-list snapshot. The tender references shown use an earlier format; current records receive a Quorum reference.",
      },
      {
        kind: "table",
        title: "What each review includes",
        head: ["RECORD", "WHAT IT SHOWS"],
        rows: [
          ["Tender documents", "The files reviewed and the version used for each finding."],
          ["Requirements", "The published conditions and evaluation criteria used in the review."],
          ["Review findings", "Issues identified, their source documents and their review status."],
          ["Approval decision", "The authorized decision-maker, the decision and its date."],
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "A person makes the final decision",
        text: "Quorum can prepare findings and an award recommendation. It cannot award the tender. Only an authorized officer or committee member can record that decision.",
      },
      {
        kind: "p",
        text: "The activity log records who reviewed a tender, what changed and when. The tender history keeps the documents, findings and decisions together for later review.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Check the source before acting",
        text: "Every finding should point to a document and a relevant page or section. Open the source and verify it before making a decision.",
      },
      {
        kind: "figure",
        src: "/docs/run-detail.png",
        alt: "Archived tender review details with findings and report actions, showing the former tender reference format",
        screen: "ARCHIVED CAPTURE · REVIEW DETAILS · LEGACY REFERENCE",
        caption:
          "Historical review-details snapshot. Current records display the Quorum reference; original tender references remain available in the source documents.",
      },
    ],
  },
  {
    id: "launch",
    kicker: "Daily work",
    title: "Start a tender review",
    lead: "Create a tender record, add its documents and choose which checks to run. The review starts only after you confirm the details.",
    blocks: [
      {
        kind: "steps",
        title: "Create a review in three steps",
        items: [
          "Tender details. Enter the published title and source reference. Quorum assigns a separate workspace reference to the record.",
          "Documents. Add up to twelve files. Wait until each file is ready before starting the review. Files are stored according to your workspace settings.",
          "Review checks. Choose which requirements to review. Findings include a link to the relevant document page when available.",
          "Start review. Confirm the details. The review appears under Tender reviews with its current status.",
        ],
      },
      {
        kind: "table",
        title: "Document status",
        head: ["STATUS", "MEANING"],
        rows: [
          ["File received", "The file was uploaded and is waiting to be read."],
          ["Reading file", "Quorum is reading text, tables and price details."],
          ["Ready to review", "The document can be checked and cited in findings."],
        ],
      },
      {
        kind: "p",
        text: "Sample tender documents are available for practice. Use them to explore the review process without changing a live tender record.",
      },
      {
        kind: "figure",
        src: "/docs/new-evaluation.png",
        alt: "Archived tender review setup showing the former tender reference format, document choices and sample tenders",
        screen: "ARCHIVED CAPTURE · LEGACY REFERENCE FORMAT",
        caption:
          "This older capture shows a previous tender reference format. New records receive a Quorum reference while the original published reference remains with the source documents.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Keep tender references clear",
        text: "Quorum assigns a unique reference to each workspace record. Keep the reference published by the procuring authority in the tender documents so reviewers can match both records.",
      },
    ],
  },
  {
    id: "findings",
    kicker: "Review results",
    title: "Review findings and rules",
    lead: "Each finding describes a possible issue, the rule it relates to and a link to the source document and relevant page or section.",
    blocks: [
      {
        kind: "p",
        text: "Findings are grouped by subject, including documents, compliance, supplier registration, pricing, calculations, disclosures and delivery. A finding without a source link needs manual verification before anyone relies on it.",
      },
      {
        kind: "table",
        title: "Examples of review checks",
        head: ["CHECK", "PRIORITY", "WHAT IT IDENTIFIES", "WHAT TO REVIEW"],
        rows: [
          ["Required document", "Medium", "A bid may be missing a document requested in the notice.", "Check the bid file and follow the published requirements."],
          ["Supplier registration", "High", "A supplier number may be missing or inconsistent with the official register.", "Verify the number against the relevant registry."],
          ["Buyer details", "Medium", "The tender notice may not name the procuring entity.", "Confirm who is responsible for the procurement."],
          ["Award amount", "High", "A published award amount may exceed the tender's approved budget.", "Check the amount and any approved budget change."],
          ["Unusual price", "High", "A unit price differs significantly from comparable bids.", "Review the calculation and specification before scoring."],
          ["Specification differences", "High", "A bid may offer an alternative or fail to meet a stated requirement.", "Compare the offer with the published specification."],
          ["Unusual bid amount", "High", "A bid amount is much higher than the other bids.", "Confirm the bids cover the same scope before comparing them."],
          ["Over budget", "High", "A bid may exceed the stated budget, including after currency conversion.", "Confirm the budget and applicable approval before proceeding."],
        ],
      },
      {
        kind: "steps",
        title: "Review each finding",
        items: [
          "Open — the issue is waiting for review.",
          "Resolved — the reviewer recorded an outcome and supporting reasons.",
          "Needs recheck — the tender was returned and the updated information must be reviewed.",
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Check the source",
        text: "Each source link should open the document and point to a relevant page, clause or price schedule. Confirm that the cited text supports the finding before acting on it.",
      },
      {
        kind: "figure",
        src: "/docs/findings.png",
        alt: "The review findings screen with issues, priority and source documents",
        screen: "WORKSPACE · REVIEW FINDINGS · CAPTURED 18 OCT 2026",
        caption:
          "The review findings list keeps issues from each tender review with their source references. Open a finding to check the supporting document.",
      },
    ],
  },
  {
    id: "gates",
    kicker: "Decision-making",
    title: "Approvals and committee decisions",
    lead: "Quorum prepares review results. Authorized officers and committee members review the evidence and make the award decision.",
    blocks: [
      {
        kind: "p",
        text: "An approval request shows the supplier, bid amount and open findings. Check each finding against its source, then approve the recommendation or return it for clarification. Returned tenders can be updated and reviewed again.",
      },
      {
        kind: "table",
        title: "Available decisions",
        head: ["DECISION", "WHAT IT RECORDS", "WHAT FOLLOWS"],
        rows: [
          ["Approve", "The authorized decision-maker approves the award recommendation.", "The decision, approver and date are added to award history."],
          ["Return for clarification", "The decision-maker records what needs more information.", "The tender returns for follow-up and another review."],
        ],
      },
      {
        kind: "p",
        text: "Only an authorized officer or a listed committee member can record an approval. If Quorum cannot confirm their authority or committee membership, it will not record the decision. Each person must act under their own account.",
      },
      {
        kind: "steps",
        title: "Schedule a committee meeting",
        items: [
          "Open Committee to review the chair, members and attendance status.",
          "Schedule a meeting to record the date and update attendance.",
          "The system checks that enough committee members are present before recording a decision. The default is five of nine.",
          "Once attendance is confirmed, authorized members can review pending decisions.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/approvals.png",
        alt: "The Approvals screen showing decisions awaiting review with supplier, bid amount and findings",
        screen: "WORKSPACE · APPROVALS · CAPTURED 18 OCT 2026",
        caption:
          "The approval list shows each tender awaiting a decision. Review the supporting documents, then approve or return the recommendation. The record identifies who decided.",
      },
      {
        kind: "callout",
        tone: "rule",
        title: "Every decision has an owner",
        text: "REVIEW THE EVIDENCE. APPROVE THE RECOMMENDATION OR RETURN IT FOR CLARIFICATION. THE WORKSPACE RECORDS WHO DECIDED AND WHEN.",
      },
    ],
  },
  {
    id: "zambia",
    kicker: "The law",
    title: "Zambia procurement rules",
    lead: "Quorum's Zambia review checks use the Public Procurement Act No. 8 of 2020, as amended by Act No. 17 of 2023, the Public Procurement Regulations of 2022, and the Public-Private Partnership Act No. 14 of 2009.",
    blocks: [
      {
        kind: "p",
        text: "The procurement method list covers national and international open bidding, limited and simplified bidding, direct awards, electronic reverse auctions, force account, community participation, purchases from other public bodies, privately financed infrastructure, concessions, government-to-government procurement and approved alternative methods. The current legal conditions are shown below.",
      },
      { kind: "methods" },
      {
        kind: "table",
        title: "Information shown for each method",
        head: ["DETAIL", "WHAT IT MEANS"],
        rows: [
          ["Legal basis", "The law and regulations that permit this method."],
          ["Conditions", "Requirements that must be met before using this method."],
          ["Value limit", "The maximum or minimum amount allowed for this procurement method."],
          ["Advertising", "Whether the opportunity must be publicly advertised or sent to invited firms."],
          ["Minimum advertising period", "The minimum time bidders must have to respond under current regulations."],
          ["Who approves the award", "The committee, accounting officer or regulator authorized to approve it."],
        ],
      },
      {
        kind: "callout",
        tone: "law",
        title: "Record why a non-open method is allowed",
        text: "When the law permits a method without open competition, record the applicable legal reason and supporting documents. Urgency must have a clear, documented cause.",
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Alternative methods",
        text: "Get Zambia Public Procurement Authority approval before using a method that is not listed. If the approval is missing, the review will flag it for an authorized officer.",
      },
      {
        kind: "p",
        text: "Supplier registration details help reviewers check which certificates and registrations a bidder must hold. Keep the supplier list up to date.",
      },
    ],
  },
  {
    id: "suppliers",
    kicker: "Suppliers",
    title: "Supplier records",
    lead: "Maintain supplier names, registration details, contact information and status in one workspace list.",
    blocks: [
      {
        kind: "p",
        text: "The supplier list gives officers one place to review bidder details. Tender reviews use these records to check supplier information. Changes, suspensions and removals are recorded with the person and date.",
      },
      {
        kind: "table",
        title: "What each field is for",
        head: ["FIELD", "WHY IT IS COLLECTED"],
        rows: [
          ["Supplier name", "The name that appears on bids — keep the legal spelling on the certificate."],
          ["Registration number", "The PACRA / Registrar of Societies number that identifies the legal entity. Picking a firm off the ZPPA roll fills it as published."],
          ["ZRA Tax PIN", "The Zambia Revenue Authority taxpayer number."],
          ["ZRA Tax Clearance No", "The certificate number a compliant bid must carry."],
          ["Tax clearance expiry", "The certificate's standing. An expired clearance makes a bid non-responsive — the classic check a committee runs first."],
          ["Sector regulator + number", "NCC, NHCC, ERB, ZPPA and similar registrations where the category requires one."],
          ["Categories", "What the firm supplies or the works it executes — the basis for matching a supplier to a tender."],
          ["Contact details", "Who signs for the firm, and how to reach them when a bid needs clarification."],
        ],
      },
      {
        kind: "steps",
        title: "Manage supplier records",
        items: [
          "Add a supplier from the Suppliers page. Enter its legal name and registration number, then add supporting details.",
          "Update records when supplier documents or contact details change. The activity log keeps the update history.",
          "Suspend a supplier while an issue is being reviewed, or mark it as excluded when required.",
          "Remove records created in error. The activity log retains a record of the removal.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/suppliers.png",
        alt: "The Supplier register screen: an empty register with the REGISTER LINKED badge and the REGISTER A SUPPLIER button",
        screen: "WORKSPACE · SUPPLIER REGISTER · CAPTURED 18 OCT 2026",
        caption:
          "The list is empty until suppliers are added. Supplier changes are recorded in the activity log.",
      },
      {
        kind: "p",
        text: "When available, the supplier registration list can fill in published details such as legal name, PACRA number, address, telephone and supply categories. Review those details against current documents before saving them.",
      },
      {
        kind: "figure",
        src: "/docs/zppa-intake.png",
        alt: "The intake dialog: Karibu Pharmaceuticals Limited picked off the ZPPA record, with its PACRA number, contact details and award history filled in",
        screen: "WORKSPACE · SUPPLIER INTAKE · FILLED FROM THE ZPPA RECORD",
        caption:
          "The form can use published supplier details as a starting point. Confirm each field against current supplier documents before saving.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Supplier data source",
        text: "Published supplier information comes from the Zambia Public Procurement Authority's electronic government procurement records, released through the Open Contracting Partnership. Treat published information as a starting point and verify it against current documents.",
      },
      {
        kind: "table",
        title: "Statuses",
        head: ["STATUS", "MEANING"],
        rows: [
          ["Active", "May be considered in tender reviews."],
          ["Suspended", "Temporarily excluded while an issue is reviewed."],
          ["Excluded", "Must not be considered for awards while the exclusion applies."],
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Check supplier registration numbers",
        text: "If a registration number is missing or does not match the required format, verify it with the relevant registry before relying on the bid.",
      },
    ],
  },
  {
    id: "safeguards",
    kicker: "Administration",
    title: "Rules & controls",
    lead: "Review the checks applied to tender documents and bids, including price thresholds, required documents and supplier status.",
    blocks: [
      {
        kind: "table",
        title: "Available review settings",
        head: ["SETTING", "OPTIONS", "WHAT CHANGES"],
        rows: [
          ["Price difference threshold", "15% · 25% · 40%", "Flag bid prices that differ from comparable bids by more than the selected amount."],
          ["Required document checks", "Standard · Strict", "Flag missing documents requested in the tender notice."],
          ["Supplier status check", "On · Off", "Check each bidder against the supplier list and flag suspended or excluded suppliers."],
        ],
      },
      {
        kind: "p",
        text: "Each settings change is recorded in the activity log with its date and the person who made it. New reviews use the current settings.",
      },
      {
        kind: "figure",
        src: "/docs/rules.png",
        alt: "The Rules & controls screen showing price thresholds, required documents and supplier status checks",
        screen: "WORKSPACE · RULES & CONTROLS · CAPTURED 18 OCT 2026",
        caption:
          "The review settings shown here affect future checks. Changes are recorded with the person who made them and the previous and new values.",
      },
      {
        kind: "callout",
        tone: "rule",
        title: "The committee makes the award decision",
        text: "QUORUM SUPPORTS THE REVIEW. AUTHORIZED OFFICERS AND COMMITTEE MEMBERS MAKE AND RECORD THE AWARD DECISION.",
      },
    ],
  },
  {
    id: "evidence",
    kicker: "Sources",
    title: "Documents and data sources",
    lead: "Review tender files and approved public records together. Findings should link to the document or source that supports them.",
    blocks: [
      {
        kind: "p",
        text: "Quorum can review published procurement records, PDFs, spreadsheets and tender documents. Where possible, findings link directly to a source file and page so an officer can verify the information.",
      },
      {
        kind: "steps",
        title: "Review source information",
        items: [
          "Open Source records to see available public datasets, their publishers, coverage, update schedule and last checked date.",
          "Review each source's licence, coverage and publisher links before relying on it.",
          "Check whether a source is reachable and current. The workspace records when it was last checked.",
          "If a publisher stops updating a source, the workspace shows that status so reviewers know the information may be out of date.",
          "Request a source when a needed registry or public dataset is missing.",
        ],
      },
      {
        kind: "figure",
        src: "/docs/sources.png",
        alt: "The Source records screen showing public datasets and their latest check dates",
        screen: "WORKSPACE · SOURCE RECORDS · CAPTURED 18 OCT 2026",
        caption:
          "Source records show which public datasets are available, who publishes them and when they were last checked. Review the source before relying on it.",
      },
      {
        kind: "p",
        text: "Source details come from the publisher and include the coverage period, format, licence and last checked date. The workspace identifies information that is unavailable or has not been verified.",
      },
      {
        kind: "p",
        text: "Administrators can disable a source when it should no longer be used. The source's status and the person who changed it remain in the activity log.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Verify a finding's source",
        text: "Open the linked document and check the cited page, clause or schedule line. If it does not support the finding, return the finding for review.",
      },
    ],
  },
  {
    id: "audit",
    kicker: "Records",
    title: "Activity and decision history",
    lead: "Quorum records who changed a tender, reviewed evidence or approved a decision, and when each action took place.",
    blocks: [
      {
        kind: "table",
        title: "Where to find each record",
        head: ["RECORD", "WHAT IT SHOWS", "WHERE TO FIND IT"],
        rows: [
          ["Activity log", "Account changes, document activity and system actions.", "Records & settings → Activity log."],
          ["Award history", "Award decisions and tenders returned for clarification, with the decision-maker and date.", "Committee → Award history."],
          ["Tender records", "Tender details, supplier information, reviews and supporting documents.", "Open the tender from the workspace."],
        ],
      },
      {
        kind: "p",
        text: "Completed decisions remain in the history. Use the activity log and tender record to confirm who approved a decision, which evidence was available and when each step occurred.",
      },
      {
        kind: "figure",
        src: "/docs/activity.png",
        alt: "The Activity log showing recorded actions, users and dates",
        screen: "RECORDS & SETTINGS · ACTIVITY LOG · CAPTURED 18 OCT 2026",
        caption:
          "The activity log lists recorded actions in order, including the person responsible and the affected record.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Practice",
        text: "Before a committee meeting, open the activity log to review the latest changes and decisions.",
      },
    ],
  },
  {
    id: "roles",
    kicker: "People",
    title: "Roles & permissions",
    lead: "Workspace permissions reflect procurement responsibilities. Each account can take only the actions allowed for its role.",
    blocks: [
      {
        kind: "table",
        title: "Who can do what",
        head: ["ROLE", "CAN", "CANNOT"],
        rows: [
          ["Officer", "Create tender records, add documents, review findings, manage suppliers and take part in committee work.", "Approve decisions beyond their assigned authority."],
          ["Committee member", "Review tender records and make decisions when listed as a committee member.", "Approve a decision if their membership or authority cannot be confirmed."],
          ["Chair", "Lead committee meetings and record decisions within their authority.", "Change completed award history."],
          ["Auditor", "Read tender records, findings, award history and the activity log.", "Change procurement records."],
        ],
      },
      {
        kind: "p",
        text: "The workspace records each decision under the signed-in person's account. Administrators maintain the committee roster and review membership as responsibilities change.",
      },
      {
        kind: "figure",
        src: "/docs/committee.png",
        alt: "The Committee screen showing membership, meeting attendance and approval responsibilities",
        screen: "WORKSPACE · COMMITTEE · CAPTURED 18 OCT 2026",
        caption:
          "Administrators maintain committee membership and record attendance for each meeting. The roster identifies who may take part in committee decisions.",
      },
      {
        kind: "figure",
        src: "/docs/committee-add.png",
        alt: "The add committee member form with name, role and chair options",
        screen: "WORKSPACE · COMMITTEE · REGISTER A MEMBER",
        caption:
          "Add a committee member with their name, role and chair status. Only current members can take part in committee decisions.",
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Use your own account",
        text: "Each decision is recorded under the signed-in person's name. Do not share accounts; the history must identify who made each decision.",
      },
    ],
  },
  {
    id: "glossary",
    kicker: "Reference",
    title: "Terms and common questions",
    lead: "Plain-language definitions for procurement terms used in the workspace.",
    blocks: [
      {
        kind: "terms",
        title: "Glossary",
        items: [
          { term: "Bidder / supplier", def: "The firm offering goods, works or services against a tender." },
          { term: "OCDS", def: "The Open Contracting Data Standard, a format public bodies use to publish procurement records." },
          { term: "Quorum", def: "The minimum number of committee members who must be present to make a decision. The default is five of nine." },
          { term: "Award review period", def: "The legally required period after an award notice when bidders may request a review before the contract is signed." },
          { term: "Minimum advertising period", def: "The shortest time bidders must have to prepare and submit bids." },
          { term: "ZPPA", def: "The Zambia Public Procurement Authority — the regulator, and the approver for alternative methods." },
          { term: "ZRA", def: "The Zambia Revenue Authority — source of the Tax PIN and the Tax Clearance Certificate." },
          { term: "PACRA", def: "The Patents and Companies Registration Agency — where the legal entity's registration number lives." },
          { term: "NCC / NHCC / ERB", def: "Sector registration bodies for construction, health care and energy. A tender may require registration with the relevant body." },
          { term: "LPO", def: "Local Purchase Order, used to confirm a purchase made through simplified bidding." },
          { term: "Tender review", def: "A check of tender documents and bids against published requirements and procurement rules." },
          { term: "Activity log", def: "A dated record of workspace actions and the account responsible." },
        ],
      },
      {
        kind: "terms",
        title: "Questions officers ask",
        items: [
          { term: "Can Quorum award the tender?", def: "No. Quorum prepares review findings and an award recommendation. An authorized officer or committee member makes the decision." },
          { term: "What if a review service is unavailable?", def: "Affected checks pause and the workspace reports that they could not be completed. Try again when service returns or contact your administrator." },
          { term: "A finding is wrong. What should I do?", def: "Open the source document and check the relevant passage. Return the finding with a reason so it can be reviewed." },
          { term: "Where is my data stored?", def: "Your administrator configures document storage and retention for the workspace. Contact them for the applicable policy." },
          { term: "Which jurisdictions are supported?", def: "The current procurement method list covers Zambia's public procurement laws. Confirm the applicable jurisdiction before using a method or rule." },
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "One more thing",
        text: "Use the guided walkthrough to follow the tender process in order. This handbook explains each screen and requirement; the walkthrough helps you complete the steps.",
      },
    ],
  },
];

/* The rule register is rendered from the sidecar's live catalogue; the static
   rows are only the offline fallback. */
function chaptersWithLiveRules(rules: RuleCatalogueRow[] | null): DocChapter[] {
  if (!rules?.length) return DOC_CHAPTERS;
  return DOC_CHAPTERS.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.map((block) =>
      block.kind === "table" && block.title === "The rule register"
        ? {
            ...block,
            title: "The rule register — live thresholds",
            rows: rules.map((rule) => [rule.id, rule.severity, rule.catches, rule.action]),
          }
        : block,
    ),
  }));
}

const DOC_CHAPTER_IDS = DOC_CHAPTERS.map((c) => c.id);

function docChapterText(ch: DocChapter): string {
  return `${ch.title} ${ch.kicker} ${ch.lead} ${JSON.stringify(ch.blocks)}`.toLowerCase();
}

function DocCallout({ tone, title, text }: { tone: DocCalloutTone; title: string; text: string }) {
  if (tone === "rule") {
    return (
      <div className="relative overflow-hidden rounded-[10px] border border-ink-950 bg-night p-5 text-white shadow-[0_18px_45px_rgba(11,12,15,0.25)]">
        <div className="bg-grid-dark pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative">
          <p className="font-code text-[10px] font-bold tracking-[0.06em] text-brand-400">{title.toUpperCase()}</p>
        <p className="mt-2.5 font-code text-[10.5px] leading-relaxed tracking-[0.04em] text-ink-200">{text}</p>
        </div>
      </div>
    );
  }
  const look =
    tone === "law"
      ? { box: "border-ink-200 bg-white", icon: "text-ink-900", label: "text-ink-500", Icon: Gavel }
      : tone === "warn"
        ? { box: "border-brand-200 bg-brand-50", icon: "text-brand-700", label: "text-brand-700", Icon: CircleAlert }
        : { box: "border-ink-100 bg-paper", icon: "text-ink-500", label: "text-ink-500", Icon: BookOpen };
  const Icon = look.Icon;
  return (
    <div className={cn("rounded-xl border px-4 py-3.5", look.box)}>
      <p className={cn("flex items-center gap-2 font-code text-[10px] font-bold tracking-[0.06em]", look.label)}>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", look.icon)} aria-hidden="true" />
        {title.toUpperCase()}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-700">{text}</p>
    </div>
  );
}

/* ── Zambia's method register, live from the engine ──────────────────────── */

type ZMethodRow = {
  id: string;
  name: string;
  legalBasis: string;
  when: string;
  valueBand?: string;
  steps: string[];
  notes: string[];
  awardAuthorisation: string;
  advertising: string;
  floatPeriod?: string;
};

const METHOD_FALLBACK: { name: string; when: string }[] = [
  { name: "Open bidding", when: "Open competition for goods, works and non-consulting services; national or international scope is recorded separately." },
  { name: "Open selection", when: "Open competition for consulting services; national or international scope is recorded separately." },
  { name: "Limited bidding", when: "Goods, works or non-consulting services where the Act permits a limited invitation; prior authority approval is required." },
  { name: "Limited selection", when: "Consulting services where the Act permits a limited invitation; prior authority approval is required." },
  { name: "Direct bidding", when: "Single source: sole availability, emergency, compatibility, or a below-threshold value." },
  { name: "Direct selection", when: "Consulting services from a single consultant where statutory grounds are met." },
  { name: "Simplified bidding", when: "Low-value goods, works or non-consulting services; value threshold is set by the Regulations." },
  { name: "Simplified selection", when: "Low-value consulting services; value threshold is set by the Regulations." },
  { name: "Electronic reverse auction", when: "A defined requirement with measurable monetary criteria and an approved secure e-GP auction." },
  { name: "Force account", when: "The entity builds with its own personnel and equipment." },
  { name: "Community participation", when: "Selected project components engage local communities and NGOs." },
  { name: "Purchases from other procuring entities", when: "A Government agency can meet the requirement and no supplier would offer benefit." },
  { name: "Private-financed infrastructure / concessions (PPP)", when: "Procurement of infrastructure from private financing and award of concessions under the applicable PPP framework." },
  { name: "Government-to-government procurement", when: "Procurement from a foreign State under an agreement with the Republic." },
  { name: "Alternative method (ZPPA approval required)", when: "A method outside the listed routes, only with the Authority's prior approval." },
];

function DocMethodsBoard() {
  const [methods, setMethods] = useState<ZMethodRow[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/methods?XTransformPort=3031")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { ZM?: ZMethodRow[] }) => {
        if (alive) setMethods(d.ZM ?? []);
      })
      .catch(() => {
        if (alive) setOffline(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!methods && !offline) {
    return (
      <div className="space-y-3" aria-label="Loading the method register">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-[10px] bg-ink-50" />
        ))}
      </div>
    );
  }

  if (offline || !methods || methods.length === 0) {
    return (
      <div className="rounded-[10px] border border-brand-200 bg-brand-50 p-5">
        <p className="flex items-center gap-2 font-code text-[10px] font-bold tracking-[0.06em] text-brand-800">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Method details are temporarily unavailable
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-700">
          The list could not be refreshed. Common procurement methods and their legal conditions are summarized below:
        </p>
        <ul className="mt-3 space-y-2">
          {METHOD_FALLBACK.map((m) => (
            <li key={m.name} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-700">
              <span className="text-brand-600" aria-hidden="true">▸</span>
              <span>
                <span className="font-semibold text-ink-900">{m.name} — </span>
                {m.when}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {methods.map((m) => (
        <div key={m.id} className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-ink-950">{m.name}</h4>
              <p className="mt-1 font-code text-[10px] tracking-[0.04em] text-ink-600">{m.legalBasis.toUpperCase()}</p>
            </div>
            {m.valueBand && (
              <span className="inline-flex min-h-8 items-center rounded-full border border-ink-200 bg-paper px-3 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700">
                {m.valueBand.toUpperCase()}
              </span>
            )}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-700">{m.when}</p>

          <details className="mt-3 border-t border-ink-100 pt-3">
            <summary className="focus-brand inline-flex min-h-11 cursor-pointer select-none items-center rounded font-code text-[10px] font-bold tracking-[0.04em] text-ink-700">
              THE PROCESS, IN ORDER
            </summary>
            <ol className="mt-2.5 space-y-2">
              {m.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-700">
                  <span className="shrink-0 font-code text-[10px] font-bold text-brand-700">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">{s}</span>
                </li>
              ))}
            </ol>
          </details>

          {m.notes.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-ink-100 pt-3">
              {m.notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-500">
                  <span className="shrink-0 text-brand-600" aria-hidden="true">▸</span>
                  <span className="min-w-0">{n}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-ink-100 pt-3 sm:grid-cols-3">
            <div>
              <dt className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-600">AWARD AUTHORISATION</dt>
              <dd className="mt-1 text-[11.5px] leading-snug text-ink-700">{m.awardAuthorisation}</dd>
            </div>
            <div>
              <dt className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-600">ADVERTISING</dt>
              <dd className="mt-1 text-[11.5px] leading-snug text-ink-700">{m.advertising}</dd>
            </div>
            <div>
              <dt className="font-code text-[10px] font-bold tracking-[0.04em] text-ink-600">FLOAT PERIOD</dt>
              <dd className="mt-1 text-[11.5px] leading-snug text-ink-700">{m.floatPeriod ?? "—"}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

/* One block of handbook prose, rendered by kind. */
function DocBlockView({ block, onOpenShot }: { block: DocBlock; onOpenShot?: (fig: DocFigure) => void }) {
  switch (block.kind) {
    case "p":
      return <p className="text-[13.5px] leading-relaxed text-ink-700">{block.text}</p>;
    case "callout":
      return <DocCallout tone={block.tone} title={block.title} text={block.text} />;
    case "figure":
      return (
        <figure data-doc-figure={block.src}>
          <button
            type="button"
            onClick={() => onOpenShot?.({ src: block.src, alt: block.alt, caption: block.caption, screen: block.screen })}
            aria-label={`Open the full screenshot — ${block.alt}`}
            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-ink-100 bg-ink-950 text-left shadow-[0_1px_2px_rgba(11,12,15,0.05)] transition-shadow hover:shadow-[0_14px_36px_rgba(11,12,15,0.16)]"
          >
            <img src={block.src} alt={block.alt} loading="lazy" className="block w-full" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-ink-950/90 via-ink-950/45 to-transparent px-3.5 pb-2.5 pt-9">
              <span className="min-w-0 truncate font-code text-[10px] font-bold tracking-[0.04em] text-white/85">
                {block.screen}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-1 font-code text-[10px] font-bold tracking-[0.04em] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Maximize2 className="h-2.5 w-2.5" aria-hidden="true" />
                EXPAND
              </span>
            </span>
          </button>
          <figcaption className="mt-2.5 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-500">
            <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
            <span className="min-w-0">{block.caption}</span>
          </figcaption>
        </figure>
      );
    case "steps":
      return (
        <div>
          {block.title && (
            <p className="mb-3 font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
              {block.title.toUpperCase()}
            </p>
          )}
          <ol className="space-y-2.5">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-ink-700">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ink-200 font-code text-[10px] font-bold text-ink-700">
                  {i + 1}
                </span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "table":
      return (
        <div>
          {block.title && (
            <p className="mb-3 font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
              {block.title.toUpperCase()}
            </p>
          )}
          <HorizontalScrollRegion label={`${block.title ?? "Handbook comparison"} table`} className="rounded-xl border border-ink-100">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-100 bg-paper">
                  {block.head.map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-code text-[10px] font-bold tracking-[0.04em] text-ink-700">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i} className="border-b border-ink-50 last:border-b-0">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={cn(
                          "px-4 py-3.5 align-top text-[12.5px] leading-relaxed",
                          j === 0 ? "font-semibold text-ink-950" : "text-ink-600",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </HorizontalScrollRegion>
        </div>
      );
    case "terms":
      return (
        <div>
          {block.title && (
            <p className="mb-3 font-code text-[10px] font-semibold tracking-[0.06em] text-ink-600">
              {block.title.toUpperCase()}
            </p>
          )}
          <dl className="divide-y divide-ink-50 rounded-xl border border-ink-100">
            {block.items.map((t) => (
              <div key={t.term} className="px-4 py-3.5">
                <dt className="font-code text-[10px] font-bold tracking-[0.14em] text-ink-900">{t.term.toUpperCase()}</dt>
                <dd className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{t.def}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "methods":
      return <DocMethodsBoard />;
    default:
      return null;
  }
}

/* The walkthrough's final chapter runs on this page: /docs?tour=1 lands here
   and starts it, so the handbook is toured like every other screen. */
const DOC_TOUR: TourStep[] = [
  {
    target: "docs-search",
    title: "Search jumps to the point",
    body: "Type a rule code (R-OVER-BUDGET), a method, or a field name — the chapters and the rail filter as you type.",
  },
  {
    target: "docs-rail",
    title: "Read in order, or aim",
    body: "This menu follows the chapter you are reading. Each chapter explains the relevant workspace pages, requirements and decisions.",
  },
  {
    target: "docs-chapters",
    title: "The full handbook",
    body: "Read about the tender review process, committee approvals, supplier records and Zambia's procurement rules.",
  },
];

export function DocumentationView() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(DOC_CHAPTERS[0].id);
  const [tourStep, setTourStep] = useState<number | null>(null);
  /* The enlarged shot — set by a figure, cleared by Escape or a click away. */
  const [shot, setShot] = useState<DocFigure | null>(null);
  const shotCloseRef = useRef<HTMLButtonElement | null>(null);
  const shotDialogRef = useRef<HTMLElement | null>(null);
  /* The rule register is server truth. If the sidecar is unreachable the
     static rows remain, clearly labelled as defaults. */
  const [liveRules, setLiveRules] = useState<RuleCatalogueRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/rule-catalogue?XTransformPort=3031")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { rules?: RuleCatalogueRow[] } | null) => {
        if (alive && Array.isArray(data?.rules) && data.rules.length) setLiveRules(data.rules);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* Focus moves into the lightbox; Escape hands the desk back — and the
     reader's focus returns to the figure that opened it. */
  useEffect(() => {
    if (!shot) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = window.setTimeout(() => shotCloseRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShot(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [shot]);

  /* Arriving from the walkthrough's final chapter — /docs?tour=1. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tour") !== "1") return;
    const id = window.setTimeout(() => setTourStep(0), 500);
    return () => window.clearTimeout(id);
  }, []);

  const endTour = () => {
    setTourStep(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tour");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const chapters = useMemo(() => chaptersWithLiveRules(liveRules), [liveRules]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? chapters.filter((ch) => docChapterText(ch).includes(q)) : chapters),
    [q, chapters],
  );

  /* Scroll-spy: keep the chapter rail honest while the officer reads. */
  useEffect(() => {
    if (q) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.id) setActiveId(top.target.id.replace(/^docs-/, ""));
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const id of DOC_CHAPTER_IDS) {
      const el = document.getElementById(`docs-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [q]);

  /* A link may arrive already aimed — "/docs#docs-safeguards" from the Rules page. */
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "").replace(/^docs-/, "");
    if (!hash || !DOC_CHAPTER_IDS.includes(hash)) return;
    const id = window.setTimeout(() => {
      setActiveId(hash);
      document.getElementById(`docs-${hash}`)?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
    }, 60);
    return () => window.clearTimeout(id);
  }, []);

  const jumpTo = (id: string) => {
    setActiveId(id);
    document.getElementById(`docs-${id}`)?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2.5 font-code text-[10px] font-semibold uppercase tracking-[0.3em] text-ink-500">
            <span className="inline-block h-[2px] w-6 bg-brand-600" aria-hidden="true" />
            {chapters.length} CHAPTERS · THE COMPLETE HANDBOOK
          </p>
          <h1 className="type-display mt-5 text-[30px] text-ink-950 sm:text-[38px]">
            Documentation<span className="text-brand-600">.</span>
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-600">
            Learn how to prepare a tender review, verify findings, record decisions and manage supplier information.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
        {/* The chapter rail */}
        <nav aria-label="Documentation chapters" data-tour="docs-rail" className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-4 shadow-[0_1px_2px_rgba(11,12,15,0.04)]">
            <label data-tour="docs-search" className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the handbook…"
                aria-label="Search the handbook"
                className="focus-brand h-11 w-full rounded-full border border-ink-200 bg-paper pl-9 pr-3 text-[14px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10 dark:placeholder:text-ink-400"
              />
            </label>
            {q && (
              <p className="mt-2 px-1 font-code text-[10px] tracking-[0.04em] text-ink-600">
                {visible.length} OF {chapters.length} CHAPTERS MATCH
              </p>
            )}
            <ul className="mt-3 max-h-[62vh] space-y-0.5 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">
              {(q ? visible : chapters).map((ch) => {
                const idx = chapters.indexOf(ch);
                const isActive = !q && activeId === ch.id;
                return (
                  <li key={ch.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(ch.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "focus-brand flex min-h-11 w-full items-baseline gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                        isActive ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-paper hover:text-ink-950",
                      )}
                    >
                      <span
                        className={cn(
                          "font-code text-[10px] font-bold tracking-[0.04em]",
                          isActive ? "text-brand-400" : "text-ink-500",
                        )}
                      >
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{ch.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {q && visible.length === 0 && (
              <p className="mt-3 rounded-lg bg-paper px-3 py-2.5 text-[12px] leading-relaxed text-ink-500">
                Nothing matches. Try a rule code (R-OVER-BUDGET), a method, or a field name.
              </p>
            )}
          </div>

          <p className="mt-3 px-2 font-code text-[10px] leading-relaxed tracking-[0.04em] text-ink-600">
            {chapters.length} chapters · aligned with the current workspace
          </p>
        </nav>

        {/* The chapters */}
        <div data-tour="docs-chapters" className="min-w-0 space-y-5">
          {(q ? visible : chapters).map((ch) => {
            const no = String(chapters.indexOf(ch) + 1).padStart(2, "0");
            return (
              <article
                key={ch.id}
                id={`docs-${ch.id}`}
                className="scroll-mt-24 rounded-[12px] border border-ink-200/70 bg-white dark:border-white/10 p-5 shadow-[0_1px_2px_rgba(11,12,15,0.04)] sm:p-7"
              >
                <p className="flex items-center gap-2.5 font-code text-[10px] font-bold tracking-[0.26em] text-brand-700">
                  <span className="inline-block h-[2px] w-5 bg-brand-600" aria-hidden="true" />
                  CHAPTER {no} · {ch.kicker.toUpperCase()}
                </p>
                <h2 className="type-display mt-3 text-[22px] text-ink-950 sm:text-[26px]">
                  {ch.title}
                </h2>
                <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-600">{ch.lead}</p>
                <div className="mt-6 space-y-5">
                  {ch.blocks.map((b, i) => (
                    <DocBlockView key={i} block={b} onOpenShot={setShot} />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* The enlarged screenshot — click any figure to read it at full size. */}
      <AnimatePresence>
        {shot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setShot(null)}
            role="dialog"
            aria-modal="true"
            aria-label={shot.alt}
            className="fixed inset-0 z-[80] grid place-items-center bg-ink-950/85 p-4 backdrop-blur-sm sm:p-8"
          >
            <motion.figure
              ref={shotDialogRef}
              tabIndex={-1}
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(event) => trapTabFocus(event, shotDialogRef.current)}
              className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-[10px] border border-white/10 bg-ink-950 shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <p className="min-w-0 truncate font-code text-[10px] font-bold tracking-[0.04em] text-ink-200">
                  {shot.screen}
                </p>
                <button
                  type="button"
                  ref={shotCloseRef}
                  onClick={() => setShot(null)}
                  aria-label="Close the screenshot"
                  className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-200 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 overflow-auto bg-paper">
                <img src={shot.src} alt={shot.alt} className="block w-full" />
              </div>
              <figcaption className="border-t border-white/10 px-4 py-3 text-[12px] leading-relaxed text-ink-300">
                {shot.caption}
              </figcaption>
            </motion.figure>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The walkthrough's final chapter — a spotlight layer on the handbook. */}
      {tourStep !== null && (
        <TourLayer
          chapterNo={15}
          chapterTotal={15}
          chapterTitle="Read the documentation"
          steps={DOC_TOUR}
          index={Math.min(tourStep, DOC_TOUR.length - 1)}
          onIndex={setTourStep}
          onClose={endTour}
          onFinish={endTour}
        />
      )}
    </div>
  );
}

