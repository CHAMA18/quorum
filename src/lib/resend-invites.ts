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

  const inviter = escapeHtml(input.inviterName || "A Quorum workspace administrator");
  const workspace = escapeHtml(input.workspaceName || "your Quorum workspace");
  const role = escapeHtml(input.role.replaceAll("_", " ").toLowerCase());
  const code = escapeHtml(input.code);
  const url = escapeHtml(input.inviteUrl);
  const recipient = escapeHtml(input.to);
  const appUrl = escapeHtml(new URL("/", input.inviteUrl).toString());
  const logoUrl = escapeHtml(new URL("/images/quorum-email-mark.png", input.inviteUrl).toString());
  const subject = input.inviterName
    ? `${input.inviterName} invited you to ${input.workspaceName || "Quorum"}`
    : `You're invited to ${input.workspaceName || "Quorum"}`;
  const safeSubject = escapeHtml(subject);
  const text = [
    `Your seat at the table is ready. ${input.inviterName || "A Quorum workspace administrator"} invited you to join ${input.workspaceName || "their Quorum workspace"} on Quorum.`,
    `Your role: ${input.role.replaceAll("_", " ").toLowerCase()}.`,
    "",
    `ACCEPT YOUR INVITATION: ${input.inviteUrl}`,
    `INVITATION CODE: ${input.code}`,
    "",
    `This invitation was sent to ${input.to}. Register using this same email address.`,
    "The invitation expires in 14 days and can only be used once.",
    "If you were not expecting this invitation, you can safely ignore this message.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f2f0eb;color:#17191d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
      ${inviter} invited you to ${workspace} on Quorum. Your ${role} invitation is ready.
    </div>
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f2f0eb" style="width:100%;background-color:#f2f0eb;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e6e2db;border-radius:16px;overflow:hidden;">
            <tr>
              <td bgcolor="#17191d" style="padding:22px 30px;background-color:#17191d;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="48" valign="middle" style="width:48px;padding:0 13px 0 0;">
                      <a href="${appUrl}" style="display:block;border:0;text-decoration:none;">
                        <img src="${logoUrl}" width="48" height="48" alt="Quorum mark" style="display:block;width:48px;height:48px;border:0;border-radius:11px;outline:none;text-decoration:none;">
                      </a>
                    </td>
                    <td valign="middle" style="padding:0;">
                      <p style="margin:0;color:#ffffff;font-size:17px;font-weight:800;letter-spacing:1.8px;line-height:20px;">QUORUM</p>
                      <p style="margin:4px 0 0;color:#a7a9ae;font-size:9px;font-weight:700;letter-spacing:2px;line-height:13px;">AGENTIC PROCUREMENT</p>
                    </td>
                    <td align="right" valign="middle" style="padding:0 0 0 10px;color:#e9a39d;font-size:9px;font-weight:700;letter-spacing:1.5px;line-height:15px;">
                      WORKSPACE<br>INVITATION
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:38px 38px 14px;">
                <p style="margin:0 0 14px;color:#b52b22;font-size:10px;font-weight:700;letter-spacing:2px;line-height:14px;">A SHARED DECISION STARTS HERE</p>
                <h1 style="margin:0;color:#17191d;font-size:32px;font-weight:750;letter-spacing:-0.8px;line-height:1.16;">Your seat at the<br>table is ready.</h1>
                <p style="margin:18px 0 0;color:#4e5158;font-size:15px;line-height:25px;">
                  <strong style="color:#17191d;">${inviter}</strong> invited you to join <strong style="color:#17191d;">${workspace}</strong> on Quorum.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 38px 0;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f7f5f1" style="width:100%;background-color:#f7f5f1;border:1px solid #ece8e1;border-radius:10px;">
                  <tr>
                    <td width="4" bgcolor="#e8382a" style="width:4px;background-color:#e8382a;font-size:1px;line-height:1px;">&nbsp;</td>
                    <td style="padding:14px 17px;">
                      <p style="margin:0;color:#777982;font-size:9px;font-weight:700;letter-spacing:1.5px;line-height:13px;">YOUR ROLE</p>
                      <p style="margin:4px 0 0;color:#17191d;font-size:14px;font-weight:700;line-height:20px;text-transform:capitalize;">${role}</p>
                    </td>
                    <td align="right" style="padding:14px 17px;color:#777982;font-size:11px;line-height:18px;">
                      Expires in<br><strong style="color:#34363b;font-size:12px;">14 days</strong>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 38px 0;">
                <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td align="center" bgcolor="#17191d" style="border-radius:8px;background-color:#17191d;">
                      <a href="${url}" style="display:inline-block;padding:15px 22px;border:1px solid #17191d;border-radius:8px;color:#ffffff;font-size:14px;font-weight:700;line-height:18px;text-align:center;text-decoration:none;">Accept your invitation&nbsp;&nbsp;→</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:12px 0 0;color:#85878d;font-size:11px;line-height:18px;">One secure link takes you straight to your Quorum registration.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 38px 0;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr><td height="1" bgcolor="#ebe8e2" style="height:1px;background-color:#ebe8e2;font-size:1px;line-height:1px;">&nbsp;</td></tr>
                </table>
                <p style="margin:24px 0 7px;color:#777982;font-size:10px;font-weight:700;letter-spacing:1.5px;line-height:14px;">YOUR INVITATION CODE</p>
                <p style="margin:0;color:#41434a;font-size:13px;line-height:21px;">If you prefer, enter this code after opening Quorum:</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 38px 0;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#faf9f6" style="width:100%;background-color:#faf9f6;border:1px solid #e7e3dc;border-radius:9px;">
                  <tr>
                    <td align="center" style="padding:17px 12px;color:#17191d;font-family:Menlo,Consolas,'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:4px;line-height:30px;">${code}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 38px 34px;">
                <p style="margin:0;color:#777982;font-size:11px;line-height:18px;">Button not working? Copy this address into your browser:</p>
                <p style="margin:5px 0 0;color:#4e5158;font-size:11px;line-height:18px;word-break:break-all;"><a href="${url}" style="color:#4e5158;text-decoration:underline;">${url}</a></p>
              </td>
            </tr>
            <tr>
              <td bgcolor="#f7f5f1" style="padding:21px 30px;background-color:#f7f5f1;border-top:1px solid #ece8e1;">
                <p style="margin:0;color:#777982;font-size:10px;line-height:17px;">
                  Sent to <strong style="color:#4e5158;">${recipient}</strong>. This invitation expires in 14 days, can be used once, and is intended for this email address. If you weren’t expecting it, you can safely ignore this message.
                </p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
          <p style="margin:18px 0 0;color:#93959a;font-size:9px;font-weight:700;letter-spacing:1.6px;line-height:14px;">QUORUM&nbsp;&nbsp;·&nbsp;&nbsp;AGENTIC PROCUREMENT</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

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
