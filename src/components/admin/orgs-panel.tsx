"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Globe2,
  Loader2,
  Search,
  ShieldCheck,
  ShieldOff,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminAppeal, AdminOrganization } from "@/lib/admin-types";
import {
  Button,
  Chip,
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

type Dialog = { kind: "suspend"; org: AdminOrganization } | { kind: "reinstate"; org: AdminOrganization } | null;

export function OrganizationsPanel({ data, refresh, notify, query, setQuery, now }: PanelProps) {
  const [status, setStatus] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [appealNotes, setAppealNotes] = useState<Record<string, string>>({});

  const canManage = data.actor.canManageOrgs;
  const openAppeals = data.appeals.filter((appeal) => appeal.status === "OPEN");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.organizations.filter((org) => {
      if (status !== "ALL" && org.status !== status) return false;
      if (!needle) return true;
      return `${org.name} ${org.email} ${org.registrationNo} ${org.country} ${org.categories.join(" ")}`
        .toLowerCase()
        .includes(needle);
    });
  }, [data.organizations, query, status]);

  const updateOrg = async (org: AdminOrganization, next: "ACTIVE" | "SUSPENDED", why: string) => {
    setBusy(`org:${org.id}`);
    try {
      const res = await fetch("/api/oversight", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id, status: next, reason: why }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; revokedSessions?: number };
      if (!res.ok) throw new Error(body.error ?? "The organization change was refused.");
      notify(
        next === "SUSPENDED"
          ? `${org.name} suspended · ${fmtNum(body.revokedSessions ?? 0)} portal session(s) revoked.`
          : `${org.name} reinstated.`,
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

  const decide = async (appeal: AdminAppeal, decision: "REINSTATED" | "UPHELD") => {
    const note = (appealNotes[appeal.id] ?? "").trim();
    if (note.length < 4) {
      notify("Record the reason for the decision — it goes on the governance log.", "error");
      return;
    }
    setBusy(`appeal:${appeal.id}`);
    try {
      const res = await fetch(`/api/oversight/appeals/${encodeURIComponent(appeal.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; revokedSessions?: number };
      if (!res.ok) throw new Error(body.error ?? "The appeal decision was refused.");
      notify(
        decision === "REINSTATED"
          ? `${appeal.organization?.name ?? "Organization"} reinstated on appeal.`
          : `${appeal.reference} upheld — the suspension stands.`,
        "ok",
      );
      setAppealNotes((prev) => {
        const next = { ...prev };
        delete next[appeal.id];
        return next;
      });
      await refresh(true);
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHead
        index="03"
        eyebrow="The supplier door"
        title={
          <>
            The other side <span className="text-brand-600">of the desk.</span>
          </>
        }
        lede={
          <>
            Organizations hold their own identity space and their own cookie. Suspending one deletes its live sessions
            and blocks new applications — and a suspended supplier always keeps one lawful way back: an appeal, decided
            by a named reviewer.
          </>
        }
        actions={
          canManage ? (
            <Chip tone="emerald" dot>Writable register</Chip>
          ) : (
            <Chip tone="emerald" dot>Read-only</Chip>
          )
        }
      />

      <div className="panel grid grid-cols-2 divide-x divide-y divide-ink-100 overflow-hidden rounded-2xl sm:grid-cols-4 dark:divide-white/8">
        {[
          { label: "Organizations", value: fmtNum(data.organizations.length), note: "on the register" },
          {
            label: "Active",
            value: fmtNum(data.organizations.filter((org) => org.status === "ACTIVE").length),
            note: "may sign in and bid",
          },
          {
            label: "Suspended",
            value: fmtNum(data.organizations.filter((org) => org.status === "SUSPENDED").length),
            note: "door closed, sessions gone",
          },
          { label: "Open appeals", value: fmtNum(openAppeals.length), note: "awaiting a named decision" },
        ].map((stat) => (
          <div key={stat.label} className="px-4 py-3.5">
            <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">{stat.label}</p>
            <p className="mt-1.5 type-num text-[24px] text-ink-950">{stat.value}</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-600">{stat.note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <Panel>
            <PanelHead
              eyebrow="Register"
              title="Supplier organizations"
              description="The profile the supplier door collects is the one the procurement desk asks bidders to hold."
              action={<Chip tone="neutral">{fmtNum(filtered.length)} shown</Chip>}
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-white/8">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find by name, registration number, country…"
                  aria-label="Search organizations"
                  className={cn(inputCls, "w-full pl-8")}
                />
              </div>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
                aria-label="Filter organizations by status"
                className={selectCls}
              >
                <option value="ALL">ANY STATUS</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>

            {filtered.length === 0 ? (
              <Empty
                title="No organization matches"
                body={
                  data.organizations.length === 0
                    ? "The supplier register is empty. Organizations register through their own door; nothing is invented here."
                    : "Adjust the search or status filter to see the rest of the register."
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {filtered.map((org) => (
                  <li key={org.id} className="grid items-center gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_130px_auto]">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-lg border font-code text-[10px] font-bold",
                          org.status === "SUSPENDED"
                            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                            : "border-ink-200 bg-paper-2 text-ink-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-ink-300",
                        )}
                        aria-hidden="true"
                      >
                        {initialsOf(org.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-[12.5px] font-semibold text-ink-950">{org.name}</p>
                          <Chip tone={org.status === "ACTIVE" ? "emerald" : "red"} dot>{org.status}</Chip>
                        </div>
                        <p className="mt-0.5 truncate text-[10.5px] text-ink-600">
                          {org.registrationNo} · {org.country}
                          {org.legalForm ? ` · ${org.legalForm}` : ""}
                        </p>
                        <p className="truncate text-[11px] text-ink-600">
                          {org.email}
                          {org.categories.length > 0 ? ` · ${org.categories.slice(0, 3).join(" / ")}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="hidden flex-col gap-0.5 lg:flex">
                      <span className="font-code text-[10px] font-bold uppercase tracking-[0.06em] text-ink-600">
                        {org.sessions} portal session{org.sessions === 1 ? "" : "s"}
                      </span>
                      <span className="text-[10.5px] text-ink-600">
                        joined {fmtDay(org.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                      {canManage ? (
                        org.status === "ACTIVE" ? (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setReason("");
                              setDialog({ kind: "suspend", org });
                            }}
                          >
                            <ShieldOff className="h-3 w-3" aria-hidden="true" /> SUSPEND
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => setDialog({ kind: "reinstate", org })}>
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> REINSTATE
                          </Button>
                        )
                      ) : (
                        <span className="font-code text-[10px] uppercase tracking-[0.06em] text-ink-600">Read only</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5 xl:col-span-4">
          <Panel>
            <PanelHead
              eyebrow="Appeals"
              title="A closed door's way back"
              description="Filed without a session, matched by email and registration number, decided with a stated reason."
              action={<Chip tone={openAppeals.length ? "amber" : "neutral"} dot>{openAppeals.length} open</Chip>}
            />
            {data.appeals.length === 0 ? (
              <Empty title="No appeal on file" body="No organization has contested a suspension. The register is uncontested, not unexamined." />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-white/8">
                {data.appeals.slice(0, 6).map((appeal) => {
                  const open = appeal.status === "OPEN";
                  return (
                    <li key={appeal.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-950">
                          {appeal.organization?.name ?? "Organization removed"}
                        </p>
                        <Chip
                          tone={appeal.status === "OPEN" ? "amber" : appeal.status === "REINSTATED" ? "emerald" : "neutral"}
                          dot
                        >
                          {appeal.status}
                        </Chip>
                      </div>
                      <p className="mt-0.5 truncate text-[10.5px] text-ink-600">
                        {appeal.reference} · {appeal.organization?.registrationNo ?? "—"} · filed {fmtAgo(appeal.createdAt, now)}
                      </p>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">{appeal.reason}</p>
                      {!open && appeal.reviewer && (
                        <p className="mt-1 rounded-lg bg-paper-2/70 px-2 py-1.5 text-[10px] leading-relaxed text-ink-500 dark:bg-white/[0.03]">
                          <strong className="text-ink-700">{appeal.reviewer}</strong>: {appeal.reviewNote ?? "—"}
                        </p>
                      )}
                      {open && canManage && (
                        <div className="mt-2 space-y-1.5">
                          <input
                            value={appealNotes[appeal.id] ?? ""}
                            onChange={(event) =>
                              setAppealNotes((prev) => ({ ...prev, [appeal.id]: event.target.value }))
                            }
                            maxLength={600}
                            placeholder="Reason for the decision (required)"
                            aria-label={`Decision reason for ${appeal.reference}`}
                            className={cn(inputCls, "w-full text-[13px]")}
                          />
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="brand"
                              disabled={busy !== null || (appealNotes[appeal.id] ?? "").trim().length < 4}
                              onClick={() => void decide(appeal, "REINSTATED")}
                            >
                              {busy === `appeal:${appeal.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                              REINSTATE
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy !== null || (appealNotes[appeal.id] ?? "").trim().length < 4}
                              onClick={() => void decide(appeal, "UPHELD")}
                            >
                              <ShieldOff className="h-3 w-3" aria-hidden="true" /> UPHOLD
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-4 py-3.5 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <Scale className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Why this is separate</p>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
              A supplier organization is not a workspace member: different table, different cookie, different door. The
              officer roster records who reviews; this register records who may bid. Keeping them apart means one
              compromise cannot open the other.
            </p>
          </div>

          <div className="rounded-2xl border border-ink-200/80 bg-paper-2/60 px-4 py-3.5 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <Globe2 className="h-3.5 w-3.5 text-ink-400" aria-hidden="true" />
              <p className="font-code text-[10px] font-bold uppercase tracking-[0.1em] text-ink-600">Register hygiene</p>
            </div>
            <ul className="mt-2 space-y-1.5 text-[10.5px] leading-relaxed text-ink-500">
              <li>Registration numbers are unique across the register.</li>
              <li>A suspension records a reason and revokes every live portal session.</li>
              <li>One open appeal per organization; a decision is final until a fresh suspension.</li>
              <li>Late bids and duplicate bids are refused by the portal, not by this console.</li>
            </ul>
          </div>
        </div>
      </div>

      <Modal
        open={dialog?.kind === "suspend"}
        onClose={() => setDialog(null)}
        eyebrow="Close the supplier door"
        title={`Suspend ${dialog?.kind === "suspend" ? dialog.org.name : "organization"}?`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>CANCEL</Button>
            <Button
              variant="danger"
              disabled={busy !== null || reason.trim().length < 4}
              onClick={() => {
                if (dialog?.kind === "suspend") void updateOrg(dialog.org, "SUSPENDED", reason.trim());
              }}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />}
              SUSPEND &amp; REVOKE
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-ink-600">
            The organization loses every live portal session and is refused at sign-in and on new applications. The
            reason is written to the governance log. An appeal remains available to them.
          </p>
          <Field label="Reason" hint="At least four characters. This is permanent in the record.">
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={400}
              rows={3}
              autoFocus
              placeholder="Why is the supplier door being closed?"
              className="w-full resize-none rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12px] text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-500 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-900"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={dialog?.kind === "reinstate"}
        onClose={() => setDialog(null)}
        eyebrow="Open the supplier door"
        title={`Reinstate ${dialog?.kind === "reinstate" ? dialog.org.name : "organization"}?`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>CANCEL</Button>
            <Button
              variant="brand"
              disabled={busy !== null}
              onClick={() => {
                if (dialog?.kind === "reinstate") void updateOrg(dialog.org, "ACTIVE", "Reinstated from the control room");
              }}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              REINSTATE
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-600">
          The organization may sign in again and file applications. The suspension stays in the governance log — this
          reopens the door, it does not erase the closure.
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
