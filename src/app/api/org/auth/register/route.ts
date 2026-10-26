import { NextResponse, type NextRequest } from "next/server";
import { createOrganization, findOrganizationByEmail, findOrganizationByRegistrationNo } from "@/lib/db";
import {
  clientKey,
  createOrgSessionToken,
  hashPassword,
  ORG_SESSION_COOKIE,
  publicOrg,
  rateLimit,
  sessionCookieOptions,
} from "@/lib/org-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/org/auth/register — create an ORGANIZATION account and open its
 * session. This is the supplier side's own door: separate store, separate
 * cookie, no shared state with officer accounts.
 *
 * Body: { name, email, password, registrationNo, country, legalForm?,
 *         taxPin?, taxClearanceNo?, taxClearanceExpiry?, regulator?,
 *         regulatorNo?, contactName?, phone?, address?, website?,
 *         description?, categories? }
 *
 * 201 → { org } + httpOnly org session cookie (30 days)
 * 400 → { error, errors? }   409 → email or registrationNo taken   429 → rate limited
 *
 * Unlike officer accounts, an organization's session opens immediately:
 * there is no email-verification loop on this door. The procurement desk
 * verifies an organization's statutory documents (registration, tax
 * clearance) as part of its own process — enforced where it belongs, on
 * the register, not in a mail loop.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "org-register"), 10, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts from this network. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = s(body.name);
  const email = s(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const registrationNo = s(body.registrationNo);
  const country = s(body.country);
  const categories = Array.isArray(body.categories)
    ? body.categories.map((c) => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 12)
    : [];

  const errors: Record<string, string> = {};
  if (name.length < 2 || name.length > 160) errors.name = "Enter the organization's legal name (2–160 characters).";
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid organization email.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  else if (password.length > 128) errors.password = "Maximum 128 characters.";
  if (registrationNo.length < 3 || registrationNo.length > 80) errors.registrationNo = "Enter the legal registration number (3–80 characters).";
  if (country.length < 2 || country.length > 80) errors.country = "Enter the country of registration.";
  if (s(body.description).length > 1200) errors.description = "Keep the description under 1200 characters.";
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Check the highlighted fields.", errors }, { status: 400 });
  }

  if (findOrganizationByEmail(email)) {
    return NextResponse.json(
      {
        error: "An organization account with this email already exists.",
        errors: { email: "This email already has an organization account — sign in instead." },
      },
      { status: 409 }
    );
  }
  if (findOrganizationByRegistrationNo(registrationNo)) {
    return NextResponse.json(
      {
        error: "This registration number is already on the portal.",
        errors: { registrationNo: "An organization with this registration number already exists." },
      },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  let org;
  try {
    org = createOrganization({
      name,
      email,
      password: passwordHash,
      registrationNo,
      country,
      legalForm: s(body.legalForm) || undefined,
      taxPin: s(body.taxPin) || undefined,
      taxClearanceNo: s(body.taxClearanceNo) || undefined,
      taxClearanceExpiry: s(body.taxClearanceExpiry) || undefined,
      regulator: s(body.regulator) || undefined,
      regulatorNo: s(body.regulatorNo) || undefined,
      contactName: s(body.contactName) || undefined,
      phone: s(body.phone) || undefined,
      address: s(body.address) || undefined,
      website: s(body.website) || undefined,
      description: s(body.description) || undefined,
      categories,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }

  const { token, expiresAt } = await createOrgSessionToken(org.id, true);
  const res = NextResponse.json({ org: publicOrg(org) }, { status: 201 });
  res.cookies.set(ORG_SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}
