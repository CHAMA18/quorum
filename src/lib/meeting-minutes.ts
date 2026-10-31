/**
 * Meeting minutes — the shapes and the honest fallback.
 *
 * The Meta agent drafts the minutes; this module holds the contract and the
 * deterministic draft that runs when no model is configured or the model's
 * reply cannot be trusted. Both paths read only the transcript that was
 * captured — nothing here invents a decision, an owner or a deadline.
 */

export interface MeetingAction {
  owner: string;
  action: string;
  due: string | null;
}

export interface MeetingMinutes {
  summary: string;
  decisions: string[];
  actions: MeetingAction[];
  attendees: string[];
  quotes: string[];
}

export interface MeetingForNotes {
  id: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  scheduledBy: string;
  attendees: { name: string }[];
}

/* The wire shape the desk reads — dates are ISO strings, never Date objects. */
export interface MeetingNotePayload {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingStartsAt: string;
  agenda: string | null;
  createdBy: string;
  createdAt: string;
  provider: "meta" | "local";
  model: string;
  transcript: string;
  minutes: MeetingMinutes;
}

const DECISION_RE =
  /\b(agreed|decided|approved|resolved|confirmed|rejected|deferred|carried|adopted|authorised|authorized|endorsed)\b/i;
const ACTION_RE =
  /\b(will|shall|must|is to|are to|need to|to prepare|to send|to share|to submit|to circulate|to update|follow up|action item|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|end of))\b/i;
const OWNER_RE = /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)\s+(?:will|shall|is to|are to|agreed to)\b/;
const DUE_RE =
  /\bby\s+((?:the\s+)?(?:end\s+of\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|month end|end of (?:the )?week|end of (?:the )?month))/i;

function stripStamp(line: string): string {
  return line.replace(/^\[\d{2}:\d{2}\]\s*/, "").trim();
}

function sentencesOf(transcript: string): string[] {
  return (transcript.match(/[^.!?\n]+[.!?]?/g) ?? [])
    .map((sentence) => stripStamp(sentence).replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 4)
    .slice(0, 400);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* A deterministic clerk: extract what the transcript states, leave the rest
   empty. It is deliberately conservative — a missing minute is honest, a
   fabricated one is not. */
export function draftMinutes(transcript: string, meeting: MeetingForNotes): MeetingMinutes {
  const text = transcript.replace(/\s+/g, " ").trim();
  const lines = transcript
    .split("\n")
    .map((line) => stripStamp(line))
    .filter(Boolean);
  const sentences = sentencesOf(transcript);

  const decisions = unique(sentences.filter((sentence) => DECISION_RE.test(sentence))).slice(0, 8);

  const actions = unique(sentences.filter((sentence) => ACTION_RE.test(sentence) && !decisions.includes(sentence)))
    .slice(0, 10)
    .map((sentence) => {
      const owner = sentence.match(OWNER_RE)?.[1]?.trim();
      const due = sentence.match(DUE_RE)?.[1]?.trim();
      return {
        owner: owner ?? "Unassigned",
        action: sentence,
        due: due ? capitalise(due) : null,
      };
    });

  const names = new Set<string>();
  const lower = text.toLowerCase();
  for (const attendee of meeting.attendees) {
    const name = attendee.name?.trim();
    if (name && lower.includes(name.toLowerCase())) names.add(name);
  }
  for (const line of lines) {
    const speaker = line.match(/^([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})\s*:/);
    if (speaker?.[1] && !/^(note|action|decision|summary)$/i.test(speaker[1])) names.add(speaker[1]);
  }

  const quotes = unique(
    sentences.filter(
      (sentence) =>
        /["“”]/.test(sentence) || /\b(we|I)\s+(?:agree|propose|recommend|move|object|confirm|suggest)\b/i.test(sentence),
    ),
  ).slice(0, 5);

  const summary =
    sentences.slice(0, 3).join(" ").slice(0, 900) ||
    text.slice(0, 900) ||
    "No discussion was captured for this meeting.";

  return {
    summary,
    decisions,
    actions,
    attendees: [...names].slice(0, 40),
    quotes,
  };
}

function whenOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* The downloadable/archivable form — the same minutes, with the transcript
   kept beneath them so a reader can always check the clerk against the room. */
export function minutesMarkdown(note: MeetingNotePayload): string {
  const decisions = note.minutes.decisions.length
    ? note.minutes.decisions.map((decision) => `- ${decision}`)
    : ["_No explicit decision was recorded._"];
  const actions = note.minutes.actions.length
    ? note.minutes.actions.map(
        (action) => `- [ ] ${action.owner} — ${action.action}${action.due ? ` (${action.due})` : ""}`,
      )
    : ["_No action was recorded._"];
  const attendees = note.minutes.attendees.length
    ? note.minutes.attendees.map((attendee) => `- ${attendee}`)
    : ["_No attendee was named in the transcript._"];
  const quotes = note.minutes.quotes.length ? ["## Verbatim", ...note.minutes.quotes.map((q) => `> ${q}`), ""] : [];

  return [
    `# Meeting minutes — ${note.meetingTitle}`,
    "",
    `- **Meeting:** ${whenOf(note.meetingStartsAt)}`,
    `- **Recorded by:** ${note.createdBy}`,
    `- **Filed:** ${whenOf(note.createdAt)}`,
    `- **Agent:** ${note.provider === "meta" ? note.model : "deterministic local draft (no Meta AI configured)"}`,
    ...(note.agenda ? [`- **Agenda:** ${note.agenda}`] : []),
    "",
    "## Summary",
    note.minutes.summary || "_No summary was produced._",
    "",
    "## Decisions",
    ...decisions,
    "",
    "## Actions",
    ...actions,
    "",
    "## Attendees",
    ...attendees,
    "",
    ...quotes,
    "---",
    "",
    "## Transcript",
    "",
    note.transcript.slice(0, 20_000) || "_No transcript was captured._",
    "",
  ].join("\n");
}
