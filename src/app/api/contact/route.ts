import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createContactMessage } from "@/lib/db";

const ContactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  company: z.string().max(160).optional().or(z.literal("")),
  message: z.string().min(10).max(4000),
});

/** POST /api/contact — pilot request & enquiry intake from the landing page. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the fields — a name, a valid work email and a short message are required." },
      { status: 422 }
    );
  }

  try {
    const saved = createContactMessage({
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      company: parsed.data.company?.trim() || null,
      message: parsed.data.message.trim(),
    });
    return NextResponse.json({ ok: true, id: saved.id }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Could not save your request right now. Try again in a moment." },
      { status: 500 }
    );
  }
}
