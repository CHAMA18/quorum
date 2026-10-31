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
}): Promise<InviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const domainId = process.env.RESEND_DOMAIN_ID?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !domainId || !from) {
    return {
      status: "SKIPPED",
      detail: "Resend email settings are incomplete; share the invite code directly.",
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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `team-invite/${input.inviteId}`,
      },
      body: JSON.stringify({ from, to: [input.to], subject, html, text }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    if (!response.ok) {
      const detail = response.status === 401
        ? "Resend rejected its API key; check the deployment secret."
        : response.status === 403 || response.status === 422
          ? "Resend rejected the sender or recipient; confirm RESEND_FROM uses the verified domain and the recipient is valid."
          : `Resend did not accept the invitation (HTTP ${response.status}).`;
      return { status: "FAILED", detail };
    }
    return {
      status: "SENT",
      detail: "Resend accepted the invitation email.",
      ...(payload.id ? { messageId: payload.id } : {}),
    };
  } catch {
    return { status: "FAILED", detail: "Quorum could not reach Resend; the invite code is still available to share." };
  }
}
