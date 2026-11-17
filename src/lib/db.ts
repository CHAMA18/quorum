import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "fs";
import path from "path";
import { isWorkspaceRole, type WorkspaceRole } from "@/lib/permissions";
import { claimedMembershipForEmail, roleForNewWorkspaceMember } from "@/lib/role-assignment";
import { postgresConfigured } from "@/lib/pg";
import {
  flushStoreWrites,
  queueStoreWrite,
  readStoreDocument,
  storeWriteStatus,
} from "@/lib/pg-store";

/* Session cookies are bearer credentials. Store only a digest, so a copied
   store file cannot be replayed as a live session. */
const sessionTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
let sessionTokenRewriteNeeded = false;
let totpRewriteNeeded = false;


/**
 * Quorum's web-app store: one document, held in memory, persisted to
 * PostgreSQL. There is no ORM.
 *
 * Every operation is synchronous, which is what the routes rely on: the store
 * answers from memory immediately, and `persist()` hands the new revision to
 * `@/lib/pg-store`, which serialises writes to the `quorum_web_store` row in
 * Postgres. A local JSON file is kept as a synchronous boot cache and offline
 * fallback — it is never the system of record when `DATABASE_URL` is set.
 *
 * Uniqueness that a relational schema would enforce (email, session token,
 * invite code) is enforced here: the create functions throw on a duplicate.
 */

export interface UserRow {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  password: string; // scrypt:salt:hash, or "oauth:google" for Google-only accounts
  emailVerified: boolean;
  organization: string | null;
  /* Workspace authority. OWNER is unique and cannot be removed by an ADMIN. */
  role: WorkspaceRole;
  status: "ACTIVE" | "SUSPENDED";
  /* Step-up authentication: an optional RFC 6238 secret. The secret is only
     trusted once `totpEnabled` is true (the officer has proved one code). */
  totpSecret?: string;
  totpEnabled?: boolean;
  /* Optional for WhatsApp delivery; email is always the account address. */
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
}

/* Every step-up issuance is recorded, even when the gate is never signed. The
   sidecar records the consumption; this row records the human re-auth event. */
export interface StepUpLogRow {
  id: string;
  userId: string;
  userName: string;
  gateId: string;
  docHash: string;
  method: "password" | "totp";
  jti: string;
  issuedAt: Date;
  expiresAt: Date;
}

/* One-time links. Only the SHA-256 digest of a token is stored; the token
   itself exists exactly twice — in the email and in the request that spends
   it. A consumed or expired row grants nothing. */
export interface EmailVerificationRow {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

export interface PasswordResetRow {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

export interface SessionRow {
  id: string;
  /** SHA-256 of the opaque cookie token. The token itself never reaches disk. */
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export type NotificationKind =
  | "GATE_WAITING"
  | "GATE_DECIDED"
  | "STEP_UP"
  | "DEADLINE"
  | "RUN_FAILED"
  | "INVITE"
  | "SYSTEM";

export interface NotificationRow {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /* In-app destination: a workspace section id (e.g. mc-gates) or a URL. */
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string;
  readAt: Date | null;
  createdAt: Date;
}

export type DeliveryChannel = "email" | "whatsapp" | "slack";
export type DeliveryStatus = "SENT" | "SKIPPED" | "FAILED";

export interface NotificationDeliveryRow {
  id: string;
  notificationId: string;
  userId: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  detail: string;
  /* Provider message id (WhatsApp wamid / Resend id) so delivery and read
     receipts from a webhook can be matched back to this row. */
  providerMessageId?: string;
  createdAt: Date;
}

/* A small, durable record of governance actions. This is separate from the
   sidecar's hash-chained tool log: role and organization changes happen in the
   Next app, and oversight must be able to read them there. */
export type OversightAction =
  | "ROLE_CHANGED"
  | "USER_SUSPENDED"
  | "USER_REACTIVATED"
  | "SESSIONS_REVOKED"
  | "ORG_SUSPENDED"
  | "ORG_VERIFIED"
  | "ORG_REACTIVATED"
  | "ORG_APPEAL_FILED"
  | "ORG_APPEAL_UPHELD"
  | "ORG_REINSTATED_ON_APPEAL"
  | "INVITE_REVOKED"
  | "ACCESS_REVIEW";

export interface OversightEventRow {
  id: string;
  actorId: string;
  actorName: string;
  action: OversightAction;
  targetType: "USER" | "ORGANIZATION" | "INVITE";
  targetId: string;
  targetName: string;
  detail: string;
  createdAt: Date;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  createdAt: Date;
}

export type SupportRequestStatus = "OPEN" | "RESPONDED" | "CLOSED";

export interface SupportRequestRow {
  id: string;
  workspaceId: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  source: "BARRY";
  subject: string;
  message: string;
  status: SupportRequestStatus;
  response?: string;
  respondedBy?: string;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommitteeMemberRow {
  id: string;
  userId?: string;
  name: string;
  role: string;
  isChair: boolean;
  status: string; // PRESENT | EXCUSED
  /* The named office this member holds on the desk — the statutory gates of
     the tender cycle (opening, matrix certification, award, contract) sign by
     office, not just by name. Defaults are applied on read for rows written
     before offices existed: the chair sits as accounting officer, everyone
     else on the evaluation committee. */
  office?: "PROCUREMENT_UNIT" | "EVALUATION_COMMITTEE" | "ACCOUNTING_OFFICER" | "OVERSIGHT";
  seatOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SittingAttendanceRow {
  memberId: string; // committee member id, or "officer:<userId>" for the gavel
  name: string;
  role: string;
  expected: "PRESENT" | "EXCUSED" | "OFFICER";
  admitted: boolean;
  admittedAt: Date | null;
  admittedBy: string | null;
}

export interface SittingRow {
  id: string;
  title: string;
  room: string; // the Jitsi room slug — meet.jit.si/<room>, minted per sitting
  joinUrl: string;
  agenda: string | null;
  summonedBy: string;
  summonedAt: Date;
  status: "OPEN" | "CLOSED";
  closedAt: Date | null;
  notes: string; // the minutes, written from the Quorum desk
  notesUpdatedAt: Date | null;
  notesUpdatedBy: string | null;
  attendance: SittingAttendanceRow[]; // the door list — the register, frozen into the sitting
}

/* A scheduled meeting is a future sitting: the owner sets the day, names the
   players, and the room is minted at scheduling time so the invitation can
   carry a real, unlisted address. Nothing here is inferred — the attendee
   list is exactly who was named. */
export interface MeetingAttendeeRow {
  key: string; // committee:<id>, player:<id>, external:<slug>
  name: string;
  email: string | null;
  source: "COMMITTEE" | "PLAYER" | "EXTERNAL";
}

export interface ScheduledMeetingRow {
  id: string;
  title: string;
  agenda: string | null;
  room: string; // the Jitsi room slug — minted once, for this meeting only
  joinUrl: string;
  startsAt: Date;
  durationMinutes: number;
  scheduledBy: string;
  scheduledById: string;
  createdAt: Date;
  status: "SCHEDULED" | "CANCELLED";
  cancelledAt: Date | null;
  cancelledBy: string | null;
  attendees: MeetingAttendeeRow[];
  /* A weekly series writes one row per occurrence. The series fields are the
     thread between them; a one-off meeting simply has none. */
  seriesId?: string;
  seriesIndex?: number;
  seriesCount?: number;
}

/* A meeting note is Kira's minutes for one scheduled meeting: the
   transcript it heard, the structured minutes it filed, and who filed them.
   Notes are append-only evidence — correcting one means filing a new note. */
export interface MeetingMinutesRow {
  summary: string;
  decisions: string[];
  actions: { owner: string; action: string; due: string | null }[];
  attendees: string[];
  quotes: string[];
}

export interface MeetingNoteRow {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingStartsAt: Date;
  agenda: string | null;
  createdBy: string;
  createdById: string;
  createdAt: Date;
  provider: "kira" | "meta" | "local";
  model: string;
  transcript: string;
  minutes: MeetingMinutesRow;
}

export type InviteStatus = "PENDING" | "CLAIMED" | "REVOKED";

export interface InviteRow {
  id: string;
  workspaceId?: string;
  code: string;
  email: string | null;
  role: string; // OFFICER | COMMITTEE
  createdBy: string;
  inviterName: string;
  claimedBy: string | null;
  claimedByEmail: string | null;
  status: InviteStatus;
  emailDeliveryStatus?: "SENT" | "SKIPPED" | "FAILED";
  emailDeliveryDetail?: string;
  emailDeliveryAttemptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  claimedAt: Date | null;
}

/* ── Organizations — the supplier side of the desk ────────────────────────
   A completely separate account space from the officers': own table, own
   sessions, own cookie. The profile mirrors what the sidecar's supplier
   register asks bidders to hold (registration number, tax clearance,
   sector regulator), so an application can sync the organization onto
   that register losslessly. */
export interface OrganizationRow {
  id: string;
  name: string; // legal name
  email: string; // login identity, unique
  password: string; // scrypt:salt:hash
  registrationNo: string; // legal registration number, unique
  country: string;
  legalForm?: string;
  taxPin?: string;
  taxClearanceNo?: string;
  taxClearanceExpiry?: string;
  regulator?: string;
  regulatorNo?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  website?: string;
  description?: string;
  categories: string[];
  /* PENDING is the account's state between registration and the desk's
     identity/statutory review. A pending organization can sign in and
     complete its profile, but cannot file a bid. */
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgSessionRow {
  /** SHA-256 of the opaque supplier cookie token. */
  tokenHash: string;
  orgId: string;
  expiresAt: Date;
  createdAt: Date;
}

/* One-time passphrase reset codes for the supplier door. Only the SHA-256
   of the code is stored — the code itself lives exactly one place, the
   response that issued it. */
export interface OrgPasswordResetRow {
  tokenHash: string; // sha256 of the normalized (dash-less, uppercase) code
  orgId: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

/* A suspension appeal — the supplier door's one lawful way back in while the
   account is blocked. Filed without a session (the door is closed), matched
   by email AND registration number, decided by a named reviewer. One OPEN
   appeal per organization; the decision is final until a fresh suspension. */
export interface OrgAppealRow {
  id: string;
  orgId: string;
  reason: string;
  status: "OPEN" | "UPHELD" | "REINSTATED";
  reviewer?: string;
  reviewNote?: string;
  createdAt: Date;
  decidedAt?: Date;
}

interface StoreShape {
  /* Monotonic document revision. Postgres refuses to replace a newer one. */
  revision: number;
  workspaceId: string;
  users: UserRow[];
  sessions: SessionRow[];
  contacts: ContactRow[];
  supportRequests: SupportRequestRow[];
  committeeMembers: CommitteeMemberRow[];
  sittings: SittingRow[];
  scheduledMeetings: ScheduledMeetingRow[];
  meetingNotes: MeetingNoteRow[];
  settings: Record<string, string>;
  invites: InviteRow[];
  organizations: OrganizationRow[];
  orgSessions: OrgSessionRow[];
  orgPasswordResets: OrgPasswordResetRow[];
  orgAppeals: OrgAppealRow[];
  stepUpLogs: StepUpLogRow[];
  notifications: NotificationRow[];
  notificationDeliveries: NotificationDeliveryRow[];
  oversightEvents: OversightEventRow[];
  emailVerifications: EmailVerificationRow[];
  passwordResets: PasswordResetRow[];
}

/**
 * Store location. In `next dev` the cwd is the repo root, so the store lands
 * in <repo>/db/. In standalone production the server chdirs into
 * `.next/standalone` — leaving the store there means EVERY rebuild (`next
 * build` wipes .next) destroys accounts, sessions and gate receipts. So the
 * path resolves to the repo root (walking up until package.json +
 * mini-services/quorum-mcp is seen), honours QUORUM_STORE_PATH, and migrates
 * a legacy standalone store on first touch.
 */
function resolveStoreFile(): string {
  if (process.env.QUORUM_STORE_PATH) return path.resolve(process.env.QUORUM_STORE_PATH);
  const repoRoot = (() => {
    let dir = process.cwd();
    /* In standalone production the server runs from `.next/standalone`, and
       the build copies package.json + mini-services into that directory — so
       the walk below stops inside `.next`, where every rebuild wipes the
       store. Anchor on the real repo root first. */
    if (dir.includes(`${path.sep}.next${path.sep}standalone`)) {
      const anchored = path.resolve(dir, "..", "..");
      if (
        existsSync(path.join(anchored, "package.json")) &&
        existsSync(path.join(anchored, "mini-services", "quorum-mcp"))
      ) {
        return anchored;
      }
    }
    for (let i = 0; i < 8; i++) {
      try {
        if (
          existsSync(path.join(dir, "package.json")) &&
          existsSync(path.join(dir, "mini-services", "quorum-mcp"))
        ) {
          return dir;
        }
      } catch {
        /* unreadable dir — keep walking */
      }
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    return null;
  })();
  return path.join(repoRoot ?? process.cwd(), "db", "quorum-store.json");
}

const FILE = resolveStoreFile();
/**
 * Only the standalone migration may read a legacy store. When
 * QUORUM_STORE_PATH is set (tests, the judge proof, a second deployment) the
 * configured location is authoritative: it must start from an empty store,
 * never from the live workspace's accounts, sessions or organizations.
 */
const LEGACY_FILE =
  !process.env.QUORUM_STORE_PATH && process.cwd().includes(`${path.sep}.next${path.sep}standalone`)
    ? path.join(process.cwd(), "db", "quorum-store.json")
    : null;

/* TOTP secrets are the second factor. Encrypt them at rest with a key that is
   separate from the store file: QUORUM_STORE_KEY when supplied, otherwise a
   generated 0600 key beside the store. Changing or losing the key makes
   existing TOTP enrolments unreadable, so back it up with the store. */
let cachedTotpKey: Buffer | null = null;
function totpKey(): Buffer {
  if (cachedTotpKey) return cachedTotpKey;
  const configured = process.env.QUORUM_STORE_KEY?.trim();
  if (configured) {
    const key = /^[0-9a-f]{64}$/i.test(configured)
      ? Buffer.from(configured, "hex")
      : Buffer.from(configured, "base64");
    if (key.length !== 32) throw new Error("QUORUM_STORE_KEY must be 32 bytes (64 hex characters or base64).");
    cachedTotpKey = key;
    return key;
  }
  const keyPath = path.join(path.dirname(FILE), ".totp-key");
  try {
    const existing = Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex");
    if (existing.length === 32) {
      cachedTotpKey = existing;
      return existing;
    }
  } catch {
    /* first boot — generate below */
  }
  const key = randomBytes(32);
  mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* non-POSIX host */
  }
  cachedTotpKey = key;
  return key;
}

function encryptTotpSecret(secret: string): string {
  if (secret.startsWith("enc:v1:")) return secret;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", totpKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${ciphertext.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`;
}

function decryptTotpSecret(stored: string): string {
  if (!stored.startsWith("enc:v1:")) return stored;
  const [, , iv, ciphertext, tag] = stored.split(":");
  if (!iv || !ciphertext || !tag) throw new Error("Malformed encrypted TOTP secret.");
  const decipher = createDecipheriv("aes-256-gcm", totpKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
const DATE_FIELDS = ["createdAt", "updatedAt", "expiresAt", "issuedAt", "claimedAt", "usedAt", "readAt", "decidedAt", "respondedAt", "emailDeliveryAttemptedAt"] as const;

function revive<T>(rows: unknown): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };
    for (const field of DATE_FIELDS) {
      if (typeof copy[field] === "string") copy[field] = new Date(copy[field] as string);
    }
    return copy as T;
  });
}

/* Sitting rows carry dates two levels deep (the door list's admissions), so
   they get a dedicated revival instead of the flat DATE_FIELDS pass. */
function reviveSittings(rows: unknown): SittingRow[] {
  if (!Array.isArray(rows)) return [];
  const asDate = (v: unknown): Date | null =>
    typeof v === "string" ? new Date(v) : v instanceof Date ? v : null;
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const attendance = Array.isArray(r.attendance) ? (r.attendance as Record<string, unknown>[]) : [];
    return {
      id: String(r.id ?? ""),
      title: String(r.title ?? "Sitting"),
      room: String(r.room ?? ""),
      joinUrl: String(r.joinUrl ?? ""),
      agenda: typeof r.agenda === "string" && r.agenda.trim() ? r.agenda : null,
      summonedBy: String(r.summonedBy ?? "unknown"),
      summonedAt: asDate(r.summonedAt) ?? new Date(),
      status: r.status === "CLOSED" ? "CLOSED" : "OPEN",
      closedAt: asDate(r.closedAt),
      notes: typeof r.notes === "string" ? r.notes : "",
      notesUpdatedAt: asDate(r.notesUpdatedAt),
      notesUpdatedBy: typeof r.notesUpdatedBy === "string" ? r.notesUpdatedBy : null,
      attendance: attendance.map((a) => ({
        memberId: String(a.memberId ?? ""),
        name: String(a.name ?? ""),
        role: String(a.role ?? ""),
        expected: a.expected === "EXCUSED" ? "EXCUSED" : a.expected === "OFFICER" ? "OFFICER" : "PRESENT",
        admitted: a.admitted === true,
        admittedAt: asDate(a.admittedAt),
        admittedBy: typeof a.admittedBy === "string" ? a.admittedBy : null,
      })),
    };
  });
}

/* Meeting rows carry dates at the top level and no dates inside attendees,
   so one dedicated revival keeps the record honest across a reload. */
function reviveMeetings(rows: unknown): ScheduledMeetingRow[] {
  if (!Array.isArray(rows)) return [];
  const asDate = (v: unknown): Date | null =>
    typeof v === "string" ? new Date(v) : v instanceof Date ? v : null;
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const attendees = Array.isArray(r.attendees) ? (r.attendees as Record<string, unknown>[]) : [];
    return {
      id: String(r.id ?? ""),
      title: String(r.title ?? "Meeting"),
      agenda: typeof r.agenda === "string" && r.agenda.trim() ? r.agenda : null,
      room: String(r.room ?? ""),
      joinUrl: String(r.joinUrl ?? ""),
      startsAt: asDate(r.startsAt) ?? new Date(),
      durationMinutes: Number(r.durationMinutes) || 60,
      scheduledBy: String(r.scheduledBy ?? "unknown officer"),
      scheduledById: String(r.scheduledById ?? ""),
      createdAt: asDate(r.createdAt) ?? new Date(),
      status: r.status === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
      cancelledAt: asDate(r.cancelledAt),
      cancelledBy: typeof r.cancelledBy === "string" ? r.cancelledBy : null,
      attendees: attendees.map((a) => ({
        key: String(a.key ?? ""),
        name: String(a.name ?? ""),
        email: typeof a.email === "string" && a.email.trim() ? a.email : null,
        source: a.source === "COMMITTEE" ? "COMMITTEE" : a.source === "EXTERNAL" ? "EXTERNAL" : "PLAYER",
      })),
      ...(typeof r.seriesId === "string" && r.seriesId ? { seriesId: r.seriesId } : {}),
      ...(typeof r.seriesIndex === "number" ? { seriesIndex: r.seriesIndex } : {}),
      ...(typeof r.seriesCount === "number" ? { seriesCount: r.seriesCount } : {}),
    };
  });
}

/* Notes revive their nested minutes too, so a restart never hands the UI a
   maybe-array where a section expects real minutes. */
function reviveMeetingNotes(rows: unknown): MeetingNoteRow[] {
  if (!Array.isArray(rows)) return [];
  const asDate = (v: unknown): Date | null =>
    typeof v === "string" ? new Date(v) : v instanceof Date ? v : null;
  return rows
    .map((raw): MeetingNoteRow => {
      const r = raw as Record<string, unknown>;
      const m = (r.minutes ?? {}) as Record<string, unknown>;
      const actions = Array.isArray(m.actions) ? (m.actions as Record<string, unknown>[]) : [];
      return {
        id: String(r.id ?? ""),
        meetingId: String(r.meetingId ?? ""),
        meetingTitle: String(r.meetingTitle ?? "Meeting"),
        meetingStartsAt: asDate(r.meetingStartsAt) ?? new Date(),
        agenda: typeof r.agenda === "string" && r.agenda.trim() ? r.agenda : null,
        createdBy: String(r.createdBy ?? "unknown officer"),
        createdById: String(r.createdById ?? ""),
        createdAt: asDate(r.createdAt) ?? new Date(),
        provider: r.provider === "meta" || r.provider === "kira" ? r.provider : "local",
        model: String(r.model ?? "deterministic"),
        transcript: typeof r.transcript === "string" ? r.transcript : "",
        minutes: {
          summary: typeof m.summary === "string" ? m.summary : "",
          decisions: Array.isArray(m.decisions) ? m.decisions.map(String).filter(Boolean) : [],
          actions: actions
            .map((action) => ({
              owner: String(action.owner ?? "Unassigned"),
              action: String(action.action ?? ""),
              due: typeof action.due === "string" && action.due.trim() ? action.due : null,
            }))
            .filter((action) => action.action),
          attendees: Array.isArray(m.attendees) ? m.attendees.map(String).filter(Boolean) : [],
          quotes: Array.isArray(m.quotes) ? m.quotes.map(String).filter(Boolean) : [],
        },
      };
    })
    .filter((note) => note.id && note.meetingId);
}

function load(): StoreShape {
  const empty: StoreShape = {
    revision: 0,
    workspaceId: randomUUID(),
    users: [],
    sessions: [],
    contacts: [],
    supportRequests: [],
    committeeMembers: [],
    sittings: [],
    scheduledMeetings: [],
    meetingNotes: [],
    settings: {},
    invites: [],
    organizations: [],
    orgSessions: [],
    orgPasswordResets: [],
    orgAppeals: [],
    stepUpLogs: [],
    notifications: [],
    notificationDeliveries: [],
    oversightEvents: [],
    emailVerifications: [],
    passwordResets: [],
  };
  if (!existsSync(FILE)) {
    /* One-time migration: a pre-fix build kept the store inside
       .next/standalone/db (wiped on every rebuild). Rescue it to the
       durable location so accounts, sessions and receipts survive. */
    if (LEGACY_FILE && FILE !== LEGACY_FILE && existsSync(LEGACY_FILE)) {
      try {
        mkdirSync(path.dirname(FILE), { recursive: true });
        const legacy = JSON.parse(readFileSync(LEGACY_FILE, "utf8"));
        writeFileSync(FILE, JSON.stringify(legacy, null, 2));
      } catch {
        /* unreadable legacy file — start from the empty store */
      }
    }
    if (!existsSync(FILE)) return empty;
  }
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Record<keyof StoreShape, unknown>>;
  return {
    revision: typeof raw.revision === "number" && Number.isFinite(raw.revision) ? raw.revision : 0,
    workspaceId: typeof raw.workspaceId === "string" && raw.workspaceId ? raw.workspaceId : randomUUID(),
    users: revive<UserRow>(raw.users).map((user) => {
      if (user.totpSecret && !user.totpSecret.startsWith("enc:v1:")) {
        try {
          user.totpSecret = encryptTotpSecret(user.totpSecret);
          totpRewriteNeeded = true;
        } catch {
          /* keep the plaintext secret rather than locking the officer out */
        }
      }
      return { ...user, workspaceId: user.workspaceId || (typeof raw.workspaceId === "string" ? raw.workspaceId : "") };
    }),
    sessions: revive<SessionRow & { token?: string }>(raw.sessions).map(({ token, ...session }) => {
      if (token) sessionTokenRewriteNeeded = true;
      return {
        ...session,
        tokenHash: session.tokenHash || (token ? sessionTokenHash(token) : ""),
      };
    }).filter((session) => session.tokenHash.length > 0),
    contacts: revive<ContactRow>(raw.contacts),
    supportRequests: revive<SupportRequestRow>(raw.supportRequests),
    committeeMembers: revive<CommitteeMemberRow>(raw.committeeMembers),
    sittings: reviveSittings(raw.sittings),
    scheduledMeetings: reviveMeetings(raw.scheduledMeetings),
    meetingNotes: reviveMeetingNotes(raw.meetingNotes),
    settings: (raw.settings as Record<string, string>) ?? {},
    invites: revive<InviteRow>(raw.invites),
    organizations: revive<OrganizationRow>(raw.organizations),
    orgSessions: revive<OrgSessionRow & { token?: string }>(raw.orgSessions).map(({ token, ...session }) => {
      if (token) sessionTokenRewriteNeeded = true;
      return {
        ...session,
        tokenHash: session.tokenHash || (token ? sessionTokenHash(token) : ""),
      };
    }).filter((session) => session.tokenHash.length > 0),
    orgPasswordResets: revive<OrgPasswordResetRow>(raw.orgPasswordResets),
    orgAppeals: revive<OrgAppealRow>(raw.orgAppeals),
    stepUpLogs: revive<StepUpLogRow>(raw.stepUpLogs),
    notifications: revive<NotificationRow>(raw.notifications),
    notificationDeliveries: revive<NotificationDeliveryRow>(raw.notificationDeliveries),
    oversightEvents: revive<OversightEventRow>(raw.oversightEvents),
    emailVerifications: revive<EmailVerificationRow>(raw.emailVerifications),
    passwordResets: revive<PasswordResetRow>(raw.passwordResets),
  };
}

/* One store per process. globalThis survives Next.js hot reloads in dev. */
const globalForStore = globalThis as unknown as { __quorumStore?: StoreShape };
const store: StoreShape = globalForStore.__quorumStore ?? load();
globalForStore.__quorumStore = store;

/* A hot reload keeps the old store object alive across a schema addition —
   backfill new collections so the store is never half-shaped. */
if (!store.workspaceId) store.workspaceId = randomUUID();
for (const user of store.users) if (!user.workspaceId) user.workspaceId = store.workspaceId;
if (!Array.isArray(store.sittings)) store.sittings = [];
if (!Array.isArray(store.invites)) store.invites = [];
if (!Array.isArray(store.supportRequests)) store.supportRequests = [];
if (!Array.isArray(store.scheduledMeetings)) store.scheduledMeetings = [];
if (!Array.isArray(store.meetingNotes)) store.meetingNotes = [];
if (!Array.isArray(store.organizations)) store.organizations = [];
if (!Array.isArray(store.orgSessions)) store.orgSessions = [];
if (!Array.isArray(store.orgPasswordResets)) store.orgPasswordResets = [];
if (!Array.isArray(store.orgAppeals)) store.orgAppeals = [];
if (!Array.isArray(store.stepUpLogs)) store.stepUpLogs = [];
/* Rewrite a legacy store once, so the plaintext tokens that were loaded for
   compatibility are replaced on disk by their digests. A read-only store keeps
   the in-memory digests and health reports the write failure. */
if (sessionTokenRewriteNeeded || totpRewriteNeeded) {
  try {
    persist();
  } catch {
    /* health will report the unwritable store */
  }
}
if (!Array.isArray(store.notifications)) store.notifications = [];
if (!Array.isArray(store.notificationDeliveries)) store.notificationDeliveries = [];
if (!Array.isArray(store.oversightEvents)) store.oversightEvents = [];
if (!Array.isArray(store.emailVerifications)) store.emailVerifications = [];
if (!Array.isArray(store.passwordResets)) store.passwordResets = [];
if (typeof store.revision !== "number") store.revision = 0;

/* Backfill roles for stores written before workspace authority existed. The
   earliest account owns the workspace; later accounts inherit the role on a
   claimed invite where one exists, otherwise they are officers. The migration
   is idempotent and writes once, so a reload cannot shuffle authority. */
let rolesMigrated = false;
if (store.users.length > 0) {
  const earliest = [...store.users].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  for (const user of store.users) {
    if (!isWorkspaceRole(user.role)) {
      const claimed = store.invites.find(
        (inv) => inv.claimedByEmail === user.email && inv.claimedByEmail !== null && inv.workspaceId === user.workspaceId
      );
      user.role = isWorkspaceRole(claimed?.role)
        ? claimed.role
        : user.id === earliest.id
          ? "OWNER"
          : "OFFICER";
      rolesMigrated = true;
    }
    if (user.status !== "SUSPENDED") {
      if (user.status !== "ACTIVE") {
        user.status = "ACTIVE";
        rolesMigrated = true;
      }
    }
  }
  if (!store.users.some((u) => u.role === "OWNER")) {
    earliest.role = "OWNER";
    rolesMigrated = true;
  }
}
if (rolesMigrated) persist();

/* ── Postgres hydration ───────────────────────────────────────────────────
   Boot reads the local cache synchronously so the first request is never made
   to wait; the authoritative row then decides. A newer database revision
   replaces the cache in place (same object identity, so every module that
   already imported the store sees the adopted data). A newer local revision —
   or any mutation that landed during boot — is pushed up instead. */
const revisionAtBoot = store.revision;
let storeHydrated = !postgresConfigured();

async function hydrateStoreFromPostgres(): Promise<void> {
  if (!postgresConfigured()) return;
  try {
    const remote = await readStoreDocument();
    const mutatedSinceBoot = store.revision !== revisionAtBoot;
    if (!remote) {
      storeHydrated = true;
      /* First boot against an empty database: adopt the local file rather
         than wait for the next mutation, so a host that already served
         accounts keeps them. */
      const hasLocalRecords =
        store.revision > 0 || store.users.length > 0 || store.organizations.length > 0;
      if (hasLocalRecords) queueStoreWrite(store, Math.max(store.revision, 1));
      return;
    }
    if (remote.revision > store.revision && !mutatedSinceBoot) {
      mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
      const tmp = `${FILE}.${process.pid}.hydrate.tmp`;
      writeFileSync(tmp, JSON.stringify(remote.body, null, 2), { mode: 0o600 });
      renameSync(tmp, FILE);
      Object.assign(store, load());
      store.revision = remote.revision;
    } else if (store.revision > remote.revision || mutatedSinceBoot) {
      queueStoreWrite(store, store.revision);
    }
    storeHydrated = true;
  } catch (error) {
    console.error(
      "[postgres] store hydration failed — continuing on the local cache",
      error instanceof Error ? error.message : error,
    );
  }
}

const storeHydration = hydrateStoreFromPostgres();

function persist(): void {
  store.revision = (store.revision ?? 0) + 1;
  const dir = path.dirname(FILE);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* non-POSIX host — the write still succeeds */
  }
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  /* fsync the file before the rename, then the directory, so a power loss
     cannot leave a half-written record or lose the rename itself. */
  const fd = openSync(tmp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, FILE);
  try {
    chmodSync(FILE, 0o600);
    const dfd = openSync(dir, "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  } catch {
    /* directory fsync is not available on every filesystem */
  }
  /* Postgres is the system of record: hand it this revision. The local file
     above is the boot cache, never the authority when a database is set. */
  if (storeHydrated) queueStoreWrite(store, store.revision);
}

/**
 * Make the current document durable before answering.
 *
 * Hydration is awaited first so a request that arrives during boot cannot
 * race the decision about which side is newer, then the current revision is
 * queued explicitly: `persist()` skips the queue until hydration finishes.
 * Used where a lost write would invalidate a session or a one-time link.
 */
export async function flushStore(): Promise<void> {
  if (!postgresConfigured()) return;
  await storeHydration;
  queueStoreWrite(store, store.revision);
  await flushStoreWrites();
}

/** Readiness probe: the web store must be writable, not merely present. */
export function storeHealth(): {
  writable: boolean;
  bytes: number;
  freeBytes: number | null;
  persistence: "postgres" | "file";
  pendingRevisions: number;
  lastSavedRevision: number;
  lastSavedAt: string | null;
  lastError: string | null;
} {
  let writable = false;
  let bytes = 0;
  try {
    accessSync(FILE, fsConstants.W_OK);
    bytes = statSync(FILE).size;
    writable = true;
  } catch {
    try {
      accessSync(path.dirname(FILE), fsConstants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  let freeBytes: number | null = null;
  try {
    const fsStat = statfsSync(path.dirname(FILE));
    freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
  } catch {
    /* statfs is unavailable on some hosts; writability still answers */
  }
  return { writable, bytes, freeBytes, ...storeWriteStatus() };
}

const now = () => new Date();
const newId = () => randomUUID();

/* ── Users ──────────────────────────────────────────────────────────────── */

export function findUserByEmail(email: string): UserRow | null {
  return store.users.find((user) => user.email === email) ?? null;
}

export function findClaimedWorkspaceMembership(email: string) {
  return claimedMembershipForEmail(store.invites, email);
}

export function findUserById(id: string, workspaceId?: string): UserRow | null {
  return store.users.find((user) => user.id === id && (!workspaceId || user.workspaceId === workspaceId)) ?? null;
}

export function listUsers(workspaceId?: string): UserRow[] {
  const scopedWorkspace = workspaceId ?? store.users[0]?.workspaceId ?? store.workspaceId;
  return store.users.filter((user) => user.workspaceId === scopedWorkspace).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/* Single-workspace mode is the pilot default: the first account opens the
   workspace, and every later account needs an invitation into that same
   workspace. It prevents a public signup from silently opening a second
   tenant whose committee, settings, suppliers and oversight records are still
   global. A hosted multi-tenant deployment sets QUORUM_SINGLE_WORKSPACE=false
   only after the store is tenant-scoped. */
export function selfServeWorkspaceCreationOpen(): boolean {
  return process.env.QUORUM_SINGLE_WORKSPACE === "false" || store.users.length === 0;
}

export function createUser(data: {
  name: string;
  email: string;
  password: string;
  organization?: string | null;
  emailVerified?: boolean;
  role?: WorkspaceRole;
  status?: "ACTIVE" | "SUSPENDED";
  workspaceId?: string;
  phone?: string;
}): UserRow {
  if (findUserByEmail(data.email)) throw new Error(`User already exists: ${data.email}`);
  if (!data.workspaceId && !selfServeWorkspaceCreationOpen()) {
    throw new Error("Self-serve registration is closed — ask a workspace owner for an invitation.");
  }
  const at = now();
  /* New self-serve workspaces begin with an owner. An explicit invitation
     keeps its assigned role even if the member list is temporarily empty. */
  const workspaceUsers = store.users.filter((user) => user.workspaceId === (data.workspaceId ?? store.workspaceId));
  const workspaceId = data.workspaceId ?? (workspaceUsers.length === 0 && store.users.length === 0 ? store.workspaceId : randomUUID());
  const scopedUsers = store.users.filter((existing) => existing.workspaceId === workspaceId);
  const role = roleForNewWorkspaceMember(scopedUsers.length, data.role);
  const user: UserRow = {
    id: newId(),
    workspaceId,
    name: data.name,
    email: data.email,
    password: data.password,
    emailVerified: data.emailVerified ?? false,
    organization: data.organization ?? null,
    ...(data.phone?.trim() ? { phone: data.phone.trim().slice(0, 32) } : {}),
    role,
    status: data.status ?? "ACTIVE",
    createdAt: at,
    updatedAt: at,
  };
  store.users.push(user);
  persist();
  return user;
}

export function updateUserRole(id: string, role: WorkspaceRole): UserRow | null {
  const user = findUserById(id);
  if (!user) return null;
  user.role = role;
  user.updatedAt = now();
  persist();
  return user;
}

export function setUserStatus(id: string, status: "ACTIVE" | "SUSPENDED"): UserRow | null {
  const user = findUserById(id);
  if (!user) return null;
  user.status = status;
  user.updatedAt = now();
  persist();
  return user;
}

export function deleteSessionsForUser(userId: string): number {
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.userId !== userId);
  const removed = before - store.sessions.length;
  if (removed > 0) persist();
  return removed;
}

export function countSessionsForUser(userId: string): number {
  const nowMs = Date.now();
  return store.sessions.filter((s) => s.userId === userId && s.expiresAt.getTime() > nowMs).length;
}

/* ── Oversight events — governance actions, durable and readable ─────────── */

export function recordOversightEvent(data: {
  actorId: string;
  actorName: string;
  action: OversightAction;
  targetType: "USER" | "ORGANIZATION" | "INVITE";
  targetId: string;
  targetName: string;
  detail: string;
}): OversightEventRow {
  const row: OversightEventRow = {
    id: `evt_${randomUUID().slice(0, 10)}`,
    ...data,
    detail: data.detail.slice(0, 700),
    createdAt: now(),
  };
  store.oversightEvents.push(row);
  if (store.oversightEvents.length > 2000) {
    store.oversightEvents.splice(0, store.oversightEvents.length - 2000);
  }
  persist();
  return row;
}

export function listOversightEvents(take = 40): OversightEventRow[] {
  return [...store.oversightEvents]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}

export function markUserVerified(id: string): UserRow | null {
  const user = findUserById(id);
  if (!user) return null;
  user.emailVerified = true;
  user.updatedAt = now();
  persist();
  return user;
}

/** Replace the stored password hash (self-service reset reconciliation). */
export function updateUserPassword(id: string, passwordHash: string): UserRow | null {
  const user = findUserById(id);
  if (!user) return null;
  user.password = passwordHash;
  user.updatedAt = now();
  persist();
  return user;
}

/** Enable or replace the authenticator secret (the caller verifies a code first). */
export function setUserTotp(id: string, secret: string | null, enabled: boolean): UserRow | null {
  const user = findUserById(id);
  if (!user) return null;
  if (secret) user.totpSecret = encryptTotpSecret(secret);
  if (secret === null) delete user.totpSecret;
  user.totpEnabled = enabled;
  user.updatedAt = now();
  persist();
  return user;
}

/** The decrypted TOTP secret for verification; null when absent or unreadable. */
export function getUserTotpSecret(id: string): string | null {
  const user = findUserById(id);
  if (!user?.totpSecret) return null;
  try {
    return decryptTotpSecret(user.totpSecret);
  } catch {
    return null;
  }
}

export function recordStepUpIssued(data: {
  userId: string;
  userName: string;
  gateId: string;
  docHash: string;
  method: "password" | "totp";
  jti: string;
  expiresAt: Date;
}): StepUpLogRow {
  const row: StepUpLogRow = {
    id: newId(),
    ...data,
    issuedAt: now(),
  };
  store.stepUpLogs.push(row);
  /* Keep the local audit slice bounded; the sidecar's hash-chained log is the
     durable record. */
  if (store.stepUpLogs.length > 5000) store.stepUpLogs.splice(0, store.stepUpLogs.length - 5000);
  persist();
  return row;
}

/* A store loaded by an older build can still hold issuedAt as a string; parse
   either form here as well as in revive(), so one legacy row cannot 500 the
   access-review history until the process restarts. */
function timeOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "number" ? value : new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function listStepUpLogs(take = 100): StepUpLogRow[] {
  return [...store.stepUpLogs].sort((a, b) => timeOf(b.issuedAt) - timeOf(a.issuedAt)).slice(0, take);
}

/* ── Notifications — the desk's attention layer ─────────────────────────── */

export function findNotificationByDedupe(userId: string, dedupeKey: string): NotificationRow | null {
  return store.notifications.find((n) => n.userId === userId && n.dedupeKey === dedupeKey) ?? null;
}

export function createNotification(data: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey: string;
}): { row: NotificationRow; created: boolean } {
  const existing = findNotificationByDedupe(data.userId, data.dedupeKey);
  if (existing) return { row: existing, created: false };
  const row: NotificationRow = {
    id: `ntf_${randomUUID().slice(0, 10)}`,
    userId: data.userId,
    kind: data.kind,
    title: data.title.slice(0, 160),
    body: data.body.slice(0, 700),
    href: data.href ?? null,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    dedupeKey: data.dedupeKey,
    readAt: null,
    createdAt: now(),
  };
  store.notifications.push(row);
  /* Keep local history bounded; this is an attention inbox, not the audit log. */
  if (store.notifications.length > 5000) store.notifications.splice(0, store.notifications.length - 5000);
  persist();
  return { row, created: true };
}

export function listNotifications(userId: string, opts?: { unreadOnly?: boolean; take?: number }): NotificationRow[] {
  const take = Math.min(Math.max(opts?.take ?? 40, 1), 200);
  return store.notifications
    .filter((n) => n.userId === userId && (!opts?.unreadOnly || n.readAt === null))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}

export function countUnreadNotifications(userId: string): number {
  return store.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
}

export function markNotificationRead(userId: string, id: string): NotificationRow | null {
  const row = store.notifications.find((n) => n.id === id && n.userId === userId);
  if (!row) return null;
  if (!row.readAt) {
    row.readAt = now();
    persist();
  }
  return row;
}

export function markAllNotificationsRead(userId: string): number {
  const at = now();
  let changed = 0;
  for (const row of store.notifications) {
    if (row.userId === userId && !row.readAt) {
      row.readAt = at;
      changed += 1;
    }
  }
  if (changed) persist();
  return changed;
}

export function recordNotificationDelivery(data: {
  notificationId: string;
  userId: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  detail: string;
  providerMessageId?: string;
}): NotificationDeliveryRow {
  const row: NotificationDeliveryRow = {
    id: `ndl_${randomUUID().slice(0, 10)}`,
    ...data,
    detail: data.detail.slice(0, 500),
    createdAt: now(),
  };
  store.notificationDeliveries.push(row);
  if (store.notificationDeliveries.length > 5000) {
    store.notificationDeliveries.splice(0, store.notificationDeliveries.length - 5000);
  }
  persist();
  return row;
}

export function listNotificationDeliveries(take = 100): NotificationDeliveryRow[] {
  return [...store.notificationDeliveries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take);
}

/** Match a provider delivery/read receipt to the row that sent it. */
export function findDeliveryByProviderMessageId(providerMessageId: string): NotificationDeliveryRow | null {
  if (!providerMessageId) return null;
  return store.notificationDeliveries.find((d) => d.providerMessageId === providerMessageId) ?? null;
}

/** Append a provider status (delivered / read / failed) to the send record,
 *  keeping the original send detail so the log reads as one history. */
export function appendDeliveryStatus(id: string, status: string, error?: string): void {
  const row = store.notificationDeliveries.find((d) => d.id === id);
  if (!row) return;
  const note = `WhatsApp ${status}${error ? `: ${error}` : ""}`;
  if (!row.detail.includes(note)) {
    row.detail = `${row.detail} · ${note}`.slice(0, 500);
    persist();
  }
}

/** Find the account that claimed a WhatsApp number — used by the webhook to
 *  apply STOP / START to exactly that account and no other. */
export function findUserByPhone(phoneDigits: string): UserRow | null {
  const digits = phoneDigits.replace(/[^\d]/g, "");
  if (!digits) return null;
  return store.users.find((u) => (u.phone ?? "").replace(/[^\d]/g, "") === digits) ?? null;
}

/** Set (or clear, with "") the number WhatsApp alerts go to. Stored as
 *  typed; delivery normalises to E.164 digits at send time. */
export function setUserPhone(id: string, phone: string): UserRow | null {
  const user = findUserById(id);
  if (!user) return null;
  const trimmed = phone.trim().slice(0, 32);
  if (trimmed) user.phone = trimmed;
  else delete user.phone;
  user.updatedAt = now();
  persist();
  return user;
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

export function createSession(userId: string, expiresAt: Date, token: string): SessionRow {
  const tokenHash = sessionTokenHash(token);
  if (store.sessions.some((s) => s.tokenHash === tokenHash)) throw new Error("Session token collision");
  const session: SessionRow = { id: newId(), tokenHash, userId, expiresAt, createdAt: now() };
  store.sessions.push(session);
  persist();
  return session;
}

/** Looks up a session by its opaque token and returns it with its user. */
export function findSessionWithUser(token: string): { session: SessionRow; user: UserRow } | null {
  const tokenHash = sessionTokenHash(token);
  const session = store.sessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;
  const user = findUserById(session.userId);
  return user ? { session, user } : null;
}

export function deleteSessionByToken(token: string): void {
  const tokenHash = sessionTokenHash(token);
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.tokenHash !== tokenHash);
  if (store.sessions.length !== before) persist();
}

/* ── Pilot requests (landing page) ──────────────────────────────────────── */

export function createContactMessage(data: {
  name: string;
  email: string;
  company: string | null;
  message: string;
}): ContactRow {
  const row: ContactRow = { id: newId(), ...data, createdAt: now() };
  store.contacts.push(row);
  persist();
  return row;
}

export function createSupportRequest(data: {
  workspaceId: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  subject: string;
  message: string;
}): SupportRequestRow {
  const at = now();
  const row: SupportRequestRow = {
    id: `sup_${newId().slice(0, 12)}`,
    ...data,
    source: "BARRY",
    subject: data.subject.trim().slice(0, 120),
    message: data.message.trim().slice(0, 2000),
    status: "OPEN",
    createdAt: at,
    updatedAt: at,
  };
  store.supportRequests.push(row);
  persist();
  return row;
}

export function listSupportRequests(workspaceId: string, requesterId?: string): SupportRequestRow[] {
  return store.supportRequests
    .filter((row) => row.workspaceId === workspaceId && (!requesterId || row.requesterId === requesterId))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function respondToSupportRequest(
  id: string,
  workspaceId: string,
  responderName: string,
  response: string,
): SupportRequestRow | null {
  const row = store.supportRequests.find((request) => request.id === id && request.workspaceId === workspaceId);
  if (!row) return null;
  const clean = response.trim();
  if (!clean || clean.length > 4000) return null;
  const at = now();
  row.response = clean;
  row.respondedBy = responderName.trim().slice(0, 100) || "Quorum Support";
  row.respondedAt = at;
  row.status = "RESPONDED";
  row.updatedAt = at;
  persist();
  return row;
}

/* ── Committee roster + settings ────────────────────────────────────────── */

export function listCommitteeMembers(): CommitteeMemberRow[] {
  return [...store.committeeMembers]
    .sort((a, b) => a.seatOrder - b.seatOrder || a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => ({
      ...m,
      /* Office migration on read: rows written before offices existed get the
         sensible default — the chair holds the accounting officer's office,
         every other member sits on the evaluation committee. */
      office: m.office ?? (m.isChair ? "ACCOUNTING_OFFICER" : "EVALUATION_COMMITTEE"),
    }));
}

export function createCommitteeMember(data: {
  userId?: string;
  name: string;
  role: string;
  isChair: boolean;
  office?: CommitteeMemberRow["office"];
}): CommitteeMemberRow {
  const at = now();
  const row: CommitteeMemberRow = {
    id: `cmb_${randomUUID().slice(0, 8)}`,
    ...(data.userId ? { userId: data.userId } : {}),
    name: data.name,
    role: data.role,
    isChair: data.isChair,
    status: "PRESENT",
    office: data.office ?? (data.isChair ? "ACCOUNTING_OFFICER" : "EVALUATION_COMMITTEE"),
    seatOrder: store.committeeMembers.reduce((max, m) => Math.max(max, m.seatOrder), 0) + 1,
    createdAt: at,
    updatedAt: at,
  };
  store.committeeMembers.push(row);
  persist();
  return row;
}

export function updateCommitteeMember(
  id: string,
  patch: Partial<Pick<CommitteeMemberRow, "name" | "userId" | "role" | "isChair" | "status" | "office">>
): CommitteeMemberRow | null {
  const row = store.committeeMembers.find((m) => m.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: now() });
  persist();
  return row;
}

export function deleteCommitteeMember(id: string): boolean {
  const idx = store.committeeMembers.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  store.committeeMembers.splice(idx, 1);
  persist();
  return true;
}

export function getSetting(key: string): string | undefined {
  return store.settings[key];
}

export function setSetting(key: string, value: string): void {
  store.settings[key] = value;
  persist();
}

export function listSettingKeys(prefix = ""): string[] {
  return Object.keys(store.settings).filter((k) => k.startsWith(prefix));
}

/* ── Workspace invites ──────────────────────────────────────────────────── */

export function listInvites(take = 100, workspaceId = store.workspaceId): InviteRow[] {
  return store.invites.filter((invite) => invite.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}

export function findInviteById(id: string, workspaceId = store.workspaceId): InviteRow | null {
  return store.invites.find((invite) => invite.id === id && invite.workspaceId === workspaceId) ?? null;
}

export function findInviteByCode(code: string, workspaceId?: string): InviteRow | null {
  return store.invites.find((invite) => invite.code === code && (!workspaceId || invite.workspaceId === workspaceId)) ?? null;
}

export function createInvite(data: {
  code: string;
  workspaceId?: string;
  email: string | null;
  role: string;
  createdBy: string;
  inviterName: string;
}): InviteRow {
  if (store.invites.some((invite) => invite.code === data.code && invite.workspaceId === (data.workspaceId ?? store.workspaceId))) throw new Error("Invite code collision");
  const at = now();
  const row: InviteRow = {
    id: newId(),
    ...data,
    workspaceId: data.workspaceId ?? store.workspaceId,
    claimedBy: null,
    claimedByEmail: null,
    status: "PENDING",
    createdAt: at,
    updatedAt: at,
    claimedAt: null,
  };
  store.invites.push(row);
  persist();
  return row;
}

export function updateInvite(
  id: string,
  patch: Partial<Pick<InviteRow, "email" | "status" | "claimedBy" | "claimedByEmail" | "claimedAt" | "emailDeliveryStatus" | "emailDeliveryDetail" | "emailDeliveryAttemptedAt">>,
  workspaceId = store.workspaceId,
): InviteRow | null {
  const row = store.invites.find((invite) => invite.id === id && invite.workspaceId === workspaceId) ?? null;
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: now() });
  persist();
  return row;
}

/* ── Committee sittings — the meeting record (Jitsi room + minutes) ─────── */

export function listSittings(take = 100): SittingRow[] {
  return [...store.sittings]
    .sort((a, b) => b.summonedAt.getTime() - a.summonedAt.getTime())
    .slice(0, take);
}

export function findSittingById(id: string): SittingRow | null {
  return store.sittings.find((s) => s.id === id) ?? null;
}

export function createSitting(data: Omit<SittingRow, "id">): SittingRow {
  const row: SittingRow = { id: `sit_${randomUUID().slice(0, 8)}`, ...data };
  store.sittings.push(row);
  persist();
  return row;
}

export function updateSitting(id: string, patch: Partial<Omit<SittingRow, "id">>): SittingRow | null {
  const row = findSittingById(id);
  if (!row) return null;
  Object.assign(row, patch);
  persist();
  return row;
}

/* ── Scheduled meetings — future sittings with a named guest list ───────── */

export function listScheduledMeetings(take = 50): ScheduledMeetingRow[] {
  return store.scheduledMeetings
    .filter((m) => m.status === "SCHEDULED")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(-take);
}

export function findScheduledMeetingById(id: string): ScheduledMeetingRow | null {
  return store.scheduledMeetings.find((m) => m.id === id) ?? null;
}

export function createScheduledMeeting(data: Omit<ScheduledMeetingRow, "id">): ScheduledMeetingRow {
  const row: ScheduledMeetingRow = { id: `mtg_${randomUUID().slice(0, 8)}`, ...data };
  store.scheduledMeetings.push(row);
  persist();
  return row;
}

export function updateScheduledMeeting(
  id: string,
  patch: Partial<Omit<ScheduledMeetingRow, "id">>,
): ScheduledMeetingRow | null {
  const row = findScheduledMeetingById(id);
  if (!row) return null;
  Object.assign(row, patch);
  persist();
  return row;
}

/* ── Meeting notes — the Meta agent's minutes ───────────────────────────── */

export function listMeetingNotes(take = 100): MeetingNoteRow[] {
  return [...store.meetingNotes]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}

export function findMeetingNoteById(id: string): MeetingNoteRow | null {
  return store.meetingNotes.find((note) => note.id === id) ?? null;
}

export function createMeetingNote(data: Omit<MeetingNoteRow, "id">): MeetingNoteRow {
  const row: MeetingNoteRow = { id: `note_${randomUUID().slice(0, 8)}`, ...data };
  store.meetingNotes.unshift(row);
  persist();
  return row;
}

/* ── Organizations — the supplier side of the desk ──────────────────────── */

export function listOrganizations(): OrganizationRow[] {
  return [...store.organizations].sort((a, b) => a.name.localeCompare(b.name));
}

export function countOrgSessionsForOrg(orgId: string): number {
  const nowMs = Date.now();
  return store.orgSessions.filter((s) => s.orgId === orgId && s.expiresAt.getTime() > nowMs).length;
}

export function findOrganizationByEmail(email: string): OrganizationRow | null {
  return store.organizations.find((o) => o.email === email) ?? null;
}

export function findOrganizationById(id: string): OrganizationRow | null {
  return store.organizations.find((o) => o.id === id) ?? null;
}

export function findOrganizationByRegistrationNo(registrationNo: string): OrganizationRow | null {
  const reg = registrationNo.trim().toLowerCase();
  return store.organizations.find((o) => o.registrationNo.trim().toLowerCase() === reg) ?? null;
}

export function createOrganization(data: {
  name: string;
  email: string;
  password: string;
  registrationNo: string;
  country: string;
  legalForm?: string;
  taxPin?: string;
  taxClearanceNo?: string;
  taxClearanceExpiry?: string;
  regulator?: string;
  regulatorNo?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  website?: string;
  description?: string;
  categories?: string[];
}): OrganizationRow {
  if (findOrganizationByEmail(data.email)) throw new Error(`Organization already exists: ${data.email}`);
  if (findOrganizationByRegistrationNo(data.registrationNo)) {
    throw new Error(`An organization with registration number ${data.registrationNo} already exists`);
  }
  const at = now();
  const org: OrganizationRow = {
    id: `org_${randomUUID().slice(0, 8)}`,
    name: data.name,
    email: data.email,
    password: data.password,
    registrationNo: data.registrationNo,
    country: data.country,
    legalForm: data.legalForm,
    taxPin: data.taxPin,
    taxClearanceNo: data.taxClearanceNo,
    taxClearanceExpiry: data.taxClearanceExpiry,
    regulator: data.regulator,
    regulatorNo: data.regulatorNo,
    contactName: data.contactName,
    phone: data.phone,
    address: data.address,
    website: data.website,
    description: data.description,
    categories: data.categories ?? [],
    status: "PENDING",
    createdAt: at,
    updatedAt: at,
  };
  store.organizations.push(org);
  persist();
  return org;
}

const ORG_TEXT_FIELDS = [
  "legalForm", "taxPin", "taxClearanceNo", "taxClearanceExpiry",
  "regulator", "regulatorNo", "contactName", "phone", "address", "website", "description",
] as const;

export function updateOrganization(
  id: string,
  patch: Partial<Pick<OrganizationRow, "name" | "country" | "status">> &
    Partial<Pick<OrganizationRow, (typeof ORG_TEXT_FIELDS)[number]>> &
    Partial<Pick<OrganizationRow, "categories">>
): OrganizationRow | null {
  const org = findOrganizationById(id);
  if (!org) return null;
  if (typeof patch.name === "string" && patch.name.trim()) org.name = patch.name.trim().slice(0, 160);
  if (typeof patch.country === "string" && patch.country.trim()) org.country = patch.country.trim().slice(0, 80);
  if (patch.status === "PENDING" || patch.status === "ACTIVE" || patch.status === "SUSPENDED") org.status = patch.status;
  for (const k of ORG_TEXT_FIELDS) {
    if (typeof patch[k] === "string") org[k] = (patch[k] as string).trim().slice(0, 1200) || undefined;
  }
  if (Array.isArray(patch.categories)) {
    org.categories = patch.categories.map((c) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 12);
  }
  org.updatedAt = now();
  persist();
  return org;
}

/* ── Organization sessions — a separate token space from officer sessions ── */

export function createOrgSession(orgId: string, expiresAt: Date, token: string): OrgSessionRow {
  const tokenHash = sessionTokenHash(token);
  if (store.orgSessions.some((s) => s.tokenHash === tokenHash)) throw new Error("Org session token collision");
  const session: OrgSessionRow = { tokenHash, orgId, expiresAt, createdAt: now() };
  store.orgSessions.push(session);
  persist();
  return session;
}

export function findOrgSessionWithOrg(token: string): { session: OrgSessionRow; org: OrganizationRow } | null {
  const tokenHash = sessionTokenHash(token);
  const session = store.orgSessions.find((s) => s.tokenHash === tokenHash);
  if (!session) return null;
  const org = findOrganizationById(session.orgId);
  return org ? { session, org } : null;
}

export function deleteOrgSessionByToken(token: string): void {
  const tokenHash = sessionTokenHash(token);
  const before = store.orgSessions.length;
  store.orgSessions = store.orgSessions.filter((s) => s.tokenHash !== tokenHash);
  if (store.orgSessions.length !== before) persist();
}

export function deleteOrgSessionsByOrg(orgId: string): number {
  const before = store.orgSessions.length;
  store.orgSessions = store.orgSessions.filter((s) => s.orgId !== orgId);
  const removed = before - store.orgSessions.length;
  if (removed > 0) persist();
  return removed;
}

export function setOrganizationStatus(
  orgId: string,
  status: OrganizationRow["status"],
): OrganizationRow | null {
  const org = findOrganizationById(orgId);
  if (!org) return null;
  org.status = status;
  org.updatedAt = now();
  persist();
  return org;
}

/* ── Organization passphrase resets — one-time codes, hashed at rest ───────
   The supplier door has no outbound mail, so the reset code is issued
   straight to the portal screen that requested it. One outstanding code
   per organization: issuing a fresh one retires the previous. */

export function createOrgPasswordReset(orgId: string, tokenHash: string, expiresAt: Date): OrgPasswordResetRow {
  store.orgPasswordResets = store.orgPasswordResets.filter(
    (r) => r.orgId !== orgId || r.usedAt !== null,
  );
  const row: OrgPasswordResetRow = { tokenHash, orgId, expiresAt, createdAt: now(), usedAt: null };
  store.orgPasswordResets.push(row);
  persist();
  return row;
}

export function findOrgPasswordReset(tokenHash: string): OrgPasswordResetRow | null {
  return store.orgPasswordResets.find((r) => r.tokenHash === tokenHash) ?? null;
}

export function consumeOrgPasswordReset(tokenHash: string): void {
  const row = store.orgPasswordResets.find((r) => r.tokenHash === tokenHash);
  if (row && row.usedAt === null) {
    row.usedAt = now();
    persist();
  }
}

/* ── Email verification and password reset ────────────────────────────────
   Quorum used to delegate both to Firebase. They are now first-party: the
   server mints a random token, emails the link through its own relay, stores
   only the digest, and spends the token exactly once. One outstanding token
   per account — issuing a fresh one retires the previous. */

export function createEmailVerification(userId: string, tokenHash: string, expiresAt: Date): EmailVerificationRow {
  store.emailVerifications = store.emailVerifications.filter(
    (row) => row.userId !== userId || row.usedAt !== null,
  );
  const row: EmailVerificationRow = { tokenHash, userId, expiresAt, createdAt: now(), usedAt: null };
  store.emailVerifications.push(row);
  persist();
  return row;
}

export function findEmailVerification(tokenHash: string): EmailVerificationRow | null {
  return store.emailVerifications.find((row) => row.tokenHash === tokenHash) ?? null;
}

/** Spend a verification token. Returns null when it is unknown, used or expired. */
export function consumeEmailVerification(tokenHash: string): EmailVerificationRow | null {
  const row = findEmailVerification(tokenHash);
  if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) return null;
  row.usedAt = now();
  persist();
  return row;
}

export function createPasswordReset(userId: string, tokenHash: string, expiresAt: Date): PasswordResetRow {
  store.passwordResets = store.passwordResets.filter(
    (row) => row.userId !== userId || row.usedAt !== null,
  );
  const row: PasswordResetRow = { tokenHash, userId, expiresAt, createdAt: now(), usedAt: null };
  store.passwordResets.push(row);
  persist();
  return row;
}

export function findPasswordReset(tokenHash: string): PasswordResetRow | null {
  return store.passwordResets.find((row) => row.tokenHash === tokenHash) ?? null;
}

/** Spend a reset token. Returns null when it is unknown, used or expired. */
export function consumePasswordReset(tokenHash: string): PasswordResetRow | null {
  const row = findPasswordReset(tokenHash);
  if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) return null;
  row.usedAt = now();
  persist();
  return row;
}

/* Expired links are dead weight; prune them on the mutation paths that create
   new ones rather than on a timer (this store has no scheduler). */
export function pruneAuthTokens(): void {
  const cutoff = Date.now();
  const before = store.emailVerifications.length + store.passwordResets.length;
  store.emailVerifications = store.emailVerifications.filter(
    (row) => row.expiresAt.getTime() > cutoff || row.usedAt === null,
  );
  store.passwordResets = store.passwordResets.filter(
    (row) => row.expiresAt.getTime() > cutoff || row.usedAt === null,
  );
  if (store.emailVerifications.length + store.passwordResets.length !== before) persist();
}

/* ── Suspension appeals — filed while the door is closed ────────────────── */

/** The public, hand-copy-safe reference for an appeal row. */
export function appealReference(id: string): string {
  return `APL-${id.replace(/^apl_/, "").slice(0, 6).toUpperCase()}`;
}

export function createOrgAppeal(orgId: string, reason: string): OrgAppealRow {
  const row: OrgAppealRow = {
    id: `apl_${randomUUID().slice(0, 8)}`,
    orgId,
    reason: reason.trim().slice(0, 1200),
    status: "OPEN",
    createdAt: now(),
  };
  store.orgAppeals.push(row);
  persist();
  return row;
}

export function findOpenAppealForOrg(orgId: string): OrgAppealRow | null {
  return store.orgAppeals.find((a) => a.orgId === orgId && a.status === "OPEN") ?? null;
}

export function findOrgAppealById(id: string): OrgAppealRow | null {
  return store.orgAppeals.find((a) => a.id === id) ?? null;
}

export function listOrgAppeals(): OrgAppealRow[] {
  return [...store.orgAppeals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Decide an appeal. A REINSTATED decision restores the organization's access. */
export function decideOrgAppeal(
  id: string,
  input: { decision: "UPHELD" | "REINSTATED"; reviewer: string; note: string },
): OrgAppealRow | null {
  const row = findOrgAppealById(id);
  if (!row) return null;
  row.status = input.decision;
  row.reviewer = input.reviewer.trim().slice(0, 120);
  row.reviewNote = input.note.trim().slice(0, 600);
  row.decidedAt = now();
  if (input.decision === "REINSTATED") setOrganizationStatus(row.orgId, "ACTIVE");
  persist();
  return row;
}

export function updateOrganizationPassword(orgId: string, passwordHash: string): OrganizationRow | null {
  const org = findOrganizationById(orgId);
  if (!org) return null;
  org.password = passwordHash;
  org.updatedAt = now();
  persist();
  return org;
}
