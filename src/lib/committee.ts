import { randomBytes } from "node:crypto";
import {
  createCommitteeMember as dbCreateMember,
  createSitting as dbCreateSitting,
  deleteCommitteeMember as dbDeleteMember,
  findSittingById,
  getSetting,
  listCommitteeMembers,
  listSittings,
  setSetting,
  updateCommitteeMember as dbUpdateMember,
  updateSitting as dbUpdateSitting,
  type CommitteeMemberRow,
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
