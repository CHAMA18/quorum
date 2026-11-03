import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createContactMessage } from "@/lib/db";
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

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
  const text = [
    "New Quorum pilot request",
    "",
    `Name: ${input.name}`,
    `Work email: ${input.email}`,
    `Institution: ${input.company || "Not specified"}`,
    "",
    "Notes:",
    notes,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ed;color:#17181b;font-family:Arial,sans-serif">
    <main style="max-width:620px;margin:32px auto;padding:28px;background:#fffdfb;border:1px solid #e4e0d8;border-radius:14px">
      <p style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:.14em;color:#b52e20">QUORUM · PILOT REQUEST</p>
      <p style="margin:0 0 8px"><strong>Name:</strong> ${escapeHtml(input.name)}</p>
      <p style="margin:0 0 8px"><strong>Work email:</strong> <a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a></p>
      <p style="margin:0 0 18px"><strong>Institution:</strong> ${escapeHtml(input.company || "Not specified")}</p>
      <p style="margin:0 0 8px"><strong>Notes</strong></p>
      <pre style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 Arial,sans-serif">${escapeHtml(notes)}</pre>
    </main>
  </body></html>`;

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
