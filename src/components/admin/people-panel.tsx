"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Copy,
  Fingerprint,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminInvite, AdminPerson } from "@/lib/admin-types";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type WorkspaceRole,
} from "@/lib/permissions";
import {
  Button,
  Chip,
  Dot,
  Empty,
  Field,
  fmtAgo,
  fmtDay,
  fmtNum,
  inputCls,
  Modal,
  Panel,
  PanelHead,
  SectionHead,
  selectCls,
} from "@/components/admin/kit";
import type { PanelProps } from "@/components/admin/types";

type Dialog =
  | { kind: "role"; person: AdminPerson; role: WorkspaceRole }
  | { kind: "suspend"; person: AdminPerson }
  | { kind: "sessions"; person: AdminPerson }
  | { kind: "invite" }
  | { kind: "revoke"; invite: AdminInvite }
  | null;

const ROLE_ORDER: WorkspaceRole[] = ["OWNER", "ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"];

const ROLE_TONE: Record<WorkspaceRole, "brand" | "neutral" | "sky" | "amber" | "emerald"> = {
  OWNER: "brand",
  ADMIN: "neutral",
  OFFICER: "sky",
  COMMITTEE: "amber",
  AUDITOR: "emerald",
};

const ACTION_LABEL: Record<string, string> = {
  ROLE_CHANGED: "Role changed",
  USER_SUSPENDED: "Member suspended",
  USER_REACTIVATED: "Member reactivated",
  SESSIONS_REVOKED: "Sessions revoked",
  INVITE_REVOKED: "Invite revoked",
};

export function PeoplePanel({ data, refresh, notify, query, setQuery, now }: PanelProps) {
  const [role, setRole] = useState<"ALL" | WorkspaceRole>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("OFFICER");
  const [freshInvite, setFreshInvite] = useState<{
    code: string;
    email: string | null;
    role: string;
    delivery: { status: string; detail: string };
  } | null>(null);

  const canManage = data.actor.canManagePeople;
  const roles = data.actor.role === "OWNER"
    ? (["ADMIN", "OFFICER", "COMMITTEE", "AUDITOR"] as WorkspaceRole[])
    : (["OFFICER", "COMMITTEE", "AUDITOR"] as WorkspaceRole[]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.people.filter((person) => {
      if (role !== "ALL" && person.role !== role) return false;
      if (statusFilter !== "ALL" && person.status !== statusFilter) return false;
      if (!needle) return true;
      return `${person.name} ${person.email} ${person.organization ?? ""} ${person.role}`
        .toLowerCase()
        .includes(needle);
    });
  }, [data.people, query, role, statusFilter]);

  const liveSessions = data.people.reduce((sum, person) => sum + person.sessions, 0);
  const twoFactor = data.people.filter((person) => person.totpEnabled).length;
  const suspended = data.people.filter((person) => person.status === "SUSPENDED").length;
  const pendingInvites = data.invites.filter((invite) => invite.status === "PENDING");

  const editable = (person: AdminPerson): boolean => {
    if (!canManage || person.currentAccount) return false;
    if (person.role === "OWNER") return false;
    if (data.actor.role === "ADMIN" && person.role === "ADMIN") return false;
    return true;
  };

  const call = async (input: string, init: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(input, init);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "The change was refused.");
    return body;
  };

  const changeRole = async () => {
    if (!dialog || dialog.kind !== "role") return;
    setBusy("role");
    try {
      await call("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: dialog.person.id, role: dialog.role, reason: "Changed in administration" }),
      });
      notify(`${dialog.person.name} is now ${ROLE_LABELS[dialog.role]}.`, "ok");
      setDialog(null);
      await refresh(true);
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (person: AdminPerson, next: "ACTIVE" | "SUSPENDED", why: string) => {
    setBusy("status");
    try {
      const body = await call("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.id, status: next, reason: why }),
      });
      notify(
        next === "SUSPENDED"
          ? `${person.name} suspended · ${fmtNum(Number(body.revokedSessions ?? 0))} session(s) revoked.`
          : `${person.name} reactivated.`,
        "ok",
      );
      setDialog(null);
      setReason("");
      await refresh(true);
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const revokeSessions = async (person: AdminPerson) => {
    setBusy("sessions");
    try {
      const body = await call("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.id, revokeSessions: true, reason: "Revoked in administration" }),
      });
      notify(`${fmtNum(Number(body.revokedSessions ?? 0))} session(s) revoked for ${person.name}.`, "ok");
      setDialog(null);
      await refresh(true);
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const createInvite = async () => {
    setBusy("invite");
    try {
      const body = await call("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() || undefined, role: inviteRole }),
      });
      const invite = body.invite as { code: string; email: string | null; role: string } | undefined;
      const delivery = (body.delivery as { status: string; detail: string } | undefined) ?? {
        status: "SKIPPED",
        detail: "Invite created; share the code directly.",
      };
      if (!invite) throw new Error("The invite was not created.");
      setFreshInvite({ ...invite, delivery });
      setInviteEmail("");
      setDialog(null);
      notify(
        delivery.status === "SENT"
          ? `Invitation email accepted for ${invite.email}.`
          : `Invite created · ${delivery.detail}`,
        "ok",
      );
      await refresh(true);
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const revokeInvite = async (invite: AdminInvite) => {
    setBusy("revoke");
    try {
      await call(`/api/team?inviteId=${encodeURIComponent(invite.id)}`, { method: "DELETE" });
      notify("Invitation revoked.", "ok");
      setDialog(null);
      await refresh(true);
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied.`, "ok");
    } catch {
      notify("Copy failed — select the value manually.", "error");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHead
        index="02"
        eyebrow="People & authority"
        title={
          <>
            People, roles <span className="text-brand-600">and permissions.</span>
          </>
        }
        lede={
          <>
            Workspace roles determine which administrative actions each person can take. Committee membership is
            managed separately, and only assigned members can approve committee decisions.
          </>
        }
        actions={
          canManage ? (
            <Button variant="solid" onClick={() => setDialog({ kind: "invite" })}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              INVITE SOMEONE
            </Button>
          ) : (
            <Chip tone="emerald" dot>Read-only auditor</Chip>
          )
        }
      />

      <div className="panel grid grid-cols-2 divide-x divide-y divide-ink-100 overflow-hidden rounded-2xl sm:grid-cols-4 dark:divide-white/8">
        {[
          { label: "People", value: fmtNum(data.people.length), note: `${suspended} suspended` },
          { label: "Active sign-ins", value: fmtNum(liveSessions), note: "checked on every request" },
          { label: "Two-step sign-in", value: `${twoFactor}/${data.people.length}`, note: "authenticator app enabled" },
          { label: "Pending invites", value: fmtNum(pendingInvites.length), note: "single-use · 14 days" },
        ].map((stat) => (
          <div key={stat.label} className="px-4 py-3.5">
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{stat.label}</p>
            <p className="mt-1.5 type-num text-[24px] text-ink-950">{stat.value}</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">{stat.note}</p>
          </div>
        ))}
      </div>

      {freshInvite && canManage && (
        <div className="panel flex flex-wrap items-center gap-3 rounded-2xl border-brand-200 bg-brand-50/80 px-4 py-3 dark:border-brand-500/30 dark:bg-brand-500/10">
          <div className="min-w-0">
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-brand-800 dark:text-brand-300">
              NEW INVITATION · {freshInvite.role}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-code text-[14px] font-bold tracking-[0.16em] text-brand-900 dark:text-brand-200">
                {freshInvite.code}
              </span>
              {freshInvite.email && <span className="text-[11px] text-brand-800 dark:text-brand-300">for {freshInvite.email}</span>}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-brand-800 dark:text-brand-200">{freshInvite.delivery.detail}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => void copy(freshInvite.code, "Invite code")}>
              <Copy className="h-3 w-3" aria-hidden="true" /> CODE
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void copy(
                  `${window.location.origin}/?inviteCode=${encodeURIComponent(freshInvite.code)}#/register`,
                  "Invitation link",
                )
              }
            >
              <Copy className="h-3 w-3" aria-hidden="true" /> LINK
            </Button>
            <button
              type="button"
              onClick={() => setFreshInvite(null)}
              aria-label="Dismiss invitation"
              className="focus-brand grid h-11 w-11 shrink-0 place-items-center rounded-lg text-brand-700 transition-colors hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-500/20"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <Panel>
            <PanelHead
              eyebrow="The register"
              title="Workspace members"
              description="Roles control workspace access. Committee membership and office are managed separately for approval decisions."
              action={<Chip tone="neutral">{fmtNum(filtered.length)} shown</Chip>}
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-white/8">
              <div className="relative min-w-[180px] flex-1">
                <Users className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a person by name, email or role…"
                  aria-label="Search people"
                  className={cn(inputCls, "w-full pl-8")}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by role">
                {(["ALL", ...ROLE_ORDER] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRole(value)}
                    aria-pressed={role === value}
                    className={cn(
                      "focus-brand inline-flex min-h-11 items-center rounded-lg border px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
                      role === value
                        ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-[#0b0c0f]"
                        : "border-ink-200 bg-white text-ink-500 hover:border-ink-400 dark:border-white/12 dark:bg-transparent dark:text-ink-400",
                    )}
                  >
                    {value === "ALL" ? "ALL" : ROLE_LABELS[value].toUpperCase()}
                  </button>
                ))}
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                aria-label="Filter by status"
                className={selectCls}
              >
                <option value="ALL">ANY STATUS</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>

            {filtered.length === 0 ? (
              <Empty
                title="No member matches"
                body={
                  data.people.length === 0
                    ? "This workspace has no members yet. The first account owns it."
                    : "Clear the search or the filters — nobody in this register matches them."
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {filtered.map((person) => {
                  const canEdit = editable(person);
                  const isOpen = expanded === person.id;
                  const personEvents = data.governance
                    .filter((event) => event.targetName === person.name)
                    .slice(0, 3);
                  return (
                    <li key={person.id}>
                      <div className="grid items-center gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_148px_118px_auto]">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : person.id)}
                          aria-expanded={isOpen}
                          className="focus-brand flex min-w-0 items-center gap-3 text-left"
                        >
                          <span
                            className={cn(
                              "grid h-9 w-9 shrink-0 place-items-center rounded-full font-code text-[10px] font-bold text-white",
                              person.status === "SUSPENDED" ? "bg-ink-400" : "bg-brand-600",
                            )}
                            aria-hidden="true"
                          >
                            {initialsOf(person.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[12.5px] font-semibold text-ink-950">{person.name}</span>
                              {person.currentAccount && <Chip tone="neutral">you</Chip>}
                              {person.status === "SUSPENDED" && <Chip tone="red" dot>suspended</Chip>}
                              {person.totpEnabled && (
                                <span title="Authenticator enrolled">
                                  <ShieldCheck className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-ink-600">
                              {person.email}
                              {person.organization ? ` · ${person.organization}` : ""}
                            </span>
                          </span>
                          <ChevronDown
                            className={cn("h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform", isOpen && "rotate-180")}
                            aria-hidden="true"
                          />
                        </button>

                        <div className="flex items-center gap-1.5">
                          {canEdit ? (
                            <select
                              value={person.role}
                              onChange={(event) =>
                                setDialog({
                                  kind: "role",
                                  person,
                                  role: event.target.value as WorkspaceRole,
                                })
                              }
                              aria-label={`Role for ${person.name}`}
                              className={selectCls}
                            >
                              <option value={person.role}>{ROLE_LABELS[person.role].toUpperCase()}</option>
                              {roles
                                .filter((option) => option !== person.role)
                                .map((option) => (
                                  <option key={option} value={option}>
                                    {ROLE_LABELS[option].toUpperCase()}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <Chip tone={ROLE_TONE[person.role]}>{ROLE_LABELS[person.role]}</Chip>
                          )}
                        </div>

                        <div className="hidden flex-col gap-0.5 lg:flex">
                          <span className="font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600">
                            {person.sessions} session{person.sessions === 1 ? "" : "s"}
                          </span>
                          <span className="font-code text-[10px] tracking-[0.04em] text-ink-600">
                            {person.totpEnabled ? "2FA ON" : "2FA OFF"}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {canEdit ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => setDialog({ kind: "sessions", person })}
                                disabled={person.sessions === 0}
                                title={`Revoke ${person.sessions} live session(s)`}
                              >
                                <RotateCcw className="h-3 w-3" aria-hidden="true" /> SESSIONS
                              </Button>
                              {person.status === "ACTIVE" ? (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => {
                                    setReason("");
                                    setDialog({ kind: "suspend", person });
                                  }}
                                >
                                  <ShieldOff className="h-3 w-3" aria-hidden="true" /> SUSPEND
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => void changeStatus(person, "ACTIVE", "Access reinstated in administration")}
                                  disabled={busy !== null}
                                >
                                  {busy === "status" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
                                  REACTIVATE
                                </Button>
                              )}
                            </>
                          ) : (
                            <span className="font-code text-[10px] uppercase tracking-[0.06em] text-ink-600">
                              {person.currentAccount ? "SELF" : person.role === "OWNER" ? "OWNER" : "—"}
                            </span>
                          )}
                        </div>
                      </div>

                      {isOpen && (
                        <div className="border-t border-ink-100 bg-paper-2/50 px-5 py-3.5 dark:border-white/8 dark:bg-white/[0.02]">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div>
                              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Joined</p>
                              <p className="mt-1 text-[11.5px] text-ink-800">{fmtDay(person.joined)}</p>
                              <p className="text-[10.5px] text-ink-600">{fmtAgo(person.joined, now)}</p>
                            </div>
                            <div>
                              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Authority</p>
                              <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{ROLE_DESCRIPTIONS[person.role]}</p>
                            </div>
                            <div>
                              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Second factor</p>
                              <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-800">
                                <Fingerprint className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
                                {person.totpEnabled ? "Authenticator enrolled" : "Not enrolled"}
                              </p>
                              <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">
                                {person.sessions} live session{person.sessions === 1 ? "" : "s"} on this deployment
                              </p>
                            </div>
                          </div>
                          {personEvents.length > 0 && (
                            <div className="mt-3 border-t border-ink-200/70 pt-2.5 dark:border-white/8">
                              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">
                                Governance activity for this person
                              </p>
                              <ul className="mt-1.5 space-y-1">
                                {personEvents.map((event) => (
                                  <li key={event.id} className="flex flex-wrap items-baseline gap-1.5 text-[10.5px] text-ink-500">
                                    <span className="font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-800">
                                      {ACTION_LABEL[event.action] ?? event.action}
                                    </span>
                                    <span>{event.detail}</span>
                                    <span className="text-ink-600">· {event.actorName} · {fmtAgo(event.createdAt, now)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5 xl:col-span-4">
          <Panel>
            <PanelHead
              eyebrow="Invitations"
              title="Bring someone in"
              description={canManage ? "The invite sets the role at registration. Codes are single-use, read-aloud safe and expire in 14 days." : "Auditors see that invitations exist, never the code that would claim one."}
              action={canManage ? <Button size="sm" onClick={() => setDialog({ kind: "invite" })}><Plus className="h-3 w-3" aria-hidden="true" /> NEW</Button> : undefined}
            />
            {data.invites.length === 0 ? (
              <Empty title="No invitations yet" body={canManage ? "Create an invitation when a colleague joins the workspace." : "Nothing to show here."} />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {data.invites.slice(0, 8).map((invite) => (
                  <li key={invite.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-code text-[10.5px] font-bold tracking-[0.14em] text-ink-950">
                        {invite.code ?? "••••••••"}
                      </span>
                      <Chip tone={invite.role === "ADMIN" ? "neutral" : "sky"}>{ROLE_LABELS[invite.role]}</Chip>
                      <Chip tone={invite.status === "PENDING" ? "amber" : invite.status === "CLAIMED" ? "emerald" : "neutral"} dot>
                        {invite.status}
                      </Chip>
                      {invite.code && (
                        <button
                          type="button"
                          onClick={() => void copy(invite.code ?? "", "Invite code")}
                          aria-label="Copy invite code"
                          className="focus-brand ml-auto grid min-h-11 min-w-11 place-items-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-950 dark:hover:bg-white/[0.06] dark:hover:text-white"
                        >
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[10.5px] text-ink-500">
                      {invite.email ?? "no recipient yet"} ·{" "}
                      {invite.status === "PENDING"
                        ? `expires in ${invite.expiresInDays} day${invite.expiresInDays === 1 ? "" : "s"}`
                        : `issued ${fmtAgo(invite.createdAt, now)}`}
                      {invite.emailDeliveryStatus && invite.emailDeliveryStatus !== "SKIPPED"
                        ? ` · email ${invite.emailDeliveryStatus.toLowerCase()}`
                        : ""}
                    </p>
                    {canManage && invite.status === "PENDING" && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {invite.email && (
                          <Button
                            size="sm"
                            onClick={() =>
                              void copy(
                                `${window.location.origin}/?inviteCode=${encodeURIComponent(invite.code ?? "")}#/register`,
                                "Invitation link",
                              )
                            }
                          >
                            <Mail className="h-3 w-3" aria-hidden="true" /> LINK
                          </Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => setDialog({ kind: "revoke", invite })}>
                          REVOKE
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHead eyebrow="Doctrine" title="What each role opens" description="The matrix is small and server-side. A role is a capability set, not a badge." />
            <ul className="divide-y divide-ink-100 dark:divide-white/8">
              {ROLE_ORDER.map((roleName) => (
                <li key={roleName} className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <Chip tone={ROLE_TONE[roleName]}>{ROLE_LABELS[roleName]}</Chip>
                    <span className="ml-auto font-code text-[10px] tabular text-ink-600">
                      {data.people.filter((person) => person.role === roleName).length}
                    </span>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">{ROLE_DESCRIPTIONS[roleName]}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-4 py-3.5 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <UserCog className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">The limits</p>
            </div>
            <ul className="mt-2 space-y-1.5 text-[10.5px] leading-relaxed text-ink-500">
              <li>You cannot change your own role or suspend yourself.</li>
              <li>An admin can never grant admin or touch the owner.</li>
              <li>A workspace keeps one active owner; ownership transfer is not a dropdown.</li>
              <li>Suspension revokes live sessions immediately — checked on every request.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Role change */}
      <Modal
        open={dialog?.kind === "role"}
        onClose={() => setDialog(null)}
        eyebrow="Workspace authority"
        title={`Change ${dialog?.kind === "role" ? dialog.person.name : "member"} to ${dialog?.kind === "role" ? ROLE_LABELS[dialog.role] : ""}?`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>CANCEL</Button>
            <Button variant="brand" onClick={() => void changeRole()} disabled={busy !== null}>
              {busy === "role" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
              APPLY THE ROLE
            </Button>
          </>
        }
      >
        {dialog?.kind === "role" && (
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-ink-600">
              {ROLE_DESCRIPTIONS[dialog.role]}
            </p>
            <div className="rounded-xl border border-ink-200 bg-paper-2/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                  <p className="font-code text-[10px] font-bold uppercase tracking-[0.08em] text-ink-600">Effect</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
                This takes effect on {dialog.person.name.split(" ")[0]}&apos;s next request. The change is written to the
                governance log with your name against it.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Suspend */}
      <Modal
        open={dialog?.kind === "suspend"}
        onClose={() => setDialog(null)}
        eyebrow="Close the door"
        title={`Suspend ${dialog?.kind === "suspend" ? dialog.person.name : "member"}?`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>CANCEL</Button>
            <Button
              variant="danger"
              disabled={busy !== null || reason.trim().length < 4}
              onClick={() => {
                if (dialog?.kind === "suspend") void changeStatus(dialog.person, "SUSPENDED", reason.trim());
              }}
            >
              {busy === "status" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />}
              SUSPEND &amp; REVOKE
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-ink-600">
            Every live session is deleted and the account is refused on its next request. Reactivating is one click;
            the reason below is permanent in the governance log.
          </p>
          <Field label="Reason" hint="At least four characters. This goes on the record with your name.">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={400}
              autoFocus
              placeholder="Why is this access being closed?"
              className={cn(inputCls, "w-full")}
            />
          </Field>
        </div>
      </Modal>

      {/* Sessions */}
      <Modal
        open={dialog?.kind === "sessions"}
        onClose={() => setDialog(null)}
        eyebrow="Live sessions"
        title={`Revoke ${dialog?.kind === "sessions" ? fmtNum(dialog.person.sessions) : ""} session(s)?`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>CANCEL</Button>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                if (dialog?.kind === "sessions") void revokeSessions(dialog.person);
              }}
            >
              {busy === "sessions" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              REVOKE NOW
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-600">
          {dialog?.kind === "sessions" ? dialog.person.name : "This member"} will be signed out of every browser on this
          deployment. Their password and second factor are untouched — this closes open doors, it does not change the
          lock.
        </p>
      </Modal>

      {/* Invite */}
      <Modal
        open={dialog?.kind === "invite"}
        onClose={() => setDialog(null)}
        eyebrow="New invitation"
        title="Invite a colleague"
        footer={
          <>
            <Button onClick={() => setDialog(null)}>CANCEL</Button>
            <Button variant="brand" onClick={() => void createInvite()} disabled={busy !== null}>
              {busy === "invite" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              CREATE INVITE
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Recipient email" hint="Optional. With an email and configured delivery, the invite is sent; otherwise share the code.">
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              autoFocus
              placeholder="colleague@authority.go.ke"
              className={cn(inputCls, "w-full")}
            />
          </Field>
          <Field label="Role at registration">
            <div className="flex flex-wrap gap-1.5">
              {roles.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setInviteRole(option)}
                  aria-pressed={inviteRole === option}
                  className={cn(
                    "focus-brand inline-flex min-h-11 items-center rounded-lg border px-3 py-2 font-code text-[10px] font-bold uppercase tracking-[0.06em] transition-colors",
                    inviteRole === option
                      ? "border-ink-950 bg-ink-950 text-white dark:border-white dark:bg-white dark:text-[#0b0c0f]"
                      : "border-ink-200 bg-white text-ink-600 hover:border-ink-400 dark:border-white/12 dark:bg-transparent dark:text-ink-400",
                  )}
                >
                  {ROLE_LABELS[option]}
                </button>
              ))}
            </div>
          </Field>
          <p className="text-[11.5px] leading-relaxed text-ink-600">
            {ROLE_DESCRIPTIONS[inviteRole]}{" "}
            {data.actor.role === "ADMIN" ? "Admins can grant officer, committee and auditor access, but never admin." : ""}
          </p>
        </div>
      </Modal>

      {/* Revoke invite */}
      <Modal
        open={dialog?.kind === "revoke"}
        onClose={() => setDialog(null)}
        eyebrow="Revoke invitation"
        title="Void this code?"
        footer={
          <>
            <Button onClick={() => setDialog(null)}>KEEP IT</Button>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                if (dialog?.kind === "revoke") void revokeInvite(dialog.invite);
              }}
            >
              {busy === "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              REVOKE
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-600">
          {dialog?.kind === "revoke" && dialog.invite.email
            ? `The invitation for ${dialog.invite.email}`
            : "This invitation"}{" "}
          stops working immediately. Anyone holding the code is refused at registration. Creating a fresh invite is the
          way back.
        </p>
      </Modal>
    </div>
  );
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
