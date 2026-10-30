import { NextResponse, type NextRequest } from "next/server";
import { clientKey, getUserFromToken, rateLimit, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { setUserTotp } from "@/lib/db";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/totp";

/**
 * /api/auth/totp — enrol an authenticator for step-up signatures.
 *
 * POST   begin: mint a secret, return the otpauth:// URI (not enabled yet)
 * PUT    confirm: verify one code, then trust the secret
 * DELETE disable: requires the current passphrase or a valid code
 * GET    status: whether an authenticator is active
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  return NextResponse.json({
    enabled: user.totpEnabled === true,
    pending: Boolean(user.totpSecret) && !user.totpEnabled,
    required: (process.env.QUORUM_TOTP_POLICY ?? "required").trim().toLowerCase() !== "optional",
  });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  if (!rateLimit(clientKey(req, `totp-begin:${user.id}`), 4, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many enrolment attempts. Wait a few minutes." }, { status: 429 });
  }
  if (user.totpEnabled) {
    return NextResponse.json({ error: "An authenticator is already active. Disable it before enrolling another." }, { status: 409 });
  }
  const secret = generateTotpSecret();
  setUserTotp(user.id, secret, false);
  return NextResponse.json({
    secret,
    uri: otpauthUrl(secret, user.email),
    issuer: "Quorum",
    account: user.email,
    digits: 6,
    period: 30,
  });
}

export async function PUT(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  if (!rateLimit(clientKey(req, `totp-confirm:${user.id}`), 8, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const code = typeof body?.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!user.totpSecret) return NextResponse.json({ error: "Start enrolment first." }, { status: 409 });
  if (!verifyTotp(user.totpSecret, code)) {
    return NextResponse.json({ error: "That code is not valid. Check the authenticator clock and try the current code." }, { status: 401 });
  }
  setUserTotp(user.id, null, true);
  return NextResponse.json({ enabled: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getUserFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const code = typeof body?.code === "string" ? body.code.replace(/\s+/g, "") : "";
  const passwordOk = password ? await verifyPassword(password, user.password) : false;
  const codeOk = code && user.totpSecret ? verifyTotp(user.totpSecret, code) : false;
  if (!passwordOk && !codeOk) {
    return NextResponse.json({ error: "Confirm with your passphrase or a current authenticator code." }, { status: 401 });
  }
  setUserTotp(user.id, null, false);
  return NextResponse.json({ enabled: false });
}
