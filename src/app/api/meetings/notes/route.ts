import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken, rateLimit, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  createMeetingNote,
  findScheduledMeetingById,
  listMeetingNotes,
  type MeetingNoteRow,
} from "@/lib/db";
import { composeMinutes } from "@/lib/meeting-agent";
import type { MeetingNotePayload } from "@/lib/meeting-minutes";

/**
 * Meeting notes — the Meta agent's minutes.
 *
 * GET  → every filed note, newest first; `?meetingId=` narrows to one meeting.
 * POST → { meetingId, transcript } reads the meeting from the diary, asks the
 *        Meta model for structured minutes (deterministic fallback when it is
 *        unavailable) and files the note against that meeting.
 *
 * The meeting is looked up server-side: the client cannot attach minutes to a
 * meeting that does not exist, and the note carries the meeting's own title,
 * date and invited names rather than whatever the browser claims.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TRANSCRIPT = 60_000;
const MIN_TRANSCRIPT = 20;

function payload(note: MeetingNoteRow): MeetingNotePayload {
  return {
    id: note.id,
    meetingId: note.meetingId,
    meetingTitle: note.meetingTitle,
    meetingStartsAt: note.meetingStartsAt.toISOString(),
    agenda: note.agenda,
    createdBy: note.createdBy,
    createdAt: note.createdAt.toISOString(),
    provider: note.provider,
    model: note.model,
    transcript: note.transcript,
    minutes: note.minutes,
  };
}

export async function GET(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to read the meeting notes." }, { status: 401 });

  const meetingId = request.nextUrl.searchParams.get("meetingId")?.trim() ?? "";
  const notes = listMeetingNotes(200)
    .filter((note) => !meetingId || note.meetingId === meetingId)
    .map(payload);

  return NextResponse.json({ notes }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to file meeting minutes." }, { status: 401 });
  if (!can(user.role, "manage_meetings")) {
    return NextResponse.json({ error: "Your workspace role cannot file meeting minutes." }, { status: 403 });
  }
  if (!rateLimit(`meeting-notes:${user.id}`, 12, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many minutes filed. Wait a few minutes and try again." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { meetingId?: unknown; transcript?: unknown } | null;
  const meetingId = typeof body?.meetingId === "string" ? body.meetingId.trim() : "";
  if (!meetingId) return NextResponse.json({ error: "Choose the meeting these minutes belong to." }, { status: 422 });

  const meeting = findScheduledMeetingById(meetingId);
  if (!meeting) {
    return NextResponse.json({ error: "That meeting is not on the diary." }, { status: 404 });
  }

  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (transcript.length < MIN_TRANSCRIPT) {
    return NextResponse.json(
      { error: "Capture at least a sentence of the discussion before drafting the minutes." },
      { status: 422 },
    );
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return NextResponse.json({ error: "That transcript is too long — split it by sitting." }, { status: 413 });
  }

  const result = await composeMinutes(transcript, {
    id: meeting.id,
    title: meeting.title,
    agenda: meeting.agenda,
    startsAt: meeting.startsAt.toISOString(),
    scheduledBy: meeting.scheduledBy,
    attendees: meeting.attendees.map((attendee) => ({ name: attendee.name })),
  });

  const note = createMeetingNote({
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    meetingStartsAt: meeting.startsAt,
    agenda: meeting.agenda,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date(),
    provider: result.provider,
    model: result.model,
    transcript,
    minutes: result.minutes,
  });

  return NextResponse.json(
    {
      note: payload(note),
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
