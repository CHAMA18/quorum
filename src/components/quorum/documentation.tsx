"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  CircleAlert,
  ClipboardCheck,
  Code2,
  Gavel,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Maximize2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  | { kind: "resource"; href: string; label: string; title: string; text: string }
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
    id: "model-evidence",
    kicker: "AI and evidence",
    title: "AI assistance, citations & human control",
    lead: "Quorum combines explicit checks with optional model assistance. Reviewers verify sources, record the outcome and retain responsibility for every decision.",
    blocks: [
      {
        kind: "p",
        text: "A model can help plan a comparison, surface a passage or draft a redline when the configured service responds. It does not set official weighted scores or select an award. The report for each run identifies which path answered, including the returned model name, latency and token use when available.",
      },
      {
        kind: "table",
        title: "How to read an AI-assisted result",
        head: ["LAYER", "WHAT IT DOES", "WHAT YOU STILL VERIFY"],
        rows: [
          ["Rule checks", "Apply recorded checks for requirements such as missing documents, budget limits and specified thresholds.", "Confirm the rule matches the tender and the extracted values are correct."],
          ["Muse Spark 1.3, when configured", "Can assist with planning, bidder comparison and drafting a committee redline.", "Check the run report, source documents and the exact claim before using the draft."],
          ["Fallback path", "A configured in-region model may answer when the hosted service is unavailable; a deterministic template may be used if model calls fail.", "Read the report's model source. A template is not a model analysis."],
          ["Quote matching", "Can confirm that quoted text appears in the selected source document.", "A text match does not prove the passage supports the conclusion or legal interpretation."],
          ["Human review", "An officer verifies findings; an authorised committee member records the decision.", "Check authority, applicable rules and the full procurement file."],
        ],
      },
      {
        kind: "steps",
        title: "Before relying on a model-assisted finding",
        items: [
          "Open the cited source and confirm the document, page, clause or schedule line.",
          "Read enough surrounding context to confirm the quotation means what the finding says.",
          "Check any deadline, exception or legal procedure against the tender and current law.",
          "Record whether the finding is confirmed, corrected or needs another review, with your reason.",
        ],
      },
      {
        kind: "callout",
        tone: "rule",
        title: "A citation is a place to verify",
        text: "A source link helps you inspect a claim. It does not make the claim correct, and generated text never replaces the committee's own review.",
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Check proposed procedure before adopting it",
        text: "A generated cure period, exception or legal route must be grounded in the tender and applicable law. Do not apply it solely because it appears in a draft.",
      },
      {
        kind: "resource",
        href: "/api",
        label: "DEVELOPER REFERENCE",
        title: "Explore the API directory",
        text: "See the published API surfaces, authentication requirements and live readiness checks.",
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
    id: "supplier-portal",
    kicker: "Supplier portal",
    title: "Register and submit as a supplier",
    lead: "The supplier portal gives organizations a separate account space to maintain their profile, find opportunities and submit tender applications.",
    blocks: [
      {
        kind: "callout",
        tone: "tip",
        title: "A separate account space",
        text: "Supplier sign-in is separate from officer workspace access. Use the supplier portal for organization profiles and applications; officers manage the procuring entity's review record.",
      },
      {
        kind: "steps",
        title: "From organization profile to application",
        items: [
          "Open the supplier portal and register the organization with its legal identity, registration details and contact person.",
          "Complete the profile with the statutory documents and capabilities requested by the portal.",
          "Review published opportunities, their requirements and closing dates before preparing an application.",
          "Submit one complete application for the tender before its closing time, then keep the receipt for your records.",
          "Return to the portal to follow the application's status and respond to permitted follow-up requests.",
        ],
      },
      {
        kind: "table",
        title: "Application checks",
        head: ["CHECK", "PORTAL BEHAVIOUR", "WHAT THE SUPPLIER SHOULD DO"],
        rows: [
          ["Closing time", "Late applications are refused.", "Allow time to upload files and submit before the published deadline."],
          ["One application per tender", "A second application for the same organization and tender is refused.", "Review the complete application before sending it."],
          ["Organization status", "Suspended or excluded organizations cannot submit new applications.", "Contact the procuring entity about the status shown in the portal."],
          ["Application receipt", "A submitted application is recorded against the organization account.", "Save the receipt and reference for your procurement records."],
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "The portal does not make an award",
        text: "Submission records delivery of an application. The procuring entity's authorised officers and committee evaluate bids and record the decision.",
      },
      {
        kind: "resource",
        href: "/org",
        label: "SUPPLIER PORTAL",
        title: "Open supplier sign-in",
        text: "Go to the organization account space to register, sign in or review an application.",
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
  const chapters = !rules?.length ? DOC_CHAPTERS : DOC_CHAPTERS.map((chapter) => ({
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
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  return DOC_CHAPTER_ORDER.flatMap((id) => {
    const chapter = byId.get(id);
    return chapter ? [chapter] : [];
  });
}

const DOC_CHAPTER_ORDER = [
  "start",
  "pipeline",
  "launch",
  "findings",
  "model-evidence",
  "gates",
  "suppliers",
  "supplier-portal",
  "evidence",
  "audit",
  "roles",
  "safeguards",
  "control",
  "zambia",
  "glossary",
];

const DOC_CHAPTER_IDS: string[] = DOC_CHAPTER_ORDER;

const DOC_NAV_GROUPS = [
  { label: "START HERE", ids: ["start", "pipeline", "launch"] },
  { label: "REVIEW THE FILE", ids: ["findings", "model-evidence", "evidence"] },
  { label: "PEOPLE & DECISIONS", ids: ["gates", "roles", "audit"] },
  { label: "SUPPLIERS", ids: ["suppliers", "supplier-portal"] },
  { label: "ADMINISTRATION", ids: ["safeguards", "control", "zambia"] },
  { label: "REFERENCE", ids: ["glossary"] },
] as const;

type DocPath = {
  audience: string;
  title: string;
  description: string;
  action: string;
  target: string | null;
  href: string | null;
  icon: LucideIcon;
};

const DOC_PATHS: DocPath[] = [
  {
    audience: "PROCUREMENT OFFICER",
    title: "Prepare a review",
    description: "Set up the file, check bids and resolve evidence findings.",
    action: "Follow the review path",
    target: "pipeline",
    href: null,
    icon: ClipboardCheck,
  },
  {
    audience: "COMMITTEE MEMBER",
    title: "Make a recorded decision",
    description: "Verify the file, confirm authority and record an outcome.",
    action: "Open the decision guide",
    target: "gates",
    href: null,
    icon: Gavel,
  },
  {
    audience: "SUPPLIER",
    title: "Submit an application",
    description: "Register your organization and respond to an opportunity.",
    action: "Read the supplier guide",
    target: "supplier-portal",
    href: null,
    icon: Building2,
  },
  {
    audience: "WORKSPACE ADMIN",
    title: "Set the controls",
    description: "Review roles, rules, readiness and operational boundaries.",
    action: "Review administration",
    target: "control",
    href: null,
    icon: ShieldCheck,
  },
  {
    audience: "DEVELOPER",
    title: "Connect to Quorum",
    description: "Inspect API surfaces, access requirements and service checks.",
    action: "Open API reference",
    target: null,
    href: "/api",
    icon: Code2,
  },
];

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
    case "resource":
      return (
        <a
          href={block.href}
          className="group flex min-h-11 flex-wrap items-center justify-between gap-4 rounded-xl border border-ink-200 bg-sand/65 px-4 py-4 transition-colors hover:border-ink-400 hover:bg-sand focus-brand"
        >
          <span className="min-w-0">
            <span className="block font-code text-[9px] font-bold tracking-[0.12em] text-brand-700">{block.label}</span>
            <span className="mt-1 block text-[14px] font-bold text-ink-950">{block.title}</span>
            <span className="mt-1 block max-w-2xl text-[12px] leading-relaxed text-ink-600">{block.text}</span>
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </a>
      );
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
    body: "Search a workflow, rule, role or field name. Matching chapters appear as you type.",
  },
  {
    target: "docs-rail",
    title: "Read in order, or aim",
    body: "Browse by workflow, evidence, decisions, suppliers or administration. The current chapter stays highlighted as you read.",
  },
  {
    target: "docs-chapters",
    title: "The full handbook",
    body: "Use the handbook for practical workflows, supplier applications, AI boundaries, committee decisions and reference material.",
  },
];

export function DocumentationView() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState("start");
  const [tourStep, setTourStep] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement && (
        target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      );
      const commandSearch = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slashSearch = event.key === "/" && !isEditing;
      if (commandSearch || slashSearch) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchRef.current) {
        if (query) setQuery("");
        else searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [query]);

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

  const navChapters = q ? visible : chapters;
  const navGroups = DOC_NAV_GROUPS.map((group) => ({
    label: group.label,
    chapters: group.ids.flatMap((id) => navChapters.filter((chapter) => chapter.id === id)),
  })).filter((group) => group.chapters.length > 0);

  return (
    <div className="space-y-12">
      <section
        aria-labelledby="docs-title"
        className="relative isolate overflow-hidden rounded-[26px] bg-[#0b1017] text-white shadow-[0_28px_80px_rgba(11,16,23,0.18)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-grid-dark opacity-50" aria-hidden="true" />
        <div
          className="pointer-events-none absolute -right-36 -top-48 h-[520px] w-[520px] rounded-full blur-[150px]"
          style={{ background: "radial-gradient(circle, rgba(217,38,22,0.27), transparent 68%)" }}
          aria-hidden="true"
        />
        <div className="relative grid gap-8 p-6 sm:p-9 lg:grid-cols-[minmax(0,1.08fr)_minmax(330px,0.92fr)] lg:gap-12 lg:p-11">
          <div className="flex min-w-0 flex-col justify-center">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-2 font-code text-[9px] font-bold tracking-[0.19em] text-ink-300">
              <span className="inline-flex items-center gap-2 text-brand-300">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                QUORUM FIELD GUIDE
              </span>
              <span className="text-white/25" aria-hidden="true">/</span>
              <span>{chapters.length} CHAPTERS</span>
              <span className="text-white/25" aria-hidden="true">/</span>
              <span>FOR EVERY ROLE</span>
            </p>
            <h1 id="docs-title" className="type-display mt-6 max-w-3xl text-[clamp(2.55rem,5.5vw,4.65rem)] text-white">
              Understand the file.<br />
              Defend the <span className="text-brand-400">decision.</span>
            </h1>
            <p className="type-lede mt-5 max-w-2xl text-[14px] text-ink-300 sm:text-[15px]">
              Practical guidance for preparing tender reviews, checking source evidence, using AI responsibly, working with suppliers and recording committee decisions.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => jumpTo("pipeline")}
                className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-[12px] font-bold text-white shadow-[0_10px_24px_rgba(217,38,22,0.25)] transition-colors hover:bg-brand-500"
              >
                Follow a tender review <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <a
                href="/api"
                className="focus-brand inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.045] px-4 text-[12px] font-semibold text-ink-100 transition-colors hover:bg-white/10"
              >
                API reference <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <button
              type="button"
              onClick={() => searchRef.current?.focus()}
              className="focus-brand mt-7 flex min-h-12 w-full max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-white/[0.055] px-3.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.08]"
              aria-label="Focus handbook search"
            >
              <Search className="h-4 w-4 shrink-0 text-ink-300" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-300">Search workflows, rules, roles and fields</span>
              <kbd className="shrink-0 rounded-md border border-white/15 bg-black/15 px-2 py-1 font-code text-[9px] text-ink-200">⌘ / Ctrl K</kbd>
            </button>
          </div>

          <div className="relative self-center rounded-[20px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-sm sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="font-code text-[9px] font-bold tracking-[0.16em] text-brand-300">THE PROCUREMENT RECORD</p>
                <h2 className="mt-1.5 text-[16px] font-bold tracking-tight text-white">From requirement to accountable action</h2>
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 font-code text-[9px] font-bold tracking-[0.06em] text-ink-300">4 MOVES</span>
            </div>
            <div className="relative mt-2">
              <span className="absolute bottom-6 left-[17px] top-6 w-px bg-gradient-to-b from-brand-400/80 via-white/20 to-emerald-300/70" aria-hidden="true" />
              <ol>
                {[
                  { n: "01", title: "Published requirement", detail: "Notice · specification · criteria" },
                  { n: "02", title: "Source-linked finding", detail: "Document · passage · reviewer check" },
                  { n: "03", title: "Human review", detail: "Confirm · correct · request clarification" },
                  { n: "04", title: "Recorded decision", detail: "Authorised person · reason · time" },
                ].map((step) => (
                  <li key={step.n} className="relative flex gap-3.5 py-3">
                    <span className="z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-[#121923] font-code text-[9px] font-bold text-brand-300">
                      {step.n}
                    </span>
                    <span className="min-w-0 pt-0.5">
                      <span className="block text-[12px] font-semibold text-white">{step.title}</span>
                      <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-400">{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-4">
              {[
                ["SOURCE-LED", "text-brand-200"],
                ["ROLE-BOUND", "text-sky-200"],
                ["HUMAN-DECIDED", "text-emerald-200"],
              ].map(([label, color]) => (
                <span key={label} className={cn("rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1.5 font-code text-[8px] font-bold tracking-[0.08em]", color)}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="docs-paths-title">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-code text-[9px] font-bold tracking-[0.18em] text-brand-700">CHOOSE YOUR PATH</p>
            <h2 id="docs-paths-title" className="type-display mt-2 text-[26px] text-ink-950 sm:text-[32px]">Start with the work in front of you.</h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-600">{DOC_PATHS.length} clear entry points into the handbook, based on what you need to do.</p>
          </div>
          <span className="hidden items-center gap-2 pb-1 font-code text-[9px] font-semibold tracking-[0.08em] text-ink-500 md:inline-flex">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> SEARCHABLE · ROLE-BASED · SOURCE-AWARE
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {DOC_PATHS.map((path, i) => {
            const Icon = path.icon;
            const card = (
              <>
                <span className="flex items-center justify-between gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-ink-200 bg-paper text-ink-800 transition-colors group-hover:border-brand-200 group-hover:bg-brand-50 group-hover:text-brand-700">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="font-code text-[9px] font-bold tracking-[0.12em] text-ink-500">0{i + 1}</span>
                </span>
                <span className="mt-5 block font-code text-[8px] font-bold tracking-[0.1em] text-brand-700">{path.audience}</span>
                <span className="mt-1.5 block text-[15px] font-bold leading-snug tracking-tight text-ink-950">{path.title}</span>
                <span className="mt-2 block min-h-[54px] text-[11.5px] leading-relaxed text-ink-600">{path.description}</span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-800 transition-colors group-hover:text-brand-700">
                  {path.action} <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </>
            );
            const cardClass = "group flex min-h-[222px] flex-col rounded-2xl border border-ink-200/80 bg-white p-4 text-left shadow-[0_1px_2px_rgba(11,12,15,0.035)] transition-all hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-[0_14px_30px_rgba(11,12,15,0.08)] focus-brand";
            return path.href ? (
              <a key={path.audience} href={path.href} className={cardClass}>{card}</a>
            ) : (
              <button key={path.audience} type="button" onClick={() => path.target && jumpTo(path.target)} className={cardClass}>{card}</button>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-ink-200/80 bg-sand/65 px-4 py-4 sm:px-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-sm">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-ink-950">A guide to the work—and its limits.</p>
          <p className="mt-1 max-w-4xl text-[11.5px] leading-relaxed text-ink-600">
            Several interface screenshots are historical captures and are labeled in their captions. Procurement rules vary by jurisdiction and change over time; verify the current law and your entity's approved process before acting.
          </p>
        </div>
        <span className="hidden self-center font-code text-[8px] font-bold tracking-[0.1em] text-ink-500 lg:inline">{chapters.length} CHAPTERS · ONE HANDBOOK</span>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Documentation chapters" data-tour="docs-rail" className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-ink-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(11,12,15,0.045)]">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div>
                <p className="font-code text-[9px] font-bold tracking-[0.13em] text-ink-800">HANDBOOK INDEX</p>
                <p className="mt-1 text-[10px] text-ink-500">{chapters.length} chapters · {DOC_PATHS.length} paths</p>
              </div>
              <span className="rounded-md border border-ink-200 bg-paper px-2 py-1 font-code text-[8px] font-semibold text-ink-500">⌘K</span>
            </div>
            <label data-tour="docs-search" className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && visible[0]) jumpTo(visible[0].id);
                }}
                placeholder="Search the handbook…"
                aria-label="Search chapters, rules and workflows"
                aria-controls="docs-chapters"
                className="focus-brand h-11 w-full rounded-xl border border-ink-200 bg-paper pl-9 pr-3 text-[12px] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-950 focus:ring-2 focus:ring-ink-950/10"
              />
            </label>
            {q && (
              <p className="mt-2 px-1 font-code text-[9px] tracking-[0.04em] text-ink-600" aria-live="polite">
                {visible.length} OF {chapters.length} CHAPTERS MATCH
              </p>
            )}
            <ul className="mt-4 max-h-[58vh] space-y-4 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">
              {navGroups.map((group) => (
                <li key={group.label}>
                  <p className="mb-1.5 px-2 font-code text-[8px] font-bold tracking-[0.12em] text-ink-400">{group.label}</p>
                  <ul className="space-y-0.5">
                    {group.chapters.map((ch) => {
                      const idx = chapters.indexOf(ch);
                      const isActive = !q && activeId === ch.id;
                      return (
                        <li key={ch.id}>
                          <button
                            type="button"
                            onClick={() => jumpTo(ch.id)}
                            aria-current={isActive ? "location" : undefined}
                            className={cn(
                              "focus-brand flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                              isActive ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-paper hover:text-ink-950",
                            )}
                          >
                            <span className={cn("font-code text-[9px] font-bold tracking-[0.04em]", isActive ? "text-brand-400" : "text-ink-400")}>
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 flex-1 text-[11px] font-medium leading-snug">{ch.title}</span>
                            {isActive ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            {q && visible.length === 0 && (
              <div className="mt-3 rounded-xl bg-paper px-3 py-3">
                <p className="text-[11px] leading-relaxed text-ink-600">No chapter matches yet. Try a rule, page name or procurement term.</p>
                <button type="button" onClick={() => setQuery("")} className="focus-brand mt-2 inline-flex min-h-9 items-center text-[10px] font-semibold text-brand-700">Clear search</button>
              </div>
            )}
          </div>
          <a href="/api" className="focus-brand mt-3 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-ink-200/80 bg-white px-3.5 text-[10.5px] font-semibold text-ink-700 transition-colors hover:border-ink-300 hover:text-ink-950">
            <span className="inline-flex items-center gap-2"><Code2 className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" /> API directory</span>
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </nav>

        <section id="docs-chapters" data-tour="docs-chapters" aria-label="Handbook chapters" className="min-w-0 space-y-5">
          {q && visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink-300 bg-white px-6 py-10 text-center sm:px-10">
              <Search className="mx-auto h-5 w-5 text-ink-400" aria-hidden="true" />
              <h2 className="mt-3 text-[16px] font-bold text-ink-950">No chapter found for “{query.trim()}”</h2>
              <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-ink-600">Try a term such as “committee”, “supplier”, “source”, “Zambia” or a rule name.</p>
              <button type="button" onClick={() => setQuery("")} className="focus-brand mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink-950 px-3.5 text-[11px] font-semibold text-white hover:bg-ink-800">Show all chapters</button>
            </div>
          ) : (q ? visible : chapters).map((ch) => {
            const no = String(chapters.indexOf(ch) + 1).padStart(2, "0");
            return (
              <article
                key={ch.id}
                id={`docs-${ch.id}`}
                className="scroll-mt-24 rounded-2xl border border-ink-200/80 bg-white p-5 shadow-[0_4px_16px_rgba(11,12,15,0.035)] sm:p-7 lg:p-8"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-2.5 font-code text-[9px] font-bold tracking-[0.17em] text-brand-700">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-[9px] text-brand-700">{no}</span>
                    {ch.kicker.toUpperCase()}
                  </p>
                  <span className="rounded-full border border-ink-100 bg-paper px-2.5 py-1 font-code text-[8px] font-semibold tracking-[0.08em] text-ink-500">FIELD GUIDE</span>
                </div>
                <h2 className="type-display mt-4 text-[23px] text-ink-950 sm:text-[28px]">{ch.title}</h2>
                <p className="type-lede mt-3 max-w-3xl text-[12.5px] text-ink-600 sm:text-[13px]">{ch.lead}</p>
                <div className="mt-6 space-y-5 border-t border-ink-100 pt-6">
                  {ch.blocks.map((b, i) => (
                    <DocBlockView key={i} block={b} onOpenShot={setShot} />
                  ))}
                </div>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
                  <span className="font-code text-[8px] font-semibold tracking-[0.11em] text-ink-400">QUORUM · {no} / {String(chapters.length).padStart(2, "0")}</span>
                  {chapters[chapters.indexOf(ch) + 1] ? (
                    <button type="button" onClick={() => jumpTo(chapters[chapters.indexOf(ch) + 1].id)} className="focus-brand inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-[10.5px] font-semibold text-ink-700 transition-colors hover:text-brand-700">
                      Next: {chapters[chapters.indexOf(ch) + 1].title} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
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

