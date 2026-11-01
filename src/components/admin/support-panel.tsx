"use client";

import { useState } from "react";
import { LifeBuoy, MessageSquareText, Send } from "lucide-react";
import type { AdminSupportRequest } from "@/lib/admin-types";
import { Button, Chip, Empty, fmtStamp, Panel, PanelHead, SectionHead } from "@/components/admin/kit";
import type { PanelProps } from "@/components/admin/types";

function RequestCard({
  request,
  canReply,
  notify,
  refresh,
}: {
  request: AdminSupportRequest;
  canReply: boolean;
  notify: PanelProps["notify"];
  refresh: PanelProps["refresh"];
}) {
  const [response, setResponse] = useState("");
  const [sending, setSending] = useState(false);

  const sendReply = async () => {
    if (!response.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/support-requests/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: response.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The response could not be sent.");
      setResponse("");
      notify(`Response sent to ${request.requesterName}.`, "ok");
      await refresh(true);
    } catch (error) {
      notify((error as Error).message || "The response could not be sent.", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="border-b border-ink-100 px-5 py-5 last:border-b-0 dark:border-white/8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-[16px] font-black tracking-[-0.01em] text-ink-950">{request.subject}</h3>
            <Chip tone={request.status === "OPEN" ? "amber" : request.status === "RESPONDED" ? "emerald" : "neutral"}>
              {request.status}
            </Chip>
            <Chip tone="brand">FROM BARRY</Chip>
          </div>
          <p className="mt-1.5 text-[10px] text-ink-500">
            {request.requesterName} · {request.requesterEmail} · sent {fmtStamp(request.createdAt)}
          </p>
        </div>
        {request.status === "OPEN" ? <span className="inline-flex items-center gap-1.5 font-code text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Needs reply</span> : null}
      </div>

      <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50/70 px-4 py-3 dark:border-white/8 dark:bg-white/[0.025]">
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-800">{request.message}</p>
      </div>

      {request.response ? (
        <div className="mt-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/[0.05]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-code text-[8px] font-bold uppercase tracking-[0.16em] text-emerald-800 dark:text-emerald-300">Response · {request.respondedBy ?? "Support"}</p>
            <p className="font-code text-[8px] text-ink-400">{fmtStamp(request.respondedAt)}</p>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-800">{request.response}</p>
        </div>
      ) : null}

      {canReply && request.status !== "CLOSED" ? (
        <div className="mt-4 grid gap-2">
          <label htmlFor={`support-reply-${request.id}`} className="font-code text-[8px] font-bold uppercase tracking-[0.16em] text-ink-500">
            {request.response ? "Update response" : "Write a response"}
          </label>
          <textarea
            id={`support-reply-${request.id}`}
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="Write a clear reply for the requester…"
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-ink-950 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-500 dark:border-white/12 dark:bg-white/[0.04] dark:text-ink-100 dark:placeholder:text-ink-500 dark:focus:border-white/30"
          />
          <div className="flex justify-end">
            <Button variant="brand" size="sm" onClick={() => void sendReply()} disabled={sending || response.trim().length < 2}>
              <Send className="h-3 w-3" aria-hidden="true" /> {sending ? "Sending…" : "Send response"}
            </Button>
          </div>
        </div>
      ) : !canReply ? (
        <p className="mt-3 text-[10px] text-ink-400">Only workspace owners and admins can send support responses.</p>
      ) : null}
    </article>
  );
}

export function SupportPanel({ data, refresh, notify }: PanelProps) {
  const requests = data.supportRequests;
  const open = requests.filter((request) => request.status === "OPEN").length;
  const responded = requests.filter((request) => request.status === "RESPONDED").length;

  return (
    <div className="space-y-6">
      <SectionHead
        index="08"
        eyebrow="Barry · Quorum support"
        title={<>A person at the other <span className="text-brand-600">end.</span></>}
        lede="Manual support requests sent from Barry appear here with the requester’s details. Owners and admins can write a reply; the requester sees it in Barry’s Support tab."
        aside={<Chip tone={open ? "amber" : "neutral"}>{open} waiting for a reply</Chip>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "All requests", value: requests.length, icon: LifeBuoy },
          { label: "Waiting for reply", value: open, icon: MessageSquareText },
          { label: "Responded", value: responded, icon: Send },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="panel flex items-center gap-3 rounded-xl px-4 py-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"><Icon className="h-4 w-4" aria-hidden="true" /></span>
            <span><span className="block font-code text-[8px] font-bold uppercase tracking-[0.15em] text-ink-400">{label}</span><span className="mt-0.5 block font-display text-[20px] font-black text-ink-950">{value}</span></span>
          </div>
        ))}
      </div>

      <Panel>
        <PanelHead
          eyebrow="Workspace inbox"
          title="Support requests"
          description="Replies are saved to the request and shown to the original requester in Barry’s Support tab."
          action={<Chip tone="neutral">{requests.length} total</Chip>}
        />
        {requests.length ? (
          <div>
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                canReply={data.actor.canManagePeople}
                notify={notify}
                refresh={refresh}
              />
            ))}
          </div>
        ) : (
          <Empty title="No support requests yet" body="When someone sends a manual request from Barry’s Support tab, it will arrive here for a human reply." />
        )}
      </Panel>
    </div>
  );
}
