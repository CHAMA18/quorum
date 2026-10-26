import { NextResponse, type NextRequest } from "next/server";
import { updateOrganization } from "@/lib/db";
import { ORG_SESSION_COOKIE, getOrgFromToken, publicOrg } from "@/lib/org-auth";

/**
 * PATCH /api/org/profile — the signed-in ORGANIZATION edits its own profile.
 * The login email and the registration number are the account's identity and
 * are NOT editable here (changing them means re-registering or asking the
 * desk); every other profile field is.
 *
 * 200 → { org }   400 → field errors   401 → no session
 */
export async function PATCH(req: NextRequest) {
  const org = getOrgFromToken(req.cookies.get(ORG_SESSION_COOKIE)?.value);
  if (!org) {
    return NextResponse.json({ error: "Sign in as an organization to update the profile." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const errors: Record<string, string> = {};
  if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length < 2)) {
    errors.name = "The legal name needs at least 2 characters.";
  }
  if (body.description !== undefined && typeof body.description === "string" && body.description.length > 1200) {
    errors.description = "Keep the description under 1200 characters.";
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  const updated = updateOrganization(org.id, body as Parameters<typeof updateOrganization>[1]);
  if (!updated) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }
  return NextResponse.json({ org: publicOrg(updated) });
}
