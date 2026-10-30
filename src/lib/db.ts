import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { isWorkspaceRole, type WorkspaceRole } from "@/lib/permissions";

/**
 * Quorum's web-app store: one JSON file, no ORM, no native dependencies.
 *
 * Data is small (accounts, sessions, a standing committee, settings, pilot
 * requests, workspace invites), so the whole store is held in memory and
 * written back atomically (temp file + rename) after every change. Every
 * operation is synchronous, so a single Node process never interleaves two
 * writes. The file lives in `db/`, which is gitignored.
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

export interface SessionRow {
  id: string;
  token: string;
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

export type DeliveryChannel = "email" | "whatsapp";
export type DeliveryStatus = "SENT" | "SKIPPED" | "FAILED";

export interface NotificationDeliveryRow {
  id: string;
  notificationId: string;
  userId: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  detail: string;
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
  | "ORG_REACTIVATED"
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

export interface CommitteeMemberRow {
  id: string;
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
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgSessionRow {
  token: string;
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

interface StoreShape {
  workspaceId: string;
  users: UserRow[];
  sessions: SessionRow[];
  contacts: ContactRow[];
  committeeMembers: CommitteeMemberRow[];
  sittings: SittingRow[];
  scheduledMeetings: ScheduledMeetingRow[];
  settings: Record<string, string>;
  invites: InviteRow[];
  organizations: OrganizationRow[];
  orgSessions: OrgSessionRow[];
  orgPasswordResets: OrgPasswordResetRow[];
  stepUpLogs: StepUpLogRow[];
  notifications: NotificationRow[];
  notificationDeliveries: NotificationDeliveryRow[];
  oversightEvents: OversightEventRow[];
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
const LEGACY_FILE = path.join(process.cwd(), "db", "quorum-store.json");
const DATE_FIELDS = ["createdAt", "updatedAt", "expiresAt", "claimedAt", "usedAt", "readAt"] as const;

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

function load(): StoreShape {
  const empty: StoreShape = {
    workspaceId: randomUUID(),
    users: [],
    sessions: [],
    contacts: [],
    committeeMembers: [],
    sittings: [],
    scheduledMeetings: [],
    settings: {},
    invites: [],
    organizations: [],
    orgSessions: [],
    orgPasswordResets: [],
    stepUpLogs: [],
    notifications: [],
    notificationDeliveries: [],
    oversightEvents: [],
  };
  if (!existsSync(FILE)) {
    /* One-time migration: a pre-fix build kept the store inside
       .next/standalone/db (wiped on every rebuild). Rescue it to the
       durable location so accounts, sessions and receipts survive. */
    if (FILE !== LEGACY_FILE && existsSync(LEGACY_FILE)) {
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
    workspaceId: typeof raw.workspaceId === "string" && raw.workspaceId ? raw.workspaceId : randomUUID(),
    users: revive<UserRow>(raw.users).map((user) => ({ ...user, workspaceId: user.workspaceId || (typeof raw.workspaceId === "string" ? raw.workspaceId : "") })),
    sessions: revive<SessionRow>(raw.sessions),
    contacts: revive<ContactRow>(raw.contacts),
    committeeMembers: revive<CommitteeMemberRow>(raw.committeeMembers),
    sittings: reviveSittings(raw.sittings),
    scheduledMeetings: reviveMeetings(raw.scheduledMeetings),
    settings: (raw.settings as Record<string, string>) ?? {},
    invites: revive<InviteRow>(raw.invites),
    organizations: revive<OrganizationRow>(raw.organizations),
    orgSessions: revive<OrgSessionRow>(raw.orgSessions),
    orgPasswordResets: revive<OrgPasswordResetRow>(raw.orgPasswordResets),
    stepUpLogs: revive<StepUpLogRow>(raw.stepUpLogs),
    notifications: revive<NotificationRow>(raw.notifications),
    notificationDeliveries: revive<NotificationDeliveryRow>(raw.notificationDeliveries),
    oversightEvents: revive<OversightEventRow>(raw.oversightEvents),
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
if (!Array.isArray(store.scheduledMeetings)) store.scheduledMeetings = [];
if (!Array.isArray(store.organizations)) store.organizations = [];
if (!Array.isArray(store.orgSessions)) store.orgSessions = [];
if (!Array.isArray(store.orgPasswordResets)) store.orgPasswordResets = [];
if (!Array.isArray(store.stepUpLogs)) store.stepUpLogs = [];
if (!Array.isArray(store.notifications)) store.notifications = [];
if (!Array.isArray(store.notificationDeliveries)) store.notificationDeliveries = [];
if (!Array.isArray(store.oversightEvents)) store.oversightEvents = [];

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

function persist(): void {
  mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, FILE);
}

const now = () => new Date();
const newId = () => randomUUID();

/* ── Users ──────────────────────────────────────────────────────────────── */

export function findUserByEmail(email: string): UserRow | null {
  return store.users.find((user) => user.email === email) ?? null;
}

export function findUserById(id: string, workspaceId?: string): UserRow | null {
  return store.users.find((user) => user.id === id && (!workspaceId || user.workspaceId === workspaceId)) ?? null;
}

export function listUsers(workspaceId?: string): UserRow[] {
  const scopedWorkspace = workspaceId ?? store.users[0]?.workspaceId ?? store.workspaceId;
  return store.users.filter((user) => user.workspaceId === scopedWorkspace).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
}): UserRow {
  if (findUserByEmail(data.email)) throw new Error(`User already exists: ${data.email}`);
  const at = now();
  /* The first account owns the workspace. An invite can grant any other
     non-owner role, but it can never make the first account a non-owner. */
  const workspaceUsers = store.users.filter((user) => user.workspaceId === (data.workspaceId ?? store.workspaceId));
  const workspaceId = data.workspaceId ?? (workspaceUsers.length === 0 && store.users.length === 0 ? store.workspaceId : randomUUID());
  const scopedUsers = store.users.filter((existing) => existing.workspaceId === workspaceId);
  const role: WorkspaceRole = scopedUsers.length === 0 ? "OWNER" : data.role ?? "OFFICER";
  const user: UserRow = {
    id: newId(),
    workspaceId,
    name: data.name,
    email: data.email,
    password: data.password,
    emailVerified: data.emailVerified ?? false,
    organization: data.organization ?? null,
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
  if (secret) user.totpSecret = secret;
  if (secret === null) delete user.totpSecret;
  user.totpEnabled = enabled;
  user.updatedAt = now();
  persist();
  return user;
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

export function listStepUpLogs(take = 100): StepUpLogRow[] {
  return [...store.stepUpLogs].sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime()).slice(0, take);
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

/* ── Sessions ───────────────────────────────────────────────────────────── */

export function createSession(userId: string, expiresAt: Date, token: string): SessionRow {
  if (store.sessions.some((s) => s.token === token)) throw new Error("Session token collision");
  const session: SessionRow = { id: newId(), token, userId, expiresAt, createdAt: now() };
  store.sessions.push(session);
  persist();
  return session;
}

/** Looks up a session by its opaque token and returns it with its user. */
export function findSessionWithUser(token: string): { session: SessionRow; user: UserRow } | null {
  const session = store.sessions.find((s) => s.token === token);
  if (!session) return null;
  const user = findUserById(session.userId);
  return user ? { session, user } : null;
}

export function deleteSessionByToken(token: string): void {
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.token !== token);
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
  name: string;
  role: string;
  isChair: boolean;
  office?: CommitteeMemberRow["office"];
}): CommitteeMemberRow {
  const at = now();
  const row: CommitteeMemberRow = {
    id: `cmb_${randomUUID().slice(0, 8)}`,
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
  patch: Partial<Pick<CommitteeMemberRow, "name" | "role" | "isChair" | "status" | "office">>
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

/* ── Workspace invites ──────────────────────────────────────────────────── */

export function listInvites(take = 100, workspaceId = store.workspaceId): InviteRow[] {
  return store.invites.filter((invite) => invite.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}

export function findInviteById(id: string, workspaceId = store.workspaceId): InviteRow | null {
  return store.invites.find((invite) => invite.id === id && invite.workspaceId === workspaceId) ?? null;
}

export function findInviteByCode(code: string, workspaceId = store.workspaceId): InviteRow | null {
  return store.invites.find((invite) => invite.code === code && invite.workspaceId === workspaceId) ?? null;
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
  patch: Partial<Pick<InviteRow, "status" | "claimedBy" | "claimedByEmail" | "claimedAt">>,
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
    status: "ACTIVE",
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
  if (patch.status === "ACTIVE" || patch.status === "SUSPENDED") org.status = patch.status;
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
  if (store.orgSessions.some((s) => s.token === token)) throw new Error("Org session token collision");
  const session: OrgSessionRow = { token, orgId, expiresAt, createdAt: now() };
  store.orgSessions.push(session);
  persist();
  return session;
}

export function findOrgSessionWithOrg(token: string): { session: OrgSessionRow; org: OrganizationRow } | null {
  const session = store.orgSessions.find((s) => s.token === token);
  if (!session) return null;
  const org = findOrganizationById(session.orgId);
  return org ? { session, org } : null;
}

export function deleteOrgSessionByToken(token: string): void {
  const before = store.orgSessions.length;
  store.orgSessions = store.orgSessions.filter((s) => s.token !== token);
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
  status: "ACTIVE" | "SUSPENDED",
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

export function updateOrganizationPassword(orgId: string, passwordHash: string): OrganizationRow | null {
  const org = findOrganizationById(orgId);
  if (!org) return null;
  org.password = passwordHash;
  org.updatedAt = now();
  persist();
  return org;
}
