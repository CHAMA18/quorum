"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CheckCircle2,
  CircleAlert,
  Copy,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { SpecBar } from "@/components/quorum/reveal";
import { TeamInviteDeliveryActions } from "@/components/quorum/team-invite-delivery-actions";
import type { AuthUser } from "@/lib/auth-types";
import {
  ASSIGNABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  can,
  type AssignableRole,
  type WorkspaceRole,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Oversight — the scoped governance console.
 *
 * OWNER and ADMIN hold the writable console; AUDITOR sees the same people,
 * organizations and governance log with every mutation removed. The server
 * repeats the capability check on every route, so a hidden button is not the
 * permission. The audit trail (the sidecar's hash-chained tool log) stays a
 * separate read: this log records workspace authority, that one records the
 * agent's work.
 */

type TeamMember = {
  id: string;
  name: string;
  email: string;
  organization: string | null;
  role: WorkspaceRole;
  status: "ACTIVE" | "SUSPENDED";
  totpEnabled: boolean;
  sessions: number;
  joined: string;
  currentAccount: boolean;
};

type TeamInvite = {
  id: string;
  code: string | null;
  email: string | null;
  role: WorkspaceRole;
  status: "PENDING" | "CLAIMED" | "REVOKED";
  inviterName: string;
  claimedByEmail: string | null;
  emailDeliveryStatus: "SENT" | "SKIPPED" | "FAILED" | null;
  emailDeliveryDetail: string | null;
  emailDeliveryAttemptedAt: string | null;
  createdAt: string;
  expiresInDays: number;
};

type TeamPayload = {
  members: TeamMember[];
  invites: TeamInvite[];
  canManage: boolean;
  actorRole: WorkspaceRole;
  emailDeliveryConfigured: boolean;
};

type OrgRow = {
  id: string;
  name: string;
  email: string;
  registrationNo: string;
  country: string;
  status: "ACTIVE" | "SUSPENDED";
  sessions: number;
};

type OversightEvent = {
  id: string;
  actorName: string;
  action: string;
  targetType: "USER" | "ORGANIZATION" | "INVITE";
  targetName: string;
  detail: string;
  createdAt: string;
};

type OrgPayload = {
  organizations: OrgRow[];
  events: OversightEvent[];
  canManageOrgs: boolean;
  actorRole: WorkspaceRole;
};

type AppealRow = {
  id: string;
  reference: string;
  orgId: string;
  reason: string;
  status: "OPEN" | "UPHELD" | "REINSTATED";
  reviewer: string | null;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  organization: {
    id: string;
    name: string;
    email: string;
    registrationNo: string;
    status: "ACTIVE" | "SUSPENDED";
  } | null;
};

type AppealPayload = {
  appeals: AppealRow[];
  canDecide: boolean;
  actorRole: WorkspaceRole;
};

const ROLE_TONE: Record<WorkspaceRole, string> = {
  OWNER: "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300",
  ADMIN: "border-ink-300 bg-ink-50 text-ink-800 dark:border-white/15 dark:bg-white/[0.06] dark:text-ink-200",
  OFFICER: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300",
  COMMITTEE: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
  AUDITOR: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
};

const ACTION_LABEL: Record<string, string> = {
  ROLE_CHANGED: "Role changed",
  USER_SUSPENDED: "Member suspended",
  USER_REACTIVATED: "Member reactivated",
  SESSIONS_REVOKED: "Sessions revoked",
  ORG_SUSPENDED: "Organization suspended",
  ORG_REACTIVATED: "Organization reinstated",
  ORG_APPEAL_FILED: "Suspension appeal filed",
  ORG_APPEAL_UPHELD: "Suspension upheld on appeal",
  ORG_REINSTATED_ON_APPEAL: "Reinstated on appeal",
  INVITE_REVOKED: "Invite revoked",
};

function stamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "Q"
  );
}

function RoleChip({ role }: { role: WorkspaceRole }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 font-code text-[8px] font-bold tracking-[0.16em]",
        ROLE_TONE[role],
      )}
    >
      {ROLE_LABELS[role].toUpperCase()}
    </span>
  );
}

export function OversightView({
  actor,
  onToast,
  onOpenAudit,
}: {
  actor: AuthUser | null;
  onToast: (message: string) => void;
  onOpenAudit: () => void;
}) {
  const [team, setTeam] = useState<TeamPayload | null>(null);
  const [orgs, setOrgs] = useState<OrgPayload | null>(null);
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const [appealDrafts, setAppealDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("OFFICER");
  const [freshInvite, setFreshInvite] = useState<{
    code: string;
    email: string | null;
    role: WorkspaceRole;
    delivery: { status: "SENT" | "SKIPPED" | "FAILED"; detail: string };
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<OrgRow | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, orgRes, appealRes] = await Promise.all([
        fetch("/api/team", { cache: "no-store" }),
        fetch("/api/oversight", { cache: "no-store" }),
        fetch("/api/oversight/appeals", { cache: "no-store" }).catch(() => null),
      ]);
      if (teamRes.status === 403 || orgRes.status === 403) {
        setLoadError("Your workspace role does not open the oversight console.");
        setTeam(null);
        setOrgs(null);
        setAppeals([]);
        return;
      }
      if (!teamRes.ok || !orgRes.ok) throw new Error("failed");
      setTeam((await teamRes.json()) as TeamPayload);
      setOrgs((await orgRes.json()) as OrgPayload);
      if (appealRes?.ok) {
        const payload = (await appealRes.json()) as AppealPayload;
        setAppeals(payload.appeals ?? []);
      } else {
        setAppeals([]);
      }
      setLoadError(null);
    } catch {
      setLoadError("The governance console is unreachable right now. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const actorRole = team?.actorRole ?? orgs?.actorRole ?? actor?.role ?? "OFFICER";
  const canManage = team?.canManage === true && can(actorRole, "manage_people");
  const canManageOrgs = orgs?.canManageOrgs === true && can(actorRole, "manage_orgs");
  const readOnly = !canManage && !canManageOrgs;

  const inviteRoles = useMemo<AssignableRole[]>(
    () => (actorRole === "OWNER" ? [...ASSIGNABLE_ROLES] : ASSIGNABLE_ROLES.filter((role) => role !== "ADMIN")),
    [actorRole],
  );

  useEffect(() => {
    if (!inviteRoles.includes(inviteRole)) setInviteRole(inviteRoles[0] ?? "OFFICER");
  }, [inviteRole, inviteRoles]);

  const stats = useMemo(() => {
    const members = team?.members ?? [];
    const organizations = orgs?.organizations ?? [];
    const owners = members.filter((member) => member.role === "OWNER").length;
    const auditors = members.filter((member) => member.role === "AUDITOR").length;
    return [
      {
        label: "WORKSPACE MEMBERS",
        value: String(members.length),
        note: `${members.filter((m) => m.status === "ACTIVE").length} active · ${owners} owner${owners === 1 ? "" : "s"}`,
      },
      {
        label: "READ-ONLY AUDITORS",
        value: String(auditors),
        note: "Oversight without a writable surface",
      },
      {
        label: "ORGANIZATIONS",
        value: String(organizations.length),
        note: `${organizations.filter((o) => o.status === "SUSPENDED").length} suspended`,
      },
      {
        label: "GOVERNANCE EVENTS",
        value: String(orgs?.events.length ?? 0),
        note: "Recent changes on this desk",
      },
    ];
  }, [team, orgs]);

  const editableMember = (member: TeamMember): boolean => {
    if (!canManage || member.currentAccount) return false;
    if (actorRole === "ADMIN" && (member.role === "OWNER" || member.role === "ADMIN")) return false;
    if (member.role === "OWNER" && actorRole !== "OWNER") return false;
    return true;
  };

  const changeRole = async (member: TeamMember, role: WorkspaceRole) => {
    if (role === member.role || busy) return;
    setBusy(`role:${member.id}`);
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, role }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Role change failed.");
      onToast(`${member.name.toUpperCase()} IS NOW ${ROLE_LABELS[role].toUpperCase()}`);
      await load();
    } catch (err) {
      onToast((err as Error).message.toUpperCase());
    } finally {
      setBusy(null);
    }
  };

  const setMemberStatus = async (member: TeamMember, status: "ACTIVE" | "SUSPENDED") => {
    if (busy) return;
    setBusy(`status:${member.id}`);
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member.id,
          status,
          reason: status === "SUSPENDED" ? "Access suspended from the oversight console" : "Access reinstated from the oversight console",
        }),
      });
      const data = (await res.json()) as { error?: string; revokedSessions?: number };
      if (!res.ok) throw new Error(data.error ?? "Status change failed.");
      onToast(
        status === "SUSPENDED"
          ? `${member.name.toUpperCase()} SUSPENDED · ${data.revokedSessions ?? 0} SESSION${data.revokedSessions === 1 ? "" : "S"} REVOKED`
          : `${member.name.toUpperCase()} REACTIVATED`,
      );
      await load();
    } catch (err) {
      onToast((err as Error).message.toUpperCase());
    } finally {
      setBusy(null);
    }
  };

  const revokeSessions = async (member: TeamMember) => {
    if (busy) return;
    setBusy(`sessions:${member.id}`);
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, revokeSessions: true, reason: "Sessions revoked from the oversight console" }),
      });
      const data = (await res.json()) as { error?: string; revokedSessions?: number };
      if (!res.ok) throw new Error(data.error ?? "Session revocation failed.");
      onToast(`${data.revokedSessions ?? 0} SESSION${data.revokedSessions === 1 ? "" : "S"} REVOKED`);
      await load();
    } catch (err) {
      onToast((err as Error).message.toUpperCase());
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    if (!canManage || busy) return;
    setBusy("invite");
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() || undefined, role: inviteRole }),
      });
      const data = (await res.json()) as {
        invite?: { code: string; email: string | null; role: WorkspaceRole };
        delivery?: { status: "SENT" | "SKIPPED" | "FAILED"; detail: string };
        error?: string;
      };
      if (!res.ok || !data.invite) throw new Error(data.error ?? "Invite failed.");
      const delivery = data.delivery ?? { status: "SKIPPED" as const, detail: "Invite created; share the code directly." };
      setFreshInvite({ ...data.invite, delivery });
      setCopied(false);
      setInviteEmail("");
      onToast(delivery.status === "SENT"
        ? `INVITATION EMAIL ACCEPTED BY RESEND — ${data.invite.email}`
        : `INVITE CREATED · ${delivery.detail}`);
      await load();
    } catch (err) {
      onToast((err as Error).message.toUpperCase());
    } finally {
      setBusy(null);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    if (!canManage || busy) return;
    setBusy(`invite:${inviteId}`);
    try {
      const res = await fetch(`/api/team?inviteId=${encodeURIComponent(inviteId)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Revoke failed.");
      onToast("INVITE REVOKED");
      await load();
    } catch (err) {
      onToast((err as Error).message.toUpperCase());
    } finally {
      setBusy(null);
    }
  };

  const copyInvite = async () => {
    if (!freshInvite) return;
    try {
      await navigator.clipboard.writeText(freshInvite.code);
      setCopied(true);
      onToast("CODE COPIED — PASTE IT INTO REGISTRATION");
    } catch {
      onToast("COPY FAILED — SELECT THE CODE MANUALLY");
    }
  };

  const patchOrg = async (org: OrgRow, status: "ACTIVE" | "SUSPENDED", reason: string) => {
    if (!canManageOrgs || busy) return;
    setBusy(`org:${org.id}`);
    try {
      const res = await fetch("/api/oversight", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id, status, reason }),
      });
      const data = (await res.json()) as { error?: string; revokedSessions?: number };
      if (!res.ok) throw new Error(data.error ?? "Organization change failed.");
      onToast(
        status === "SUSPENDED"
          ? `${org.name.toUpperCase()} SUSPENDED · ${data.revokedSessions ?? 0} SESSION${data.revokedSessions === 1 ? "" : "S"} REVOKED`
          : `${org.name.toUpperCase()} REINSTATED`,
      );
      setSuspendTarget(null);
      setSuspendReason("");
      await load();
    } catch (err) {
      onToast((err as Error).message.toUpperCase());
    } finally {
      setBusy(null);
    }
  };

  const decideAppeal = async (appeal: AppealRow, decision: "UPHELD" | "REINSTATED") => {
    if (!canManageOrgs || busy) return;
    const note = (appealDrafts[appeal.id] ?? "").trim();
    if (note.length < 4) {
      onToast("RECORD THE REASON FOR THE DECISION — IT GOES ON THE GOVERNANCE LOG");
      return;
    }
    setBusy(`appeal:${appeal.id}`);
    try {
      const res = await fetch(`/api/oversight/appeals/${encodeURIComponent(appeal.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const data = (await res.json()) as { error?: string; revokedSessions?: number };
      if (!res.ok) throw new Error(data.error ?? "Appeal decision failed.");
      onToast(
        decision === "REINSTATED"
          ? `${appeal.organization?.name.toUpperCase() ?? "ORGANIZATION"} REINSTATED ON APPEAL`
          : `${appeal.reference} UPHELD — THE SUSPENSION STANDS`,
      );
      setAppealDrafts((prev) => {
        const next = { ...prev };
        delete next[appeal.id];
        return next;
      });
      await load();
    } catch (err) {
      onToast((err as Error).message.toUpperCase());
    } finally {
      setBusy(null);
    }
  };

  const card = "rounded-[12px] panel overflow-hidden";
  const label = "font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-ink-400";

  return (
    <div className="space-y-6">
      <div>
        <SpecBar index="GOV" label="Workspace" meta="Oversight" />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <h1 className="type-display text-[30px] text-ink-950 sm:text-[38px]">
              Oversight<span className="text-brand-600">.</span>
            </h1>
            <p className="type-lede mt-3 text-ink-600">
              Who holds workspace authority, which organizations may use the desk, and every change to either. The
              console is scoped by role: owners and admins hold the writable surface, auditors read it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 items-center gap-2 rounded-full border border-ink-200 bg-white px-3 font-code text-[8.5px] font-bold tracking-[0.16em] text-ink-600">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {actorRole} · {readOnly ? "READ-ONLY" : "WRITABLE"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="focus-brand inline-flex h-8 items-center gap-2 rounded-full border border-ink-200 bg-white px-3 font-code text-[8px] font-bold tracking-[0.14em] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden="true" />
              REFRESH
            </button>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5 text-[12.5px] leading-relaxed text-brand-900">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{loadError}</p>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Oversight summary">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-ink-200/80 bg-white px-4 py-3.5">
                <p className="font-code text-[7.5px] font-bold tracking-[0.2em] text-ink-400">{stat.label}</p>
                <p className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-ink-950 tabular">{stat.value}</p>
                <p className="mt-0.5 text-[10.5px] text-ink-500">{stat.note}</p>
              </div>
            ))}
          </section>

          {readOnly && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-[12px] leading-relaxed text-emerald-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                You are signed in as an <strong>auditor</strong>. You can read the roster, organization register and
                governance log, but no control on this page writes. That is enforced on the server, not by hiding
                buttons.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <section className={card} aria-labelledby="oversight-members">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                  <div>
                    <p className={label}>PEOPLE</p>
                    <h2 id="oversight-members" className="mt-1 font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">
                      Workspace members
                    </h2>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                      A role is workspace authority. The committee roster is separate: a member still needs a seat and
                      an office before a gate accepts their signature.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.14em] text-ink-500">
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {team?.members.length ?? 0}
                  </span>
                </div>

                {loading && !team ? (
                  <div className="flex items-center gap-2 px-5 py-8 text-[12px] text-ink-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Reading workspace authority…
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {(team?.members ?? []).map((member) => {
                      const editable = editableMember(member);
                      const roleOptions: WorkspaceRole[] =
                        member.role === "OWNER" ? ["OWNER", ...inviteRoles] : ["ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"];
                      return (
                        <li key={member.id} className="px-5 py-4">
                          <div className="flex flex-wrap items-start gap-3">
                            <span
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 font-code text-[10px] font-bold text-white"
                              aria-hidden="true"
                            >
                              {initialsOf(member.name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-[13px] font-semibold text-ink-950">{member.name}</p>
                                <RoleChip role={member.role} />
                                {member.status === "SUSPENDED" && (
                                  <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-red-700">
                                    SUSPENDED
                                  </span>
                                )}
                                {member.currentAccount && (
                                  <span className="rounded-full border border-ink-200 bg-white px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-500">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate font-code text-[8px] tracking-[0.12em] text-ink-500">
                                {member.email.toUpperCase()}
                                {member.organization ? ` · ${member.organization}` : ""}
                              </p>
                              <p className="mt-1 text-[10.5px] text-ink-400">
                                {member.sessions} live session{member.sessions === 1 ? "" : "s"} · 2FA{" "}
                                {member.totpEnabled ? "enrolled" : "not enrolled"} · joined {stamp(member.joined)}
                              </p>
                            </div>
                            {editable && (
                              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                                <select
                                  value={member.role}
                                  disabled={busy === `role:${member.id}`}
                                  onChange={(e) => void changeRole(member, e.target.value as WorkspaceRole)}
                                  aria-label={`Role for ${member.name}`}
                                  className="h-8 rounded-lg border border-ink-200 bg-white px-2 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700 outline-none focus:border-ink-950 disabled:opacity-50"
                                >
                                  {roleOptions.map((role) => (
                                    <option
                                      key={role}
                                      value={role}
                                      disabled={role === "OWNER" ? actorRole !== "OWNER" : !inviteRoles.includes(role as AssignableRole)}
                                    >
                                      {ROLE_LABELS[role].toUpperCase()}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void revokeSessions(member)}
                                  disabled={busy !== null || member.sessions === 0}
                                  title="Revoke every live session for this member"
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-950 disabled:opacity-40"
                                >
                                  {busy === `sessions:${member.id}` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                  )}
                                  SESSIONS
                                </button>
                                {member.status === "ACTIVE" ? (
                                  <button
                                    type="button"
                                    onClick={() => void setMemberStatus(member, "SUSPENDED")}
                                    disabled={busy !== null}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
                                  >
                                    <ShieldOff className="h-3 w-3" aria-hidden="true" />
                                    SUSPEND
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void setMemberStatus(member, "ACTIVE")}
                                    disabled={busy !== null}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40"
                                  >
                                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                    REACTIVATE
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          {editable && (
                            <p className="mt-2 pl-[52px] text-[10.5px] leading-relaxed text-ink-400">
                              {ROLE_DESCRIPTIONS[member.role]}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {canManage && (
                <section className={card} aria-labelledby="oversight-invites">
                  <div className="border-b border-ink-100 px-5 py-4">
                    <p className={label}>INVITATIONS</p>
                    <h2 id="oversight-invites" className="mt-1 font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">
                      Bring someone in
                    </h2>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                      The invite sets the account&apos;s role at registration. Codes are single-use, read-aloud safe and
                      expire in 14 days. {actorRole === "ADMIN" && "Admins can grant officer, committee and auditor access, but never admin."}
                    </p>
                  </div>
                  <div className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@authority.go.ke"
                        aria-label="Colleague email"
                        className="h-10 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-400"
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as AssignableRole)}
                        aria-label="Role for this invite"
                        className="h-10 rounded-lg border border-ink-200 bg-white px-3 font-code text-[9px] font-bold tracking-[0.14em] text-ink-700 outline-none"
                      >
                        {inviteRoles.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role].toUpperCase()}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void invite()}
                        disabled={busy !== null}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink-950 px-4 font-code text-[9px] font-bold tracking-[0.16em] text-white transition-colors hover:bg-ink-800 disabled:opacity-60"
                      >
                        {busy === "invite" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                        CREATE INVITE
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                      {team?.emailDeliveryConfigured
                        ? "Enter a work email to send this invitation through Resend. The recipient link opens registration with the code filled in."
                        : "Email delivery is not configured on this deployment. Quorum will create a shareable code instead."}
                    </p>

                    {freshInvite && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
                        <span className="font-code text-[13px] font-bold tracking-[0.18em] text-brand-800" aria-live="polite">
                          {freshInvite.code}
                        </span>
                        <span className="rounded-full border border-brand-200 bg-white px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em] text-brand-800">
                          {freshInvite.role}
                        </span>
                        {freshInvite.email && <span className="truncate text-[11px] text-brand-800">for {freshInvite.email}</span>}
                        <span role="status" className={cn("text-[11px]", freshInvite.delivery.status === "SENT" ? "text-emerald-800" : freshInvite.delivery.status === "FAILED" ? "text-brand-800" : "text-ink-500")}>
                          {freshInvite.delivery.detail}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyInvite()}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3 py-1 font-code text-[8px] font-bold tracking-[0.14em] text-brand-800 transition-colors hover:bg-brand-100"
                        >
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          {copied ? "COPIED" : "COPY CODE"}
                        </button>
                      </div>
                    )}

                    {(team?.invites.length ?? 0) > 0 && (
                      <ul className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
                        {team?.invites.map((inviteRow) => (
                          <li key={inviteRow.id} className="flex flex-wrap items-center gap-2.5 py-2.5">
                            <span className="font-code text-[10.5px] font-bold tracking-[0.16em] text-ink-950">
                              {inviteRow.code ?? "———"}
                            </span>
                            <RoleChip role={inviteRow.role} />
                            {inviteRow.email && <span className="truncate text-[11px] text-ink-400">for {inviteRow.email}</span>}
                            <span className="truncate text-[10px] text-ink-400">
                              {inviteRow.status === "CLAIMED"
                                ? `claimed by ${inviteRow.claimedByEmail ?? "a member"}`
                                : inviteRow.status === "REVOKED"
                                  ? "revoked"
                                  : `expires in ${inviteRow.expiresInDays} day${inviteRow.expiresInDays === 1 ? "" : "s"}`}
                            </span>
                            {inviteRow.status === "PENDING" && (
                              <TeamInviteDeliveryActions
                                invite={inviteRow}
                                canManage={canManage}
                                disabled={busy !== null}
                                onToast={onToast}
                                onUpdated={() => { void load(); }}
                              />
                            )}
                            {inviteRow.status === "PENDING" && (
                              <button
                                type="button"
                                onClick={() => void revokeInvite(inviteRow.id)}
                                disabled={busy !== null}
                                className="ml-auto rounded-full border border-ink-200 px-2.5 py-1 font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-500 transition-colors hover:border-brand-200 hover:text-brand-800 disabled:opacity-40"
                              >
                                REVOKE
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              <section className={card} aria-labelledby="oversight-orgs">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                  <div>
                    <p className={label}>SUPPLIER SIDE</p>
                    <h2 id="oversight-orgs" className="mt-1 font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">
                      Organizations
                    </h2>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                      Suspending an organization deletes its live portal sessions. The portal checks status on every
                      request, so an old cookie cannot outlive the decision.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.14em] text-ink-500">
                    <Building2 className="h-3 w-3" aria-hidden="true" />
                    {orgs?.organizations.length ?? 0}
                  </span>
                </div>
                {(orgs?.organizations.length ?? 0) === 0 ? (
                  <p className="px-5 py-8 text-[12px] text-ink-500">No supplier organization has registered yet.</p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {orgs?.organizations.map((org) => (
                      <li key={org.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-200 bg-paper font-code text-[9px] font-bold text-ink-600" aria-hidden="true">
                          {initialsOf(org.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13px] font-semibold text-ink-950">{org.name}</p>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em]",
                                org.status === "ACTIVE"
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                  : "border-red-300 bg-red-50 text-red-700",
                              )}
                            >
                              {org.status}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate font-code text-[8px] tracking-[0.12em] text-ink-500">
                            {org.registrationNo.toUpperCase()} · {org.country.toUpperCase()} · {org.email.toUpperCase()}
                          </p>
                          <p className="mt-1 text-[10.5px] text-ink-400">
                            {org.sessions} live portal session{org.sessions === 1 ? "" : "s"}
                          </p>
                        </div>
                        {canManageOrgs && (
                          <div className="shrink-0">
                            {org.status === "ACTIVE" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSuspendTarget(org);
                                  setSuspendReason("");
                                }}
                                disabled={busy !== null}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
                              >
                                <ShieldOff className="h-3 w-3" aria-hidden="true" />
                                SUSPEND
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void patchOrg(org, "ACTIVE", "Reinstated from the oversight console")}
                                disabled={busy !== null}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40"
                              >
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                REINSTATE
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className={card} aria-labelledby="oversight-appeals">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                  <div>
                    <p className={label}>SUPPLIER SIDE</p>
                    <h2 id="oversight-appeals" className="mt-1 font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">
                      Suspension appeals
                    </h2>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                      A suspended organization files an appeal while its door is closed. Reinstating restores access and
                      revokes live sessions; upholding leaves the suspension standing. Both decisions are logged.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper px-2.5 py-1 font-code text-[8px] font-bold tracking-[0.14em] text-ink-500">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    {appeals.filter((appeal) => appeal.status === "OPEN").length} OPEN
                  </span>
                </div>
                {appeals.length === 0 ? (
                  <p className="px-5 py-8 text-[12px] text-ink-500">No suspension appeal has been filed.</p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {appeals.map((appeal) => {
                      const open = appeal.status === "OPEN";
                      return (
                        <li key={appeal.id} className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13px] font-semibold text-ink-950">
                              {appeal.organization?.name ?? "Organization removed"}
                            </p>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 font-code text-[7.5px] font-bold tracking-[0.14em]",
                                appeal.status === "OPEN"
                                  ? "border-amber-300 bg-amber-50 text-amber-900"
                                  : appeal.status === "REINSTATED"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                    : "border-ink-300 bg-ink-50 text-ink-700",
                              )}
                            >
                              {appeal.status}
                            </span>
                            <span className="font-code text-[7.5px] font-bold tracking-[0.14em] text-ink-400">{appeal.reference}</span>
                          </div>
                          <p className="mt-0.5 truncate font-code text-[8px] tracking-[0.12em] text-ink-500">
                            {appeal.organization?.registrationNo.toUpperCase() ?? "—"} · FILED {stamp(appeal.createdAt).toUpperCase()}
                          </p>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-600">{appeal.reason}</p>
                          {!open && appeal.reviewer ? (
                            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">
                              Decided by {appeal.reviewer}: {appeal.reviewNote ?? "—"}
                            </p>
                          ) : null}
                          {open && canManageOrgs ? (
                            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                              <input
                                value={appealDrafts[appeal.id] ?? ""}
                                onChange={(e) => setAppealDrafts((prev) => ({ ...prev, [appeal.id]: e.target.value }))}
                                maxLength={600}
                                placeholder="Reason for the decision (required)"
                                aria-label={`Decision reason for ${appeal.reference}`}
                                className="h-8 rounded-lg border border-ink-200 bg-white px-2.5 text-[11.5px] text-ink-950 outline-none placeholder:text-ink-400 focus:border-ink-400"
                              />
                              <button
                                type="button"
                                onClick={() => void decideAppeal(appeal, "REINSTATED")}
                                disabled={busy !== null || (appealDrafts[appeal.id] ?? "").trim().length < 4}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40"
                              >
                                {busy === `appeal:${appeal.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                                REINSTATE
                              </button>
                              <button
                                type="button"
                                onClick={() => void decideAppeal(appeal, "UPHELD")}
                                disabled={busy !== null || (appealDrafts[appeal.id] ?? "").trim().length < 4}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 font-code text-[7.5px] font-bold tracking-[0.12em] text-ink-600 transition-colors hover:border-ink-400 disabled:opacity-40"
                              >
                                <ShieldOff className="h-3 w-3" aria-hidden="true" />
                                UPHOLD
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            <aside className="space-y-5">
              <section className={cn(card, "xl:sticky xl:top-[76px]")} aria-labelledby="oversight-log">
                <div className="border-b border-ink-100 px-4 py-4">
                  <p className={label}>GOVERNANCE</p>
                  <h2 id="oversight-log" className="mt-1 font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">
                    Change log
                  </h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                    Workspace authority, recorded in the desk store.
                  </p>
                </div>
                <ol className="max-h-[520px] divide-y divide-ink-100 overflow-y-auto">
                  {(orgs?.events ?? []).map((event) => (
                    <li key={event.id} className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Activity className="h-3 w-3 shrink-0 text-ink-400" aria-hidden="true" />
                        <p className="font-code text-[8px] font-bold tracking-[0.14em] text-ink-700">
                          {(ACTION_LABEL[event.action] ?? event.action).toUpperCase()}
                        </p>
                      </div>
                      <p className="mt-1 text-[11.5px] font-semibold text-ink-950">{event.targetName}</p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">{event.detail}</p>
                      <p className="mt-1 font-code text-[7.5px] tracking-[0.1em] text-ink-400">
                        {event.actorName.toUpperCase()} · {stamp(event.createdAt).toUpperCase()}
                      </p>
                    </li>
                  ))}
                  {orgs?.events.length === 0 && (
                    <li className="px-4 py-8 text-[11.5px] text-ink-400">No governance change has been recorded yet.</li>
                  )}
                </ol>
                <div className="border-t border-ink-100 px-4 py-3">
                  <button
                    type="button"
                    onClick={onOpenAudit}
                    className="focus-brand inline-flex w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2.5 font-code text-[8px] font-bold tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                      OPEN THE AUDIT TRAIL
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                  <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
                    The tool log is separate from this register: it records every agent step and gate receipt.
                  </p>
                </div>
              </section>

              <section className="rounded-[12px] border border-ink-200 bg-paper/70 p-4">
                <p className={label}>SCOPE</p>
                <dl className="mt-3 space-y-2.5">
                  {(["OWNER", "ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"] as WorkspaceRole[]).map((role) => (
                    <div key={role} className="flex items-start gap-2.5">
                      <RoleChip role={role} />
                      <dd className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-ink-500">{ROLE_DESCRIPTIONS[role]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </aside>
          </div>
        </>
      )}

      {suspendTarget && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-night/70 p-4 backdrop-blur-sm"
          onClick={() => {
            if (busy === null) setSuspendTarget(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspend-org-title"
            className="w-full max-w-md rounded-[12px] panel panel-lift p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-code text-[8px] font-semibold uppercase tracking-[0.22em] text-brand-700">SUPPLIER ACCESS</p>
                <h2 id="suspend-org-title" className="mt-2 font-display text-[22px] font-black tracking-[-0.02em] text-ink-950">
                  Suspend {suspendTarget.name}?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSuspendTarget(null)}
                disabled={busy !== null}
                aria-label="Close"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-200 text-ink-500 hover:bg-ink-50 disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
              Every live portal session is revoked immediately. The reason goes on the governance log.
            </p>
            <label className="mt-4 block">
              <span className="font-code text-[8px] font-semibold uppercase tracking-[0.2em] text-ink-400">Reason</span>
              <textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                rows={3}
                maxLength={400}
                placeholder="e.g. tax clearance revoked by the regulator — pending re-verification"
                className="mt-1.5 w-full resize-y rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[12.5px] text-ink-950 outline-none placeholder:text-ink-400 focus:border-ink-400"
              />
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setSuspendTarget(null)}
                disabled={busy !== null}
                className="h-9 rounded-lg border border-ink-200 px-4 font-code text-[8px] font-bold tracking-[0.14em] text-ink-600 hover:border-ink-400 disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => void patchOrg(suspendTarget, "SUSPENDED", suspendReason)}
                disabled={busy !== null || suspendReason.trim().length < 4}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-700 px-4 font-code text-[8px] font-bold tracking-[0.14em] text-white transition-colors hover:bg-red-800 disabled:opacity-50"
              >
                {busy === `org:${suspendTarget.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />}
                SUSPEND ACCESS
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && !loadError && !team && (
        <div className="flex items-center gap-2 text-[12px] text-ink-500">
          <UserCog className="h-4 w-4" aria-hidden="true" />
          No workspace authority could be read.
        </div>
      )}
    </div>
  );
}
