import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createContactMessage } from "@/lib/db";
import { escapeEmailHtml, renderEmailHtml, renderEmailText, type EmailModel } from "@/lib/email-template";
import { clientKey, rateLimit } from "@/lib/auth";

const PILOT_REQUEST_INBOX = "chungu424@gmail.com";
const REQUEST_LIMIT = 5;
const REQUEST_WINDOW_MS = 15 * 60_000;

const ContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  notes: z.string().max(3000).optional(),
  /* Keep older landing-page clients working while they roll out. */
  message: z.string().max(4000).optional(),
});

async function sendPilotRequestEmail(input: {
  name: string;
  email: string;
  company: string;
  notes: string;
}): Promise<"sent" | "unconfigured" | "failed"> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return "unconfigured";

  const from = process.env.RESEND_FROM?.trim() || "Quorum <onboarding@resend.dev>";
  const notes = input.notes || "No additional notes supplied.";
  const appUrl = (process.env.QUORUM_APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const model: EmailModel = {
    preheader: `${input.name} from ${input.company || "an institution"} requested a Quorum pilot.`,
    kicker: "Pilot request",
    headline: "New pilot request",
    intro: "A new pilot request arrived from the Quorum site. Reply directly to continue the conversation.",
    tone: "info",
    facts: [
      { label: "Name", value: input.name },
      { label: "Work email", value: input.email },
      { label: "Institution", value: input.company || "Not specified" },
    ],
    bodyHtml: `<p style="margin:26px 0 8px;font:700 10px/14px ui-monospace,Menlo,Consolas,monospace;letter-spacing:1.8px;color:#7c7f87;">NOTES</p><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;background:#faf9f6;border:1px solid #e7e3dc;border-radius:10px;"><tr><td style="padding:16px 18px;font:14px/23px Arial,Helvetica,sans-serif;color:#34363b;">${escapeEmailHtml(notes).replace(/\n/g, "<br>")}</td></tr></table>`,
    bodyText: `Notes: ${notes}`,
    ctaLabel: "Reply by email",
    ctaUrl: `mailto:${input.email}`,
    footerNote: "Sent from the Quorum pilot-request form. The request is also saved in the workspace records.",
    recipient: PILOT_REQUEST_INBOX,
    appUrl,
    logoUrl: `${appUrl}/images/quorum-email-mark.png`,
  };
  const text = renderEmailText(model);
  const html = renderEmailHtml(model);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [PILOT_REQUEST_INBOX],
        reply_to: input.email,
        subject: "[Quorum] New pilot request",
        text,
        html,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error("[contact] Pilot request email was rejected by the email provider", { status: response.status });
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("[contact] Pilot request email delivery failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return "failed";
  }
}

/** POST /api/contact — pilot request & enquiry intake from the landing page. */
export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, "pilot-request"), REQUEST_LIMIT, REQUEST_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes before trying again." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your name and a valid work email. Notes can contain up to 3,000 characters." },
      { status: 422 }
    );
  }

  try {
    const notes = (parsed.data.notes ?? parsed.data.message ?? "").trim();
    const company = parsed.data.company?.trim() ?? "";
    const saved = createContactMessage({
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      company: company || null,
      message: notes || "No additional notes supplied.",
    });
    const delivery = await sendPilotRequestEmail({
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      company,
      notes,
    });
    if (delivery !== "sent") {
      return NextResponse.json({
        error: delivery === "unconfigured"
          ? "Your request was saved, but email delivery is not configured yet. Please try again later."
          : "Your request was saved, but we could not email it to the team. Please try again in a few minutes.",
      }, { status: delivery === "unconfigured" ? 503 : 502 });
    }
    return NextResponse.json({ ok: true, id: saved.id, emailSent: true }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Could not save your request right now. Try again in a moment." },
      { status: 500 }
    );
  }
}
