import { randomBytes } from "node:crypto";
import {
  createCommitteeMember as dbCreateMember,
  createScheduledMeeting as dbCreateMeeting,
  createSitting as dbCreateSitting,
  deleteCommitteeMember as dbDeleteMember,
  findScheduledMeetingById,
  findSittingById,
  findUserById,
  getSetting,
  listCommitteeMembers,
  listScheduledMeetings,
  listSittings,
  setSetting,
  updateCommitteeMember as dbUpdateMember,
  updateScheduledMeeting as dbUpdateMeeting,
  updateSitting as dbUpdateSitting,
  type CommitteeMemberRow,
  type MeetingAttendeeRow,
  type ScheduledMeetingRow,
  type SittingAttendanceRow,
  type SittingRow,
} from "@/lib/db";
import type { AuthUser } from "@/lib/auth-types";

/**
 * Committee state — the humans behind the gavel, as stored data.
 *
 * The standing committee lives in the JSON store (committee member rows); seat
 * capacity and the quorum threshold are SystemSetting rows. The gavel seat
 * is never a stored row: it belongs to whoever is actually signed in, and
 * the API resolves that from the session cookie. No member is invented: the
 * roster starts empty until real members are added.
 *
 * Sittings extend the same idea to meetings: a summons mints a fresh Jitsi
 * room (open source, no accounts, nothing installed), the committee register
 * becomes the sitting's door list — only registered names are admitted — and
 * the minutes are written from the Quorum desk straight into the record.
 */

export interface CommitteeMemberView {
  id: string;
  name: string;
  role: string;
  isChair: boolean;
  status: "PRESENT" | "EXCUSED";
  office?: "PROCUREMENT_UNIT" | "EVALUATION_COMMITTEE" | "ACCOUNTING_OFFICER" | "OVERSIGHT";
}

export interface SittingAttendanceView {
  memberId: string;
  name: string;
  role: string;
  expected: "PRESENT" | "EXCUSED" | "OFFICER";
  admitted: boolean;
  admittedAt: string | null;
  admittedBy: string | null;
}

export interface CommitteeSittingView {
  id: string;
  title: string;
  room: string;
  joinUrl: string;
  agenda: string | null;
  summonedBy: string;
  summonedAt: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  notes: string;
  notesUpdatedAt: string | null;
  notesUpdatedBy: string | null;
  attendance: SittingAttendanceView[];
}

export interface ScheduledMeetingView {
  id: string;
  title: string;
  agenda: string | null;
  joinUrl: string;
  startsAt: string;
  durationMinutes: number;
  scheduledBy: string;
  scheduledById: string;
  createdAt: string;
  status: "SCHEDULED" | "CANCELLED";
  attendees: MeetingAttendeeRow[];
}

export interface CommitteeState {
  seats: number;
  required: number;
  present: number;
  open: number;
  members: CommitteeMemberView[];
  you: { name: string } | null;
  lastSummonsAt: string | null;
  /** The open sitting, else the most recent one — what the desk shows. */
  sitting: CommitteeSittingView | null;
  /** The sitting register, most recent first. */
  sittings: CommitteeSittingView[];
  /** Meetings on the diary — scheduled ahead, soonest first. */
  meetings: ScheduledMeetingView[];
}

/** A summon result says whether this call actually minted a new room. */
export type SummonResult = CommitteeState & { minted: boolean };

export type MutationResult =
  | { ok: true; state: CommitteeState }
  | { ok: false; code: number; error: string };

const NOTES_CAP = 12_000;
const SITTINGS_SHOWN = 6;

const DEFAULTS: Record<string, string> = {
  committee_seats: "9",
  quorum_required: "5",
  committee_last_summons_at: "",
};

let seedPromise: Promise<void> | null = null;

async function seedOnce(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (getSetting(key) === undefined) setSetting(key, value);
  }
}

export async function ensureCommittee(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedOnce().catch((err) => {
      seedPromise = null; /* allow a retry on the next request */
      throw err;
    });
  }
  return seedPromise;
}

async function setting(key: string): Promise<string> {
  return getSetting(key) ?? DEFAULTS[key] ?? "";
}

/* ── Sitting views + the door ───────────────────────────────────────────── */

const isoOf = (d: Date | null): string | null => (d ? d.toISOString() : null);

function viewOf(s: SittingRow): CommitteeSittingView {
  return {
    id: s.id,
    title: s.title,
    room: s.room,
    joinUrl: s.joinUrl,
    agenda: s.agenda,
    summonedBy: s.summonedBy,
    summonedAt: s.summonedAt.toISOString(),
    status: s.status,
    closedAt: isoOf(s.closedAt),
    notes: s.notes,
    notesUpdatedAt: isoOf(s.notesUpdatedAt),
    notesUpdatedBy: s.notesUpdatedBy,
    attendance: s.attendance.map((a) => ({
      memberId: a.memberId,
      name: a.name,
      role: a.role,
      expected: a.expected,
      admitted: a.admitted,
      admittedAt: isoOf(a.admittedAt),
      admittedBy: a.admittedBy,
    })),
  };
}

function meetingViewOf(m: ScheduledMeetingRow): ScheduledMeetingView {
  return {
    id: m.id,
    title: m.title,
    agenda: m.agenda,
    joinUrl: m.joinUrl,
    startsAt: m.startsAt.toISOString(),
    durationMinutes: m.durationMinutes,
    scheduledBy: m.scheduledBy,
    scheduledById: m.scheduledById,
    createdAt: m.createdAt.toISOString(),
    status: m.status,
    attendees: m.attendees.map((a) => ({ ...a })),
  };
}

/* The gavel's door seat is keyed to the signed-in officer. */
function officerKey(user: AuthUser | null): string | null {
  return user?.id ? `officer:${user.id}` : null;
}

type AttendanceSeed = Omit<SittingAttendanceRow, "admitted" | "admittedAt" | "admittedBy">;

function officerSeed(user: AuthUser | null): AttendanceSeed | null {
  const name = user?.name?.trim();
  const key = officerKey(user);
  if (!name || !key) return null;
  return { memberId: key, name, role: "PROCUREMENT OFFICER · HOLDS THE GAVEL", expected: "OFFICER" };
}

function memberSeed(row: CommitteeMemberRow): AttendanceSeed {
  return {
    memberId: row.id,
    name: row.name,
    role: row.role,
    expected: row.status === "EXCUSED" ? "EXCUSED" : "PRESENT",
  };
}

/* Door lists live off the register: every registered member (and the gavel)
   is on it, nobody else. While a sitting is open the list re-reads the
   register — a member registered mid-sitting appears at the door; a removed
   member leaves it — unless they were already admitted, because admissions
   are history and stay. */
function syncDoor(sitting: SittingRow, user: AuthUser | null): void {
  if (sitting.status !== "OPEN") return;
  const seeds = new Map<string, AttendanceSeed>();
  const officer = officerSeed(user);
  if (officer) seeds.set(officer.memberId, officer);
  for (const row of listCommitteeMembers()) seeds.set(row.id, memberSeed(row));

  let changed = false;
  for (const [id, seed] of seeds) {
    const existing = sitting.attendance.find((a) => a.memberId === id);
    if (!existing) {
      sitting.attendance.push({
        ...seed,
        /* The gavel opens the room — the officer is admitted at the summons. */
        admitted: seed.expected === "OFFICER",
        admittedAt: seed.expected === "OFFICER" ? sitting.summonedAt : null,
        admittedBy: seed.expected === "OFFICER" ? sitting.summonedBy : null,
      });
      changed = true;
    } else if (
      existing.name !== seed.name ||
      existing.role !== seed.role ||
      existing.expected !== seed.expected
    ) {
      existing.name = seed.name;
      existing.role = seed.role;
      existing.expected = seed.expected;
      changed = true;
    }
  }

  const kept = sitting.attendance.filter((a) => seeds.has(a.memberId) || a.admitted);
  if (kept.length !== sitting.attendance.length) {
    sitting.attendance = kept;
    changed = true;
  }
  if (changed) dbUpdateSitting(sitting.id, { attendance: sitting.attendance });
}

/* ── The committee state ────────────────────────────────────────────────── */

export async function getCommitteeState(user: AuthUser | null): Promise<CommitteeState> {
  await ensureCommittee();

  const [rows, seatsRaw, requiredRaw, summonsRaw] = await Promise.all([
    Promise.resolve(listCommitteeMembers()),
    setting("committee_seats"),
    setting("quorum_required"),
    setting("committee_last_summons_at"),
  ]);

  const seats = Math.max(1, parseInt(seatsRaw, 10) || 9);
  const required = Math.max(1, parseInt(requiredRaw, 10) || 5);

  const members: CommitteeMemberView[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    isChair: r.isChair,
    status: r.status === "EXCUSED" ? "EXCUSED" : "PRESENT",
    office: r.office,
  }));

  /* The signed-in officer always sits — they hold the gavel. */
  const you = user?.name?.trim() ? { name: user.name.trim() } : null;
  const present =
    members.filter((m) => m.status === "PRESENT").length + (you ? 1 : 0);
  const openSeats = Math.max(0, seats - present);

  /* Sittings — an open one re-reads the register into its door list. */
  const sittings = listSittings(100);
  const openSitting = sittings.find((s) => s.status === "OPEN") ?? null;
  if (openSitting) syncDoor(openSitting, user);
  const recent = sittings.slice(0, SITTINGS_SHOWN).map(viewOf);

  /* The diary — scheduled meetings, soonest first. Cancelled meetings leave
     both the desk and the calendar; the meeting record itself is kept. */
  const meetings = listScheduledMeetings(50).map(meetingViewOf);

  return {
    seats,
    required,
    present,
    open: openSeats,
    members,
    you,
    lastSummonsAt: summonsRaw || null,
    sitting: openSitting ? viewOf(openSitting) : recent[0] ?? null,
    sittings: recent,
    meetings,
  };
}

/* ── The summons — one open sitting at a time, one fresh room per sitting ── */

export async function recordSummons(user: AuthUser | null, agenda?: string): Promise<SummonResult> {
  await ensureCommittee();

  const before = await getCommitteeState(user);
  const alreadyOpen = before.sitting && before.sitting.status === "OPEN" ? before.sitting : null;
  if (alreadyOpen) return { ...before, minted: false };

  const at = new Date();
  /* The room slug is unguessable and minted for this sitting only — it is
     part of the record, and it is never reused. */
  const room = `quorum-sitting-${randomBytes(6).toString("hex")}`;

  const attendance: SittingAttendanceRow[] = [];
  const officer = officerSeed(user);
  if (officer) {
    attendance.push({ ...officer, admitted: true, admittedAt: at, admittedBy: officer.name });
  }
  for (const row of listCommitteeMembers()) {
    attendance.push({ ...memberSeed(row), admitted: false, admittedAt: null, admittedBy: null });
  }

  dbCreateSitting({
    title: `Sitting ${listSittings(1000).length + 1}`,
    room,
    joinUrl: `https://meet.jit.si/${room}`,
    agenda: agenda?.trim().slice(0, 300) || null,
    summonedBy: user?.name?.trim() || "unknown officer",
    summonedAt: at,
    status: "OPEN",
    closedAt: null,
    notes: "",
    notesUpdatedAt: null,
    notesUpdatedBy: null,
    attendance,
  });
  setSetting("committee_last_summons_at", at.toISOString());

  const after = await getCommitteeState(user);
  return { ...after, minted: true };
}

/* ── Scheduling — the owner names the day and the players, the room mints ── */

export interface ScheduleMeetingInput {
  title?: unknown;
  agenda?: unknown;
  startsAt?: unknown;
  durationMinutes?: unknown;
  memberIds?: unknown;
  playerIds?: unknown;
  externals?: unknown;
}

export type ScheduleMeetingResult =
  | { ok: true; state: CommitteeState; meeting: ScheduledMeetingView }
  | { ok: false; code: number; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MEETING_LEAD_MS = 60_000;
const MEETING_HORIZON_DAYS = 366;
const ATTENDEE_CAP = 40;

function emailOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase().slice(0, 160);
  return EMAIL_RE.test(email) ? email : null;
}

function stringList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, cap);
}

function externalSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "guest";
}

export async function scheduleMeeting(
  input: ScheduleMeetingInput,
  actor: AuthUser | null,
): Promise<ScheduleMeetingResult> {
  await ensureCommittee();

  if (!actor?.id) {
    return { ok: false, code: 401, error: "Sign in to schedule a meeting — the diary carries the officer's name." };
  }

  const title = String(input.title ?? "").trim().slice(0, 140);
  if (title.length < 3) {
    return { ok: false, code: 422, error: "Give the meeting a title of at least three characters." };
  }

  const startsAt = new Date(String(input.startsAt ?? ""));
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false, code: 422, error: "Pick a real date and start time for the meeting." };
  }
  const now = Date.now();
  if (startsAt.getTime() < now + MEETING_LEAD_MS) {
    return { ok: false, code: 422, error: "Pick a start time at least a minute ahead — a meeting cannot travel backwards." };
  }
  if (startsAt.getTime() > now + MEETING_HORIZON_DAYS * 86_400_000) {
    return { ok: false, code: 422, error: "Keep the meeting within the next year — the diary holds real dates, not forecasts." };
  }

  const rawDuration = Number(input.durationMinutes ?? 60);
  const durationMinutes = Number.isFinite(rawDuration) ? Math.round(rawDuration) : 60;
  if (durationMinutes < 15 || durationMinutes > 480) {
    return { ok: false, code: 422, error: "A meeting runs between 15 and 480 minutes." };
  }

  const agenda = String(input.agenda ?? "").trim().slice(0, 1000) || null;

  /* The owner always attends; everyone else is exactly who was named. */
  const attendees: MeetingAttendeeRow[] = [];
  const seen = new Set<string>();
  const add = (a: MeetingAttendeeRow) => {
    if (attendees.length >= ATTENDEE_CAP) return;
    const key = a.email ? `email:${a.email.toLowerCase()}` : `name:${a.name.trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    attendees.push(a);
  };

  add({
    key: `officer:${actor.id}`,
    name: actor.name.trim() || "Procurement officer",
    email: emailOf(actor.email),
    source: "PLAYER",
  });

  const register = listCommitteeMembers();
  for (const id of stringList(input.memberIds, ATTENDEE_CAP)) {
    const member = register.find((m) => m.id === id);
    if (!member) continue;
    add({ key: `committee:${member.id}`, name: member.name, email: null, source: "COMMITTEE" });
  }

  for (const id of stringList(input.playerIds, ATTENDEE_CAP)) {
    const player = findUserById(id);
    if (!player || player.id === actor.id) continue;
    add({ key: `player:${player.id}`, name: player.name, email: emailOf(player.email), source: "PLAYER" });
  }

  const externals = Array.isArray(input.externals) ? input.externals.slice(0, 20) : [];
  for (const raw of externals) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const name = String(entry.name ?? "").trim().slice(0, 120);
    if (name.length < 2) continue;
    const email = emailOf(entry.email);
    add({ key: `external:${email ?? externalSlug(name)}`, name, email, source: "EXTERNAL" });
  }

  if (attendees.length < 2) {
    return { ok: false, code: 422, error: "Name at least one other player — a meeting with only the owner is not a meeting." };
  }

  const at = new Date();
  /* Minted now and never reused — the invitation can carry a real address
     without waiting for a background job to create the room. */
  const room = `quorum-meeting-${randomBytes(6).toString("hex")}`;
  const row = dbCreateMeeting({
    title,
    agenda,
    room,
    joinUrl: `https://meet.jit.si/${room}`,
    startsAt,
    durationMinutes,
    scheduledBy: actor.name.trim() || "unknown officer",
    scheduledById: actor.id,
    createdAt: at,
    status: "SCHEDULED",
    cancelledAt: null,
    cancelledBy: null,
    attendees,
  });

  return { ok: true, state: await getCommitteeState(actor), meeting: meetingViewOf(row) };
}

export async function cancelScheduledMeeting(id: string, actor: AuthUser | null): Promise<MutationResult> {
  await ensureCommittee();

  if (!actor?.id) {
    return { ok: false, code: 401, error: "Sign in to cancel a meeting." };
  }
  const row = findScheduledMeetingById(id);
  if (!row) return { ok: false, code: 404, error: "meeting not found" };
  if (row.status !== "SCHEDULED") {
    return { ok: false, code: 409, error: "the meeting is already cancelled" };
  }

  dbUpdateMeeting(row.id, {
    status: "CANCELLED",
    cancelledAt: new Date(),
    cancelledBy: actor.name.trim() || "unknown officer",
  });

  return { ok: true, state: await getCommitteeState(actor) };
}

/* ── Desk writes: minutes, the door, the seal ───────────────────────────── */

export interface SittingPatch {
  notes?: string;
  attendance?: { memberId: string; admitted: boolean }[];
  close?: boolean;
}

export async function mutateSitting(
  id: string,
  patch: SittingPatch,
  actor: AuthUser | null,
): Promise<MutationResult> {
  await ensureCommittee();

  const sitting = findSittingById(id);
  if (!sitting) return { ok: false, code: 404, error: "sitting not found" };
  if (sitting.status !== "OPEN") {
    return { ok: false, code: 409, error: "the sitting is sealed — the record cannot be edited" };
  }

  const by = actor?.name?.trim() || "unknown officer";
  const at = new Date();

  if (typeof patch.notes === "string") {
    const text = patch.notes.slice(0, NOTES_CAP);
    if (text !== sitting.notes) {
      sitting.notes = text;
      sitting.notesUpdatedAt = at;
      sitting.notesUpdatedBy = by;
    }
  }

  if (Array.isArray(patch.attendance)) {
    for (const op of patch.attendance.slice(0, 60)) {
      const row = sitting.attendance.find((a) => a.memberId === op.memberId);
      if (!row) continue;
      row.admitted = op.admitted === true;
      row.admittedAt = row.admitted ? at : null;
      row.admittedBy = row.admitted ? by : null;
    }
  }

  if (patch.close === true) {
    sitting.status = "CLOSED";
    sitting.closedAt = at;
  }

  dbUpdateSitting(sitting.id, {
    notes: sitting.notes,
    notesUpdatedAt: sitting.notesUpdatedAt,
    notesUpdatedBy: sitting.notesUpdatedBy,
    attendance: sitting.attendance,
    status: sitting.status,
    closedAt: sitting.closedAt,
  });

  return { ok: true, state: await getCommitteeState(actor) };
}

/* ── The register — registering members is what opens the door later ────── */

const MEMBER_OFFICES = ["PROCUREMENT_UNIT", "EVALUATION_COMMITTEE", "ACCOUNTING_OFFICER", "OVERSIGHT"] as const;
type MemberOffice = (typeof MEMBER_OFFICES)[number];

function officeOf(v: unknown): MemberOffice | undefined {
  return MEMBER_OFFICES.includes(v as MemberOffice) ? (v as MemberOffice) : undefined;
}

export async function addCommitteeMember(
  input: { name?: unknown; role?: unknown; isChair?: unknown; office?: unknown },
  actor: AuthUser | null,
): Promise<MutationResult> {
  await ensureCommittee();

  const name = String(input.name ?? "").trim().slice(0, 120);
  if (name.length < 2) {
    return { ok: false, code: 422, error: "a full name is required — the register admits named humans" };
  }
  const role = String(input.role ?? "").trim().slice(0, 100) || "COMMITTEE MEMBER";
  const isChair = input.isChair === true;
  const office = officeOf(input.office);

  if (isChair) {
    for (const m of listCommitteeMembers()) if (m.isChair) dbUpdateMember(m.id, { isChair: false });
  }
  dbCreateMember({ name, role, isChair, ...(office ? { office } : {}) });

  return { ok: true, state: await getCommitteeState(actor) };
}

export async function updateCommitteeMemberById(
  id: string,
  patch: { status?: unknown; isChair?: unknown; role?: unknown; office?: unknown },
  actor: AuthUser | null,
): Promise<MutationResult> {
  await ensureCommittee();

  const row = listCommitteeMembers().find((m) => m.id === id);
  if (!row) return { ok: false, code: 404, error: "member not found" };

  const next: Partial<Pick<CommitteeMemberRow, "role" | "isChair" | "status" | "office">> = {};
  if (patch.status === "PRESENT" || patch.status === "EXCUSED") next.status = patch.status;
  if (typeof patch.role === "string" && patch.role.trim()) next.role = patch.role.trim().slice(0, 100);
  const office = officeOf(patch.office);
  if (office) next.office = office;
  if (typeof patch.isChair === "boolean") {
    next.isChair = patch.isChair;
    if (patch.isChair) {
      for (const m of listCommitteeMembers()) if (m.id !== id && m.isChair) dbUpdateMember(m.id, { isChair: false });
    }
  }
  if (Object.keys(next).length > 0) dbUpdateMember(id, next);

  return { ok: true, state: await getCommitteeState(actor) };
}

export async function removeCommitteeMemberById(id: string, actor: AuthUser | null): Promise<MutationResult> {
  await ensureCommittee();
  if (!dbDeleteMember(id)) return { ok: false, code: 404, error: "member not found" };
  return { ok: true, state: await getCommitteeState(actor) };
}
