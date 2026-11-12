/**
 * Quorum email design system — one renderer for every outbound message.
 *
 * Built for the worst inbox, not the best browser: table layout with an MSO
 * fixed-width fallback, fully inline styles, a bulletproof (VML) button for
 * Outlook, a hidden preheader, dark-scheme support, and a plain-text twin for
 * every send. Callers pass plain strings; everything is escaped here.
 */

export type EmailTone = "action" | "signed" | "urgent" | "info";

export interface EmailFact {
  label: string;
  value: string;
}

export interface EmailModel {
  /** Inbox preview snippet (hidden in the body). */
  preheader: string;
  /** Mono eyebrow, e.g. "GATE WAITING". */
  kicker: string;
  headline: string;
  /** Plain-language opening paragraph. */
  intro: string;
  tone?: EmailTone;
  /** Structured record rows (tender, office, time…). */
  facts?: EmailFact[];
  /** Extra trusted HTML (already escaped by the caller), e.g. a code block. */
  bodyHtml?: string;
  /** Plain-text equivalent of bodyHtml. */
  bodyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  ctaNote?: string;
  /** Why the recipient got this, and what the record of delivery is. */
  footerNote: string;
  recipient: string;
  appUrl: string;
  logoUrl?: string;
}

const TONE_COLOR: Record<EmailTone, string> = {
  action: "#d92c1e",
  signed: "#177245",
  urgent: "#b52b22",
  info: "#17191d",
};

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function factsText(facts: EmailFact[] | undefined): string {
  if (!facts?.length) return "";
  return "\n" + facts.map((f) => `${f.label.toUpperCase()}: ${f.value}`).join("\n") + "\n";
}

/** Plain-text twin: same facts, same link, no markup. */
export function renderEmailText(model: EmailModel): string {
  const lines = [
    model.kicker.toUpperCase(),
    model.headline,
    "",
    model.intro,
    factsText(model.facts ?? []),
  ];
  if (model.bodyText) lines.push("", model.bodyText);
  if (model.ctaLabel && model.ctaUrl) lines.push("", `${model.ctaLabel.toUpperCase()}: ${model.ctaUrl}`);
  if (model.ctaNote) lines.push(model.ctaNote);
  lines.push("", model.footerNote, "", `Sent to ${model.recipient} · Quorum`);
  return lines.filter((l) => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function emailButton(label: string, url: string, color: string): string {
  const safeLabel = escapeEmailHtml(label);
  const safeUrl = escapeEmailHtml(url);
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td align="center">
    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeUrl}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="16%" fillcolor="${color}" strokecolor="${color}"><v:textbox inset="0,0,0,0"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;">${safeLabel}&nbsp;&nbsp;→</center></v:textbox></v:roundrect><![endif]-->
    <!--[if !mso]><!--><a href="${safeUrl}" style="display:inline-block;padding:15px 26px;background:${color};border:1px solid ${color};border-radius:9px;color:#ffffff;font:700 14px/18px Arial,Helvetica,sans-serif;text-decoration:none;">${safeLabel}&nbsp;&nbsp;→</a><!--<![endif]-->
  </td></tr></table>`;
}

function factRows(facts: EmailFact[]): string {
  return facts
    .map(
      (f, i) => `<tr>
        <td class="em-fact-label" style="padding:${i === 0 ? "14px" : "11px"} 16px ${i === facts.length - 1 ? "14px" : "11px"};font:700 9px/13px ui-monospace,Menlo,Consolas,monospace;letter-spacing:1.6px;color:#7c7f87;vertical-align:top;width:132px;">${escapeEmailHtml(f.label.toUpperCase())}</td>
        <td class="em-fact-value" style="padding:${i === 0 ? "14px" : "11px"} 16px ${i === facts.length - 1 ? "14px" : "11px"} 0;font:600 13px/19px Arial,Helvetica,sans-serif;color:#17191d;vertical-align:top;">${escapeEmailHtml(f.value)}</td>
      </tr>${i < facts.length - 1 ? `<tr><td colspan="2" style="padding:0 16px;"><div style="height:1px;background:#edeae3;font-size:1px;line-height:1px;">&nbsp;</div></td></tr>` : ""}`,
    )
    .join("");
}

/** Full HTML document for one message. All model strings are escaped here. */
export function renderEmailHtml(model: EmailModel): string {
  const tone = TONE_COLOR[model.tone ?? "action"];
  const appUrl = escapeEmailHtml(model.appUrl);
  const logo = `<span style="display:inline-block;width:42px;height:42px;border:1px solid #69686a;border-radius:12px;color:#fff;font:700 23px/42px Georgia,serif;text-align:center;">Q</span>`;
  const facts = model.facts?.length
    ? `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" class="em-facts" style="width:100%;background:#f8f6f1;border:1px solid #ebe7de;border-radius:11px;margin:24px 0 0;">${factRows(model.facts)}</table>`
    : "";
  const cta = model.ctaLabel && model.ctaUrl
    ? `<div style="padding:28px 0 0;">${emailButton(model.ctaLabel, model.ctaUrl, tone)}${model.ctaNote ? `<p class="em-muted" style="margin:12px 0 0;font:11px/17px Arial,Helvetica,sans-serif;color:#85878d;">${escapeEmailHtml(model.ctaNote)}</p>` : ""}</div>`
    : "";
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeEmailHtml(model.headline)}</title>
<style>
  @media only screen and (max-width:640px){.em-pad{padding:28px 22px!important}.em-h1{font-size:26px!important}}
  @media (prefers-color-scheme:dark){
    .em-bg{background:#0a0b0d!important}.em-card{background:#15171c!important;border-color:#2b2e36!important}
    .em-h1,.em-fact-value{color:#f2f0e9!important}.em-p{color:#c7c4ba!important}.em-muted{color:#9a978c!important}
    .em-facts{background:#1b1e25!important;border-color:#2b2e36!important}.em-foot{background:#101216!important;border-color:#2b2e36!important}
    .em-link{color:#d8d4c9!important}.em-strong{color:#e8e5dc!important}
  }
</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:#e8e5de;color:#17191d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(model.preheader)}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" class="em-bg" style="width:100%;background:#e8e5de;"><tr><td align="center" style="padding:38px 14px 30px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" class="em-card" style="width:100%;max-width:600px;background:#fffdfa;border:1px solid #e3ded2;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#141416;padding:20px 30px;">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
      <td width="55" valign="middle"><a href="${appUrl}" style="text-decoration:none;border:0;">${logo}</a></td>
      <td valign="middle"><p style="margin:0;color:#fff;font:800 16px/19px Arial,Helvetica,sans-serif;letter-spacing:2px;">QUORUM</p><p style="margin:3px 0 0;color:#a7a9ae;font:700 8.5px/12px Arial,Helvetica,sans-serif;letter-spacing:2.2px;">PROCUREMENT, TOGETHER</p></td>
      <td align="right" valign="middle" style="font:700 9px/14px ui-monospace,Menlo,Consolas,monospace;letter-spacing:1.6px;color:#e9a39d;">A CLEARER WAY<br>TO WORK</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:3px;background:${tone};font-size:1px;line-height:1px;">&nbsp;</td></tr>
  <tr><td class="em-pad" style="padding:42px 40px 38px;">
    <p style="margin:0 0 13px;color:${tone};font:700 10px/14px ui-monospace,Menlo,Consolas,monospace;letter-spacing:2.2px;">${escapeEmailHtml(model.kicker.toUpperCase())}</p>
    <h1 class="em-h1" style="margin:0;font:700 32px/39px Georgia,'Times New Roman',serif;letter-spacing:-.3px;color:#141416;">${escapeEmailHtml(model.headline)}</h1>
    <p class="em-p" style="margin:18px 0 0;font:16px/26px Arial,Helvetica,sans-serif;color:#45484f;">${escapeEmailHtml(model.intro)}</p>
    ${facts}
    ${model.bodyHtml ?? ""}
    ${cta}
    ${model.ctaUrl ? `<p class="em-muted" style="margin:22px 0 0;font:11px/17px Arial,Helvetica,sans-serif;color:#85878d;">If the button does not work, copy and paste this link:<br><a class="em-link" href="${escapeEmailHtml(model.ctaUrl)}" style="color:#45484f;text-decoration:underline;word-break:break-all;">${escapeEmailHtml(model.ctaUrl)}</a></p>` : ""}
  </td></tr>
  <tr><td class="em-foot" style="background:#f5f2eb;border-top:1px solid #e6e1d8;padding:28px 40px 30px;">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="padding-bottom:16px;border-bottom:1px solid #ded9cf;">
      <p class="em-strong" style="margin:0;font:700 17px/22px Georgia,'Times New Roman',serif;color:#17191d;">Thoughtful decisions start here.</p>
      <p class="em-muted" style="margin:5px 0 0;font:12px/19px Arial,Helvetica,sans-serif;color:#65676c;">Your work, your decisions, all in one place.</p>
    </td></tr><tr><td style="padding-top:16px;">
      <p class="em-muted" style="margin:0;font:12px/19px Arial,Helvetica,sans-serif;color:#65676c;">${escapeEmailHtml(model.footerNote)}</p>
      <p class="em-muted" style="margin:12px 0 0;font:11px/18px Arial,Helvetica,sans-serif;color:#65676c;">Sent to ${escapeEmailHtml(model.recipient)} &nbsp;&middot;&nbsp; <a class="em-link" href="${appUrl}" style="color:#45484f;text-decoration:underline;">Visit Quorum</a></p>
    </td></tr></table>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
<p style="margin:18px 0 0;font:700 9px/13px Arial,Helvetica,sans-serif;letter-spacing:1.8px;color:#8f8c82;">QUORUM &nbsp;·&nbsp; PROCUREMENT, TOGETHER</p>
</td></tr></table>
</body></html>`;
}
