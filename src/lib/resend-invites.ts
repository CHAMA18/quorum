import { escapeEmailHtml, renderEmailHtml, renderEmailText, type EmailModel } from "@/lib/email-template";

export type InviteEmailStatus = "SENT" | "SKIPPED" | "FAILED";

export interface InviteEmailResult {
  status: InviteEmailStatus;
  detail: string;
  messageId?: string;
}

export async function sendWorkspaceInviteEmail(input: {
  to: string;
  inviterName: string;
  workspaceName: string;
  role: string;
  code: string;
  inviteUrl: string;
  inviteId: string;
  idempotencyKey?: string;
}): Promise<InviteEmailResult> {
  const edgeUrl = process.env.QUORUM_EDGE_URL?.trim().replace(/\/+$/, "");
  const edgeSecret = process.env.QUORUM_EDGE_SECRET?.trim();
  if (!edgeUrl || !edgeSecret) {
    return {
      status: "SKIPPED",
      detail: "Quorum's authenticated email relay is not configured; share the invite code directly.",
    };
  }

  const inviterName = input.inviterName || "A Quorum workspace administrator";
  const workspaceName = input.workspaceName || "your Quorum workspace";
  const roleName = input.role.replaceAll("_", " ").toLowerCase();
  const appUrl = new URL("/", input.inviteUrl).toString();
  const subject = input.inviterName
    ? `${input.inviterName} invited you to ${input.workspaceName || "Quorum"}`
    : `You're invited to ${input.workspaceName || "Quorum"}`;
  const model: EmailModel = {
    preheader: `${inviterName} invited you to ${workspaceName} on Quorum. Your ${roleName} invitation is ready.`,
    kicker: "Invitation",
    headline: "You have been invited",
    intro: `${inviterName} invited you to join ${workspaceName} on Quorum.`,
    tone: "action",
    facts: [
      { label: "Your role", value: roleName },
      { label: "Workspace", value: workspaceName },
      { label: "Expires", value: "In 14 days · single use" },
    ],
    bodyHtml: `<p style="margin:26px 0 8px;font:700 10px/14px ui-monospace,Menlo,Consolas,monospace;letter-spacing:1.8px;color:#7c7f87;">YOUR INVITATION CODE</p><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;background:#faf9f6;border:1px dashed #d8d2c6;border-radius:10px;"><tr><td align="center" style="padding:16px 10px;font:700 22px/28px ui-monospace,Menlo,Consolas,monospace;letter-spacing:5px;color:#17191d;">${escapeEmailHtml(input.code)}</td></tr></table>`,
    bodyText: `Your invitation code: ${input.code}`,
    ctaLabel: "Accept your invitation",
    ctaUrl: input.inviteUrl,
    ctaNote: "One secure link takes you straight to your Quorum registration.",
    footerNote:
      "This invitation expires in 14 days, can be used once, and is intended for this email address. Register using this same address. If you weren't expecting it, you can safely ignore this message.",
    recipient: input.to,
    appUrl,
    logoUrl: new URL("/images/quorum-email-mark.png", input.inviteUrl).toString(),
  };
  const text = renderEmailText(model);
  const html = renderEmailHtml(model);

  try {
    const response = await fetch(`${edgeUrl}/__edge/email`, {
      method: "POST",
      headers: {
        "x-quorum-edge-key": edgeSecret,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey ?? `team-invite/${input.inviteId}`,
      },
      body: JSON.stringify({ to: input.to, subject, html, text }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      id?: string | null;
      error?: string;
      detail?: string;
      status?: number;
    };
    if (!response.ok || payload.ok !== true) {
      const detail = payload.detail?.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240);
      if (response.status === 401) {
        return { status: "FAILED", detail: "Quorum's email relay rejected its service credential; check the Render and Worker edge secrets." };
      }
      if (response.status === 503) {
        return { status: "FAILED", detail: "Resend is not configured on Quorum's email relay." };
      }
      const providerStatus = payload.status;
      const status = providerStatus ?? response.status;
      const providerFailure = status === 401
        ? "Resend rejected its API key; check the Worker secret."
        : status === 403 || status === 422
          ? `Resend rejected the sender or recipient${detail ? `: ${detail}` : "; check the verified sender domain and recipient address."}`
          : `Resend did not accept the invitation (HTTP ${status})${detail ? `: ${detail}` : "."}`;
      return { status: "FAILED", detail: providerFailure };
    }
    return {
      status: "SENT",
      detail: "Resend accepted the invitation email through Quorum's Cloudflare relay.",
      ...(payload.id ? { messageId: payload.id } : {}),
    };
  } catch (error) {
    const cause = error instanceof Error ? (error as Error & { cause?: { code?: string } }).cause : undefined;
    const code = cause?.code?.replace(/[^A-Z0-9_]/gi, "").slice(0, 32);
    console.error("[team-invite] email relay request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: code || undefined,
    });
    return {
      status: "FAILED",
      detail: `Quorum could not reach its Cloudflare email relay${code ? ` (${code})` : ""}; the invite code is still available to share.`,
    };
  }
}
