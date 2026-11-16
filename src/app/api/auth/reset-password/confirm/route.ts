import { NextResponse, type NextRequest } from "next/server";
import {
  consumePasswordReset,
  deleteSessionsForUser,
  findUserById,
  flushStore,
  updateUserPassword,
} from "@/lib/db";
import { clientKey, hashPassword, rateLimit } from "@/lib/auth";
import { hashAuthToken } from "@/lib/auth-email";

/**
 * POST /api/auth/reset-password/confirm — spend a reset link.
 * Body: { token, password }
 *
 * The token is checked before the passphrase is hashed, so a typo does not burn
 * a valid link. A successful reset signs out every existing session for the
 * account: a passphrase change must end the old access.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req, "reset-confirm"), 10, 15 * 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes before trying again." },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json({ error: "This reset link is incomplete. Request a new one." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Choose a passphrase of at least 8 characters." },
      { status: 400 },
    );
  }
  if (password.length > 128) {
    return NextResponse.json({ error: "Maximum 128 characters." }, { status: 400 });
  }

  const row = consumePasswordReset(hashAuthToken(token));
  if (!row) {
    return NextResponse.json(
      { error: "This reset link has expired or was already used. Request a new one." },
      { status: 410 },
    );
  }
  const user = findUserById(row.userId);
  if (!user) {
    return NextResponse.json({ error: "This account no longer exists." }, { status: 410 });
  }

  updateUserPassword(user.id, await hashPassword(password));
  deleteSessionsForUser(user.id);
  await flushStore();
  return NextResponse.json({ ok: true });
}
