export type InviteEmailStatus = "SENT" | "SKIPPED" | "FAILED";

export interface InviteEmailResult {
  status: InviteEmailStatus;
  detail: string;
  messageId?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
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

  const inviter = escapeHtml(input.inviterName);
  const workspace = escapeHtml(input.workspaceName || "your Quorum workspace");
  const role = escapeHtml(input.role.replaceAll("_", " ").toLowerCase());
  const code = escapeHtml(input.code);
  const url = escapeHtml(input.inviteUrl);
  const subject = `${input.inviterName} invited you to join Quorum`;
  const text = [
    `${input.inviterName} invited you to join ${input.workspaceName || "their Quorum workspace"} as ${input.role.replaceAll("_", " ").toLowerCase()}.`,
    "",
    `Accept the invitation: ${input.inviteUrl}`,
    `Invite code: ${input.code}`,
    "",
    "Register with the email address this invitation was sent to. This invite expires in 14 days.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f3ef;color:#15171a;font-family:Arial,sans-serif">
  <main style="max-width:560px;margin:32px auto;padding:36px 32px;background:#fff;border:1px solid #e5e1d9;border-radius:16px">
    <p style="margin:0;color:#6b6f76;font-size:11px;font-weight:700;letter-spacing:.2em">QUORUM · TEAM INVITATION</p>
    <h1 style="margin:18px 0 10px;font-size:26px;line-height:1.2">You have a place at the table.</h1>
    <p style="margin:0;color:#454950;font-size:15px;line-height:1.7"><strong>${inviter}</strong> invited you to join <strong>${workspace}</strong> as a <strong>${role}</strong>.</p>
    <a href="${url}" style="display:inline-block;margin-top:24px;padding:13px 18px;border-radius:9px;background:#111317;color:#fff;text-decoration:none;font-size:13px;font-weight:700">Accept invitation</a>
    <p style="margin:24px 0 8px;color:#6b6f76;font-size:12px">If the button does not open, register at the Quorum site and enter this code:</p>
    <p style="margin:0;padding:13px 15px;border:1px solid #e6e2db;border-radius:9px;background:#faf9f6;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:.12em">${code}</p>
    <p style="margin:18px 0 0;color:#777b82;font-size:12px;line-height:1.6">Use the same email address this invitation was sent to. The invitation expires in 14 days and can only be claimed once.</p>
  </main></body></html>`;

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
