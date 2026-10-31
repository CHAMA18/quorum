import { NextResponse, type NextRequest } from "next/server";
import {
  appealReference,
  createOrgAppeal,
  findOpenAppealForOrg,
  findOrganizationByEmail,
  recordOversightEvent,
} from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/org-auth";

/**
 * POST /api/org/appeal — a suspended organization asks the desk to review.
 *
 * This door is public because the account door is closed: a suspended org
 * cannot sign in to file anything. The appeal is matched by email AND
 * registration number, and every mismatch gets the same 404 body, so the
 * endpoint cannot be used to enumerate accounts or suspension status.
 *
 * 201 → { appeal: { id, reference, status, createdAt } }
 * 400 → shape     404 → no suspended org matches     409 → appeal already open
 * 429 → rate limited
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "org-appeal"), 5, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many appeal attempts. For security, wait a few minutes before trying again." },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const registrationNo = typeof body.registrationNo === "string" ? body.registrationNo.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const errors: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) errors.email = "Enter the organization's account email.";
  if (registrationNo.length < 3) errors.registrationNo = "Enter the legal registration number (3–80 characters).";
  if (reason.length < 20) errors.reason = "State the grounds for the appeal (at least 20 characters).";
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  const org = findOrganizationByEmail(email);
  /* Uniform refusal: unknown address, wrong registration number and an
     active (not suspended) account are indistinguishable from here. */
  const matches =
    !!org &&
    org.status === "SUSPENDED" &&
    org.registrationNo.trim().toLowerCase() === registrationNo.toLowerCase();
  if (!matches) {
    return NextResponse.json({ error: "No suspended organization matches those details." }, { status: 404 });
  }

  if (findOpenAppealForOrg(org.id)) {
    return NextResponse.json(
      { error: "A suspension appeal from this organization is already open — the desk will review it." },
      { status: 409 },
    );
  }

  const appeal = createOrgAppeal(org.id, reason);
  const reference = appealReference(appeal.id);

  recordOversightEvent({
    actorId: org.id,
    actorName: org.name,
    action: "ORG_APPEAL_FILED",
    targetType: "ORGANIZATION",
    targetId: org.id,
    targetName: org.name,
    detail: `${reference} — ${reason.slice(0, 300)}`,
  });

  return NextResponse.json(
    {
      appeal: {
        id: appeal.id,
        reference,
        status: appeal.status,
        createdAt: appeal.createdAt,
      },
    },
    { status: 201 },
  );
}
